import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function requireRemoteBundle(path) {
  const info = await stat(path).catch(() => undefined);
  // 缺真实产物是失败，不能用 skip 让 CI 把没有执行的远端链误记为成功。
  assert.ok(
    info?.isFile(),
    `Missing remote server bundle: ${path}. Run pnpm --filter @zcode/server build:remote first.`,
  );
}

export async function assertExecutable(path) {
  const mode = (await stat(path)).mode;
  assert.notEqual(mode & 0o111, 0, `chmod +x must apply (got ${(mode & 0o777).toString(8)})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await requireRemoteBundle(process.argv[2]);
}
