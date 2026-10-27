import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  dataDirectory,
  relocateDataPath,
  relocateFileReference,
  DATA_ROOT_RELOCATED_MARKER,
} from "./index.js";

const roots: string[] = [];
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "data-root-gate-"));
  roots.push(base);
  const sourceRoot = join(base, "old", ".openzwork");
  await mkdir(sourceRoot, { recursive: true });
  return {
    sourceRoot,
    targetRoot: join(base, "new", ".openzwork"),
    stageRoot: join(base, "stage"),
  };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("business data root admission", () => {
  it("blocks migration while either of two active users retains its lease", async () => {
    const { sourceRoot } = await fixture();
    const first = await dataDirectory.acquireUse(sourceRoot);
    const second = await dataDirectory.acquireUse(sourceRoot);
    await first();
    await expect(dataDirectory.exclusive(sourceRoot, async () => {})).rejects.toMatchObject({
      code: "DATA_DIRECTORY_IN_USE",
    });
    await second();
    await expect(dataDirectory.exclusive(sourceRoot, async () => "ready")).resolves.toBe("ready");
  });
  it("keeps new users outside an active migration and releases after failure", async () => {
    const { sourceRoot } = await fixture();
    await expect(
      dataDirectory.exclusive(sourceRoot, async () => {
        await expect(dataDirectory.acquireUse(sourceRoot)).rejects.toMatchObject({
          code: "ZCODE_FILE_LOCK_TIMEOUT",
        });
        throw new Error("synthetic copy failure");
      }),
    ).rejects.toThrow("synthetic copy failure");
    await (
      await dataDirectory.acquireUse(sourceRoot)
    )();
  });
  it.each(["", '{"pid":', "complete"])(
    "reclaims a crashed process lease with content %j after its PID exits",
    async (content) => {
      const { sourceRoot } = await fixture();
      const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
      expect(await once(child, "exit")).toEqual([0, null]);
      expect(child.pid).toBeGreaterThan(0);
      const gate = `${sourceRoot}.data-access`;
      await mkdir(gate);
      const lease = join(gate, `user-${child.pid}-${randomUUID()}.json`);
      await writeFile(lease, content === "complete" ? JSON.stringify({ pid: child.pid }) : content);
      await expect(dataDirectory.exclusive(sourceRoot, async () => "ready")).resolves.toBe("ready");
      await expect(readFile(lease)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
  it.each(["", '{"pid":', "conflicting owner", "unknown owner"])(
    "preserves an uncertain or live lease with content %j",
    async (content) => {
      const { sourceRoot } = await fixture();
      const gate = `${sourceRoot}.data-access`;
      await mkdir(gate);
      const name =
        content === "unknown owner"
          ? "user-unknown.json"
          : `user-${process.pid}-${randomUUID()}.json`;
      const lease = join(gate, name);
      const raw =
        content === "conflicting owner" ? JSON.stringify({ pid: process.pid + 1 }) : content;
      await writeFile(lease, raw);
      await expect(dataDirectory.exclusive(sourceRoot, async () => "ready")).rejects.toMatchObject({
        code: "DATA_DIRECTORY_IN_USE",
      });
      expect(await readFile(lease, "utf8")).toBe(raw);
    },
  );
  it("ignores an unpublished atomic-write temporary file", async () => {
    const { sourceRoot } = await fixture();
    const gate = `${sourceRoot}.data-access`;
    await mkdir(gate);
    await writeFile(join(gate, `.user-${process.pid}-${randomUUID()}.json.partial.tmp`), "");
    await expect(dataDirectory.exclusive(sourceRoot, async () => "ready")).resolves.toBe("ready");
  });
  it("refuses a retired root instead of reopening its old snapshot", async () => {
    const { sourceRoot } = await fixture();
    await writeFile(join(sourceRoot, DATA_ROOT_RELOCATED_MARKER), "{}");
    await expect(dataDirectory.acquireUse(sourceRoot)).rejects.toMatchObject({
      code: "DATA_DIRECTORY_RELOCATED",
    });
  });
  it("maps owned files and URLs while preserving external, global, relative and remote references", async () => {
    const plan = await fixture();
    const path = join(plan.sourceRoot, "clipboard", "a b.png");
    expect(relocateDataPath(path, plan)).toBe(join(plan.targetRoot, "clipboard", "a b.png"));
    expect(relocateFileReference(pathToFileURL(path).href, plan)).toBe(
      pathToFileURL(join(plan.targetRoot, "clipboard", "a b.png")).href,
    );
    for (const untouched of [
      join(plan.sourceRoot, "cli", "config.json"),
      join(plan.sourceRoot, "v2", "setting.json"),
      join(`${plan.sourceRoot}-other`, "workspace"),
      "relative/file",
      "zcode-artifact://session/artifact",
      `remote:${path}`,
    ]) {
      expect(relocateDataPath(untouched, plan)).toBe(untouched);
    }
  });
});
