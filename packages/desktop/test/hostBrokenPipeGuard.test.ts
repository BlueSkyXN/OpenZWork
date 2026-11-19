import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { test } from "vitest";
import { installHostBrokenPipeGuard } from "../src/host/hostBrokenPipeGuard.js";
import { createHostUncaughtExceptionHandler } from "../src/host/hostUncaughtExceptionGuard.js";

const channels = ["stdout", "stderr"] as const;
type Channel = (typeof channels)[number];

// 结果走独立 IPC，避免用已经断开的流报告错误。写入只在父进程确认读端关闭后发生。
const childScript = `
const [channel, guardUrl] = process.argv.slice(1);
const stream = process[channel];
let reported = false;
const finish = (message, status) => {
  // Windows 等待致命回执发完时，写入回调安排的 setImmediate 仍可能执行。
  if (reported) return;
  reported = true;
  process.send(message, () => process.exit(status));
};
process.on("uncaughtException", (error) => {
  finish({ uncaught: error.code ?? null }, error.code === "EPIPE" ? 42 : 43);
});
if (guardUrl) {
  const { installHostBrokenPipeGuard } = await import(guardUrl);
  installHostBrokenPipeGuard();
}
process.once("message", () => {
  stream.write("x".repeat(256 * 1024), (error) => {
    // 等错误事件先完成分派，再报告子进程是否能继续运行。
    setImmediate(() => finish({ writeError: error?.code ?? null, survived: true }, 0));
  });
});
process.send("ready");
`;

async function runPipeChild(channel: Channel, guarded: boolean) {
  const guardUrl = new URL("../src/host/hostBrokenPipeGuard.ts", import.meta.url);
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", childScript, channel, guarded ? guardUrl.href : ""],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  const readEnd = child[channel];
  const messages: unknown[] = [];
  child.on("message", (message) => {
    if (message !== "ready") messages.push(message);
  });
  child.stdout.resume();
  child.stderr.resume();
  const closed = once(child, "close");
  const timeout = setTimeout(() => child.kill(), 5_000);
  try {
    const state = await Promise.race([once(child, "message"), closed]);
    assert.equal(state[0], "ready", "子进程必须进入写入前的等待状态");
    const readerClosed = once(readEnd, "close");
    readEnd.destroy();
    await readerClosed;
    await new Promise<void>((resolve, reject) => {
      child.send("write", (error) => (error ? reject(error) : resolve()));
    });
    const [code, signal] = await closed;
    return { code, signal, messages };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}

for (const channel of channels) {
  // OW-P039：不能只断言退出码；装护栏前后都必须实际写到已断开的管道。
  test(`${channel} 读端退出时，仅有护栏的进程在 EPIPE 后存活`, async () => {
    assert.deepEqual(await runPipeChild(channel, false), {
      code: 42,
      signal: null,
      messages: [{ uncaught: "EPIPE" }],
    });
    assert.deepEqual(await runPipeChild(channel, true), {
      code: 0,
      signal: null,
      messages: [{ writeError: "EPIPE", survived: true }],
    });
  });
}

test("两路非 EPIPE 流错误都把原对象交给 Host 的致命异常分派", () => {
  const streams = [new EventEmitter(), new EventEmitter()];
  installHostBrokenPipeGuard(streams);
  for (const stream of streams) {
    const foreign = Object.assign(new Error("unrelated failure mentioning EPIPE"), {
      code: "ECONNRESET",
    });
    let fatalError: Error | undefined;
    const dispatch = createHostUncaughtExceptionHandler({
      onRecovered: () => assert.fail("非 EPIPE 流错误不应被恢复"),
      onFatal: (error) => (fatalError = error),
    });
    assert.throws(
      () => stream.emit("error", foreign),
      (error: Error) => {
        dispatch(error, "uncaughtException");
        return error === foreign;
      },
    );
    assert.equal(fatalError, foreign);
  }
});
