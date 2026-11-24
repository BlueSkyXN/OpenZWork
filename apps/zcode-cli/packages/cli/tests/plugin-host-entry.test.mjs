import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { build } from "esbuild";
import {
  createZodDedupePlugin,
  readZodBuildVersion,
  resolveBuildAliases,
  resolveBuildExternal,
} from "../scripts/build.mjs";

const execFileAsync = promisify(execFile);
const cliRoot = resolve(import.meta.dirname, "..");
const forbiddenEvaluation = "AGENT_ENTRY_EVALUATED";
const processTimeoutMs = 10_000;

for (const minify of [false, true]) {
  test(`plugin host avoids Agent initialization in ${minify ? "desktop" : "Node"} bundles`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-plugin-entry-"));
    const outfile = join(directory, "zcode.cjs");
    const serverPath = join(directory, "server.mjs");
    const blockedModules = new Set([
      resolve(cliRoot, "src/run.ts"),
      resolve(cliRoot, "src/provider-runtime-env.ts"),
      resolve(cliRoot, "../core/dist/runtime.js"),
      resolve(cliRoot, "../contracts/dist/index.js"),
      resolve(cliRoot, "../../../../packages/shared/src/index.ts"),
    ]);

    try {
      await writeFile(
        serverPath,
        `const processTitleAtImport = process.title;
export async function main() {
  process.stdout.write(JSON.stringify({
    processTitleAtImport,
    processTitle: process.title,
    args: process.argv.slice(2),
    nodeEnvRemoved: process.env.NODE_ENV === undefined,
  }));
}`,
      );
      await build({
        alias: resolveBuildAliases(),
        bundle: true,
        entryPoints: [join(cliRoot, "src/main.ts")],
        external: resolveBuildExternal(),
        format: "cjs",
        keepNames: minify,
        minify,
        metafile: true,
        outfile,
        platform: "node",
        target: "node22",
        plugins: [
          createZodDedupePlugin({ expectedV4Version: await readZodBuildVersion() }),
          {
            name: "reject-agent-initialization",
            setup(builder) {
              builder.onLoad({ filter: /\.[jt]s$/ }, async ({ path }) => {
                if (!blockedModules.has(path)) return undefined;
                // 回归要挡住模块求值，而非只看包大小；构建仍保留普通 CLI 所需代码。
                return {
                  contents: `throw new Error(${JSON.stringify(forbiddenEvaluation)});\n${await readFile(path, "utf8")}`,
                  loader: path.endsWith(".ts") ? "ts" : "js",
                };
              });
            },
          },
        ],
      });

      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [outfile, "__zcode-plugin-host", serverPath, "--prompt", "plugin argument"],
        {
          env: { ...process.env, NODE_ENV: "untrusted", ZCODE_PLUGIN_ID: "" },
          timeout: processTimeoutMs,
        },
      );
      assert.equal(stderr, "");
      assert.deepEqual(JSON.parse(stdout), {
        processTitleAtImport: "zcode-mcp",
        processTitle: "zcode-mcp",
        args: ["--prompt", "plugin argument"],
        nodeEnvRemoved: true,
      });

      for (const [pluginId, expectedTitle] of [
        ["documents@zcode-plugins-official", "zcode-mcp-documents"],
        [" Custom-Tool@example-marketplace ", "zcode-mcp-custom-tool"],
        ["invalid/name@example-marketplace", "zcode-mcp"],
      ]) {
        const named = await execFileAsync(
          process.execPath,
          [outfile, "__zcode-plugin-host", serverPath],
          {
            env: { ...process.env, ZCODE_PLUGIN_ID: pluginId },
            timeout: processTimeoutMs,
          },
        );
        assert.equal(named.stderr, "");
        const payload = JSON.parse(named.stdout);
        assert.equal(payload.processTitleAtImport, expectedTitle);
        assert.equal(payload.processTitle, expectedTitle);
      }

      // 证明探针实际生效：普通命令仍进入业务分支，触发被注入的求值错误。
      await assert.rejects(
        execFileAsync(process.execPath, [outfile, "--version"], { timeout: processTimeoutMs }),
        (error) => error.stderr.includes(forbiddenEvaluation),
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
}
