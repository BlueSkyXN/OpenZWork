import { afterEach, describe, expect, it } from "vitest";
import { AddressInfo } from "node:net";
import { once } from "node:events";
import { ServiceCollection } from "@zcode/services";
import { createHttpServer } from "../src/http.js";

// v3.17.1 同步复核：上游退役了原 serverInfoHttp.test.ts 全文件，
// 本文件按 OW-P002 原触发场景（含 +、/、= 的 token 经 Cookie 鉴权失败）重建回归。
describe("OW-P002：Web token Cookie 编码", () => {
  const servers: Array<{ close(callback?: (err?: Error) => void): void }> = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    servers.length = 0;
  });

  async function listen(token: string) {
    const server = createHttpServer(new ServiceCollection(), 0, {
      host: "127.0.0.1",
      authToken: token,
    });
    servers.push(server);
    if (!server.listening) await once(server, "listening");
    const address = server.address() as AddressInfo;
    return new URL(`http://127.0.0.1:${address.port}/api/server-info`);
  }

  it.each([
    "plain-token",
    "plus+token",
    "slash/token",
    "equals=token",
    "percent%2Btoken",
    "中文令牌",
  ])("round-trips URL token through the issued cookie: %s", async (token) => {
    const url = await listen(token);
    url.searchParams.set("token", token);
    const first = await fetch(url);
    expect(first.status).toBe(200);
    const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
    url.search = "";
    expect((await fetch(url, { headers: { cookie } })).status).toBe(200);
    expect((await fetch(url, { headers: { cookie: "zcode_lite_token=wrong" } })).status).toBe(401);
  });

  it("rejects malformed and double-encoded cookies without a server error", async () => {
    const url = await listen("plus+token");
    url.search = "";
    for (const encoded of ["%", "%GG", "%E0%A4%A", "plus%252Btoken"]) {
      expect(
        (await fetch(url, { headers: { cookie: `zcode_lite_token=${encoded}` } })).status,
      ).toBe(401);
    }
  });
});
