import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ZCODE_PLUGIN_HOST_COMMAND } from "@zcode/contracts/plugins";
const HOST_USAGE = `${ZCODE_PLUGIN_HOST_COMMAND} <server-path> [-- <server-arg>...]`;
export function isPluginHostInvocation(argv) {
    return argv[0] === ZCODE_PLUGIN_HOST_COMMAND;
}
// __zcode-plugin-host 在 agent 子进程里运行 official plugin 的 MCP server（server.js）。
// 这里只负责进程环境兜底（ELECTRON_RUN_AS_NODE 等由 manifest env 提供）与 argv 归一化，
// 不再承载任何宿主凭据恢复。
export async function runPluginHostCommand(ctx, argv) {
    if (argv.length < 1) {
        ctx.stderr.write(`Usage: ${HOST_USAGE}\n`);
        return 1;
    }
    const [rawServerPath, ...serverArgs] = argv;
    try {
        if (rawServerPath === undefined) {
            throw new Error("Plugin server path is required.");
        }
        const serverPath = resolve(rawServerPath);
        if (!existsSync(serverPath)) {
            throw new Error("Plugin server file does not exist.");
        }
        const module = (await import(pathToFileURL(serverPath).href));
        if (typeof module.main !== "function") {
            throw new Error("Plugin server does not export main().");
        }
        const originalArgv = process.argv;
        process.argv = [process.execPath, serverPath, ...serverArgs];
        try {
            await module.main();
        }
        finally {
            process.argv = originalArgv;
        }
        return 0;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.stderr.write(`Plugin host failed: ${message}\n`);
        return 1;
    }
}
