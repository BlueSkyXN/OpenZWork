import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCredentialCipherBridge,
  createLegacyCredentialCipher,
  createSystemCredentialCipher,
  executeCredentialCipherRequest,
  prepareServerCredentialFile,
  ZCODE_CREDENTIALS_FILE_ENV,
} from "@zcode/shared/credential-security";
import { createCredentialService } from "../src/credential/credentialService.js";
import { expect, test, vi } from "vitest";
import {
  loadBotRuntimeCredential,
  migrateBotCredentialKeys,
} from "../src/bots/credentialKeyMigration.ts";

const buildCredentialKey = (botId: string) => `openzwork-bot:${botId}:credential`;
const buildWebhookSecretKey = (botId: string) => `openzwork-bot:${botId}:webhook-secret`;

test.each(["Server", "Desktop bridge"])(
  "OW-P059：%s 在混合来源库中迁移本端可读的 Bot 引用",
  async (owner) => {
    const base = await mkdtemp(join(tmpdir(), "openzwork-bot-mixed-"));
    const file = join(base, "credentials.json");
    vi.stubEnv(ZCODE_CREDENTIALS_FILE_ENV, file);
    let key: string | null = null;
    const keyStore = {
      get: async () => key,
      set: async (value: string) => {
        key = value;
      },
    };
    const env = { ZCODE_CREDENTIAL_SECRET: "synthetic-server-key-for-mixed-store" };
    const desktop = createSystemCredentialCipher({ filePath: file, keyStore, env: {} });
    const server = createSystemCredentialCipher({ filePath: file, keyStore, env });
    const bridge = createCredentialCipherBridge((request) => {
      void executeCredentialCipherRequest(desktop, request).then((reply) => bridge.receive(reply));
    });
    try {
      const osKey = "bot:desktop:credential";
      const envKey = "bot:server:credential";
      const record = {
        [osKey]: await desktop.encrypt("desktop"),
        [envKey]: await server.encrypt("server"),
        legacy: "legacy",
      };
      await writeFile(file, JSON.stringify(record), { mode: 0o600 });
      expect(
        await prepareServerCredentialFile({
          sharedFilePath: file,
          serverFilePath: join(base, "server", "credentials.json"),
          env,
        }),
      ).toBe(file);
      const isServer = owner === "Server";
      const own = isServer ? "server" : "desktop";
      const foreign = isServer ? osKey : envKey;
      const store = createCredentialService({ cipherProvider: isServer ? server : bridge.cipher });
      const result = await migrateBotCredentialKeys({
        config: {
          bots: [
            { id: "desktop", credentialRef: osKey },
            { id: "server", credentialRef: envKey },
          ],
        },
        credentialStore: store,
        writeConfig: async (config) => config,
        buildCredentialKey,
        buildWebhookSecretKey,
        warn() {},
      });
      expect(result.config.bots.map((bot) => bot.credentialRef)).toEqual(
        isServer ? [osKey, buildCredentialKey(own)] : [buildCredentialKey(own), envKey],
      );
      expect(await store.load(buildCredentialKey(own))).toBe(own);
      expect(await loadBotRuntimeCredential(store, foreign)).toBeNull();
      const saved = JSON.parse(await readFile(file, "utf8"));
      expect(saved[foreign]).toBe(record[foreign]);
      expect(saved.legacy).toBe(record.legacy);
      // 旧 Host 仍能按原有错误码处理异端来源，凭据桥只返回既有的两个错误字段。
      const reply = await executeCredentialCipherRequest(desktop, {
        requestId: "10000000-0000-4000-8000-000000000000",
        operation: "decrypt",
        value: record[envKey],
      });
      expect(reply.result).toEqual({
        ok: false,
        error: { code: "CREDENTIAL_SECURE_STORAGE_UNAVAILABLE", message: expect.any(String) },
      });
      const wrongKey = createSystemCredentialCipher({
        filePath: file,
        keyStore,
        env: { ZCODE_CREDENTIAL_SECRET: "a-different-managed-key-for-review" },
      });
      await expect(
        loadBotRuntimeCredential(
          createCredentialService({ cipherProvider: wrongKey }),
          isServer ? buildCredentialKey(own) : envKey,
        ),
      ).rejects.toMatchObject({ code: "CREDENTIAL_SECURE_STORAGE_UNAVAILABLE" });
    } finally {
      bridge.dispose();
      vi.unstubAllEnvs();
      await rm(base, { recursive: true, force: true });
    }
  },
);

test("Bot token and webhook secret keys use the openzwork-prefixed local namespace", async () => {
  const source = await readFile(new URL("../src/bots/config.ts", import.meta.url), "utf8");
  assert.match(source, /const BOT_CREDENTIAL_PREFIX = "openzwork-bot";/u);
  assert.match(source, /return `\$\{BOT_CREDENTIAL_PREFIX\}:\$\{botId\}:credential`;/u);
  assert.match(source, /return `\$\{BOT_CREDENTIAL_PREFIX\}:\$\{botId\}:webhook-secret`;/u);
});

test("legacy encrypted Bot secret values are decrypted and re-encrypted under the private key", async () => {
  const operations: string[] = [];
  const storedValues = new Map([["bot:telegram-encrypted:credential", "enc:v1:legacy"]]);
  let savedConfig = {
    bots: [{ id: "telegram-encrypted", credentialRef: "bot:telegram-encrypted:credential" }],
  };
  const result = await migrateBotCredentialKeys({
    config: savedConfig,
    credentialStore: {
      async load(key) {
        return storedValues.get(key) ?? null;
      },
      async save(key, value) {
        operations.push(`save:${key}:${value}`);
        storedValues.set(key, value);
      },
      async delete(key) {
        operations.push(`delete:${key}`);
        storedValues.delete(key);
      },
    },
    async writeConfig(config) {
      operations.push("commit:config");
      savedConfig = config;
      return config;
    },
    async resolveCredentialValue(_key, value) {
      operations.push(`decrypt:${value}`);
      return value === "enc:v1:legacy" ? "telegram-secret" : value;
    },
    buildCredentialKey,
    buildWebhookSecretKey,
    warn() {},
  });

  assert.equal(result.changed, true);
  assert.equal(savedConfig.bots[0]?.credentialRef, "openzwork-bot:telegram-encrypted:credential");
  assert.equal(storedValues.get("openzwork-bot:telegram-encrypted:credential"), "telegram-secret");
  assert.ok(
    operations.indexOf("save:openzwork-bot:telegram-encrypted:credential:telegram-secret") <
      operations.indexOf("commit:config"),
  );
});

test("legacy Bot secret references commit before deleting their old keys", async () => {
  const values = new Map<string, string>([
    ["bot:telegram-1:credential", "telegram-token"],
    ["bot:webhook-1:webhook-secret", "webhook-secret"],
  ]);
  const events: string[] = [];
  let savedConfig = {
    bots: [
      { id: "telegram-1", credentialRef: "bot:telegram-1:credential" },
      { id: "webhook-1", webhookSecretRef: "bot:webhook-1:webhook-secret" },
      { id: "missing-1", credentialRef: "bot:missing-1:credential" },
    ],
  };

  const result = await migrateBotCredentialKeys({
    config: savedConfig,
    credentialStore: {
      async load(key) {
        events.push(`load:${key}`);
        return values.get(key) ?? null;
      },
      async save(key, value) {
        events.push(`save:${key}`);
        values.set(key, value);
      },
      async delete(key) {
        events.push(`delete:${key}`);
        values.delete(key);
      },
    },
    async writeConfig(config) {
      events.push("commit:config");
      savedConfig = config;
      return config;
    },
    buildCredentialKey,
    buildWebhookSecretKey,
    warn(message) {
      events.push(`warn:${message}`);
    },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(
    savedConfig.bots.map((bot) => [bot.credentialRef, bot.webhookSecretRef]),
    [
      ["openzwork-bot:telegram-1:credential", undefined],
      [undefined, "openzwork-bot:webhook-1:webhook-secret"],
      ["bot:missing-1:credential", undefined],
    ],
  );
  assert.equal(values.get("openzwork-bot:telegram-1:credential"), "telegram-token");
  assert.equal(values.get("openzwork-bot:webhook-1:webhook-secret"), "webhook-secret");
  assert.equal(values.has("bot:telegram-1:credential"), false);
  assert.equal(values.has("bot:webhook-1:webhook-secret"), false);
  assert.ok(events.indexOf("commit:config") < events.indexOf("delete:bot:telegram-1:credential"));
  assert.ok(
    events.includes(
      "warn:legacy Bot credential missing key=bot:missing-1:credential; retaining reference",
    ),
  );
});

test("a failed config commit retains legacy credentials for a retry", async () => {
  const values = new Map([["bot:telegram-1:credential", "telegram-token"]]);
  let failFirstCommit = true;
  const config = { bots: [{ id: "telegram-1", credentialRef: "bot:telegram-1:credential" }] };
  const migrate = () =>
    migrateBotCredentialKeys({
      config,
      credentialStore: {
        async load(key) {
          return values.get(key) ?? null;
        },
        async save(key, value) {
          values.set(key, value);
        },
        async delete(key) {
          values.delete(key);
        },
      },
      async writeConfig(nextConfig) {
        if (failFirstCommit) {
          failFirstCommit = false;
          throw new Error("disk unavailable");
        }
        return nextConfig;
      },
      buildCredentialKey,
      buildWebhookSecretKey,
      warn() {},
    });

  await assert.rejects(migrate(), /disk unavailable/u);
  assert.equal(values.get("bot:telegram-1:credential"), "telegram-token");
  assert.equal(config.bots[0]?.credentialRef, "bot:telegram-1:credential");

  const retry = await migrate();
  assert.equal(retry.config.bots[0]?.credentialRef, "openzwork-bot:telegram-1:credential");
  assert.equal(values.has("bot:telegram-1:credential"), false);
});

test("current credential references do not rewrite config or trigger external cleanup", async () => {
  let configWrites = 0;
  let credentialDeletes = 0;
  const config = {
    bots: [{ id: "current-1", credentialRef: "openzwork-bot:current-1:credential" }],
  };
  const result = await migrateBotCredentialKeys({
    config,
    credentialStore: {
      async load() {
        return null;
      },
      async save() {},
      async delete() {
        credentialDeletes += 1;
      },
    },
    async writeConfig(nextConfig) {
      configWrites += 1;
      return nextConfig;
    },
    buildCredentialKey,
    buildWebhookSecretKey,
    warn() {},
  });

  assert.equal(result.changed, false);
  assert.equal(configWrites, 0);
  assert.equal(credentialDeletes, 0);
});

test("单条旧凭据无法解密时，健康引用仍能迁移，凭据库读取错误仍上抛", async () => {
  const base = await mkdtemp(join(tmpdir(), "openzwork-bot-credentials-"));
  const file = join(base, "credentials.json");
  vi.stubEnv(ZCODE_CREDENTIALS_FILE_ENV, file);
  try {
    const cipher = createLegacyCredentialCipher({ ZCODE_CREDENTIAL_SECRET: "synthetic-fixture" });
    const brokenKey = "bot:broken:credential";
    const healthyKey = "bot:healthy:webhook-secret";
    await writeFile(
      file,
      JSON.stringify({ [brokenKey]: "enc:v1:invalid", [healthyKey]: cipher.encrypt("fixture") }),
    );
    const store = createCredentialService({ cipherProvider: cipher });
    const config = {
      bots: [
        { id: "broken", credentialRef: brokenKey },
        { id: "healthy", webhookSecretRef: healthyKey },
      ],
    };
    const warnings: string[] = [];
    const migrate = () =>
      migrateBotCredentialKeys({
        config,
        credentialStore: store,
        writeConfig: async (next) => next,
        buildCredentialKey,
        buildWebhookSecretKey,
        warn: (message) => warnings.push(message),
      });
    const result = await migrate();
    assert.equal(result.config.bots[0]?.credentialRef, brokenKey);
    assert.equal(result.config.bots[1]?.webhookSecretRef, buildWebhookSecretKey("healthy"));
    assert.equal(await store.load(buildWebhookSecretKey("healthy")), "fixture");
    assert.equal(await store.load(healthyKey), null);
    assert.equal(JSON.parse(await readFile(file, "utf8"))[brokenKey], "enc:v1:invalid");
    assert.equal(warnings.length, 1);
    assert.equal(await loadBotRuntimeCredential(store, brokenKey), null);
    assert.equal(
      await loadBotRuntimeCredential(store, buildWebhookSecretKey("healthy")),
      "fixture",
    );

    await writeFile(file, "{");
    await assert.rejects(migrate());
    await assert.rejects(loadBotRuntimeCredential(store, brokenKey));
  } finally {
    vi.unstubAllEnvs();
    await rm(base, { recursive: true, force: true });
  }
});
