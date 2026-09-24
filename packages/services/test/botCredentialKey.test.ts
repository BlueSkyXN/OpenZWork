import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { migrateBotCredentialKeys } from "../src/bots/credentialKeyMigration.ts";

const buildCredentialKey = (botId: string) => `openzwork-bot:${botId}:credential`;
const buildWebhookSecretKey = (botId: string) => `openzwork-bot:${botId}:webhook-secret`;

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
