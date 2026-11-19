// OW-P039：管道读端退出后，Host 写日志会在流上异步发出 EPIPE，不能让它终止 Host。
// Host 与 Main 是独立进程，因此在 Host 入口单独安装监听，不复用 Main 的 logger。
function rethrowNonBrokenPipeStreamError(error: Error): void {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "EPIPE") {
    return;
  }
  throw error;
}

export function installHostBrokenPipeGuard(
  streams: { on(event: "error", listener: (error: Error) => void): unknown }[] = [
    process.stdout,
    process.stderr,
  ],
): void {
  for (const stream of streams) {
    stream.on("error", rethrowNonBrokenPipeStreamError);
  }
}
