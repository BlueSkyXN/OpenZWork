import { fork } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SHARED_ZCODE_CREDENTIAL_KEYS,
  createSharedZCodeCredentialStore,
  loadSharedZCodeCredential,
  resolveSharedZCodeCredentialsPath,
} from "../src/auth/index.js";

const TEST_ENV = {
  ZCODE_CREDENTIAL_SECRET: "test-secret",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shared ZCode credentials", () => {
  it("clears the associated account when the current global login is cleared", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-clear-associated-"));
    const store = createSharedZCodeCredentialStore({ baseDir: dir, env: TEST_ENV });
    try {
      await store.saveMany({
        "oauth:active_provider": "zai",
        "oauth:zai:access_token": "login",
        "oauth:linked_bigmodel": "associated",
      });
      await store.clearZaiLoginCredentials();
      expect(await store.load("oauth:linked_bigmodel")).toBeNull();
      expect(await store.load("oauth:active_provider")).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replaces China-region credentials and associated account when starting a new global login", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-cn-replace-"));
    const store = createSharedZCodeCredentialStore({ baseDir: dir, env: TEST_ENV });
    try {
      await store.saveMany({
        "oauth:active_provider": "zai_cn",
        "oauth:zai_cn:access_token": "cn-token",
        "oauth:linked_bigmodel": JSON.stringify({
          customerId: "linked",
          accessToken: "linked-token",
        }),
      });
      await store.saveZaiLoginCredentials({
        accessToken: "global",
        jwtToken: "global-jwt",
        user: { user_id: "global-user" },
      });
      expect(await store.load("oauth:zai_cn:access_token")).toBeNull();
      expect(await store.load("oauth:linked_bigmodel")).toBeNull();
      expect(await store.load("oauth:active_provider")).toBe("zai");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an old snapshot after the same account logs in again with identical tokens", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-repeat-"));
    const store = createSharedZCodeCredentialStore({ baseDir: dir, env: TEST_ENV });
    const login = {
      accessToken: "same-token",
      jwtToken: "same-jwt",
      user: { user_id: "same-user" },
    };
    try {
      await store.saveZaiLoginCredentials(login);
      const expected = await store.loadOAuthSessionSnapshot();
      await store.saveZaiLoginCredentials(login);
      expect(await store.updateMany({ zcodejwttoken: null }, { expected })).toBe(false);
      expect(await store.load("zcodejwttoken")).toBe("same-jwt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not decrypt inactive provider leftovers when reading the active session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-inactive-broken-"));
    const store = createSharedZCodeCredentialStore({ baseDir: dir, env: TEST_ENV });
    try {
      await store.saveMany({
        "oauth:active_provider": "bigmodel",
        zcodejwttoken: "valid-jwt",
        "oauth:bigmodel:access_token": "valid-token",
      });
      const raw = JSON.parse(await readFile(store.filePath, "utf8"));
      raw["oauth:zai:access_token"] = "enc:v1:broken-unused-token";
      await writeFile(store.filePath, JSON.stringify(raw));
      const snapshot = await store.loadOAuthSessionSnapshot();
      expect(snapshot["oauth:active_provider"]).toBe("bigmodel");
      expect(snapshot["oauth:zai:access_token"]).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a stale whole-session update without deleting unchanged sibling fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-group-cas-"));
    const store = createSharedZCodeCredentialStore({ baseDir: dir, env: TEST_ENV });
    try {
      await store.saveMany({
        "oauth:active_provider": "zai",
        zcodejwttoken: "old",
        "oauth:zai:user_info": "same-user",
      });
      const expected = await store.loadMany([
        "oauth:active_provider",
        "zcodejwttoken",
        "oauth:zai:user_info",
        "oauth:zai:refresh_token",
      ]);
      await store.save("zcodejwttoken", "new");
      expect(
        await store.updateMany(
          { "oauth:active_provider": null, zcodejwttoken: null, "oauth:zai:user_info": null },
          { expected },
        ),
      ).toBe(false);
      expect(await store.loadMany(Object.keys(expected))).toEqual({
        ...expected,
        zcodejwttoken: "new",
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("clears a previous account and stale refresh token when committing a ZAI login", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-switch-"));
    const store = createSharedZCodeCredentialStore({ baseDir: dir, env: TEST_ENV });
    try {
      await store.saveMany({
        "oauth:active_provider": "bigmodel",
        "oauth:bigmodel:access_token": "old-account",
        "oauth:zai:refresh_token": "old-refresh",
        "bot:independent": "keep",
      });
      await store.saveZaiLoginCredentials({
        accessToken: "new-account",
        jwtToken: "new-jwt",
        user: { user_id: "new-user" },
      });
      expect(await store.load("oauth:bigmodel:access_token")).toBeNull();
      expect(await store.load("oauth:zai:refresh_token")).toBeNull();
      expect(await store.load("bot:independent")).toBe("keep");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("does not clear the active BigModel JWT when removing inactive ZAI credentials", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-inactive-clear-"));
    const store = createSharedZCodeCredentialStore({ baseDir: dir, env: TEST_ENV });
    try {
      await store.saveMany({
        "oauth:active_provider": "bigmodel",
        zcodejwttoken: "bigmodel-jwt",
        "oauth:zai:access_token": "old-zai",
      });
      await store.clearZaiLoginCredentials();
      expect(await store.load("oauth:active_provider")).toBe("bigmodel");
      expect(await store.load("zcodejwttoken")).toBe("bigmodel-jwt");
      expect(await store.load("oauth:zai:access_token")).toBeNull();
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("stores ZAI login credentials with z-code compatible encrypted keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-"));

    try {
      const store = createSharedZCodeCredentialStore({
        baseDir: dir,
        env: TEST_ENV,
      });

      await store.saveZaiLoginCredentials({
        accessToken: "zai-access-token",
        jwtToken: "zcode-jwt-token",
        user: {
          email: "alice@example.com",
          name: "Alice",
          user_id: "u_1",
        },
      });

      const raw = JSON.parse(await readFile(store.filePath, "utf-8")) as Record<string, string>;
      expect(store.filePath).toBe(join(dir, ".openzwork", "v2", "credentials.json"));
      expect(raw[SHARED_ZCODE_CREDENTIAL_KEYS.zaiAccessToken]?.startsWith("enc:v2:")).toBe(true);
      expect(await store.load(SHARED_ZCODE_CREDENTIAL_KEYS.activeProvider)).toBe("zai");
      expect(await store.load(SHARED_ZCODE_CREDENTIAL_KEYS.zaiAccessToken)).toBe(
        "zai-access-token",
      );
      expect(await store.load(SHARED_ZCODE_CREDENTIAL_KEYS.zcodeJwtToken)).toBe("zcode-jwt-token");
      expect(
        await loadSharedZCodeCredential(SHARED_ZCODE_CREDENTIAL_KEYS.zaiAccessToken, {
          baseDir: dir,
          env: TEST_ENV,
        }),
      ).toBe("zai-access-token");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("reads legacy plaintext credential values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-"));
    const credentialsDir = join(dir, ".openzwork", "v2");
    const credentialsPath = join(credentialsDir, "credentials.json");

    try {
      await mkdir(credentialsDir, { recursive: true });
      await writeFile(
        credentialsPath,
        JSON.stringify({
          [SHARED_ZCODE_CREDENTIAL_KEYS.zaiAccessToken]: "legacy-token",
        }),
      );

      const store = createSharedZCodeCredentialStore({
        baseDir: dir,
        env: TEST_ENV,
      });

      expect(await store.load(SHARED_ZCODE_CREDENTIAL_KEYS.zaiAccessToken)).toBe("legacy-token");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("preserves every key across concurrent read-modify-write mutations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-concurrent-"));
    const store = createSharedZCodeCredentialStore({
      baseDir: dir,
      env: TEST_ENV,
    });
    const entries = Array.from({ length: 40 }, (_, index) => [`key-${index}`, `value-${index}`]);

    try {
      await Promise.all(entries.map(([key, value]) => store.save(key!, value!)));

      await Promise.all(
        entries.map(async ([key, value]) => {
          await expect(store.load(key!)).resolves.toBe(value);
        }),
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("deletes a credential only when its expected plaintext value is still current", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-compare-delete-"));
    const store = createSharedZCodeCredentialStore({
      baseDir: dir,
      env: TEST_ENV,
    });

    try {
      await store.save("oauth:snapshot", "snapshot-a");

      await expect(store.deleteIfValue("oauth:snapshot", "stale-snapshot")).resolves.toBe(false);
      await expect(store.load("oauth:snapshot")).resolves.toBe("snapshot-a");
      await expect(store.deleteIfValue("oauth:snapshot", "snapshot-a")).resolves.toBe(true);
      await expect(store.load("oauth:snapshot")).resolves.toBeNull();
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("publishes a replacement credential and removes legacy keys in one mutation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-replace-"));
    const store = createSharedZCodeCredentialStore({
      baseDir: dir,
      env: TEST_ENV,
    });

    try {
      await store.save("oauth:legacy-client", "client-a");
      await store.save("oauth:legacy-tokens", "tokens-a");

      await store.saveReplacing("oauth:canonical", "pair-a", [
        "oauth:legacy-client",
        "oauth:legacy-tokens",
      ]);

      await expect(store.load("oauth:canonical")).resolves.toBe("pair-a");
      await expect(store.load("oauth:legacy-client")).resolves.toBeNull();
      await expect(store.load("oauth:legacy-tokens")).resolves.toBeNull();
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("preserves every key across independent Node processes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-processes-"));
    const credentialsPath = join(dir, "credentials.json");
    const processCount = 4;
    const keysPerProcess = 8;

    try {
      await runConcurrentCredentialWorkers(credentialsPath, processCount, keysPerProcess);
      const store = createSharedZCodeCredentialStore({
        env: TEST_ENV,
        filePath: credentialsPath,
      });
      await Promise.all(
        Array.from({ length: processCount }, (_, processIndex) =>
          Array.from({ length: keysPerProcess }, async (_, keyIndex) => {
            await expect(store.load(`worker-${processIndex}:key-${keyIndex}`)).resolves.toBe(
              `value-${processIndex}-${keyIndex}`,
            );
          }),
        ).flat(),
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }, 15_000);

  it("backs up corrupt JSON and refuses to overwrite it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-corrupt-"));
    const credentialsPath = join(dir, "credentials.json");
    const store = createSharedZCodeCredentialStore({
      env: TEST_ENV,
      filePath: credentialsPath,
    });

    try {
      await writeFile(credentialsPath, "{not-json", {
        encoding: "utf-8",
        mode: 0o644,
      });

      await Promise.all(
        Array.from({ length: 8 }, () =>
          expect(store.load("safe-key")).rejects.toThrow("Shared ZCode credentials are corrupt"),
        ),
      );
      await expect(store.save("safe-key", "safe-value")).rejects.toThrow(
        "Shared ZCode credentials are corrupt",
      );
      await expect(readFile(credentialsPath, "utf-8")).resolves.toBe("{not-json");
      const backups = (await readdir(dir)).filter((file) =>
        /^credentials\.json\.corrupt-.*\.bak$/.test(file),
      );
      expect(backups).toHaveLength(1);
      await expect(readFile(join(dir, backups[0]!), "utf-8")).resolves.toBe("{not-json");
      if (process.platform !== "win32") {
        expect((await stat(join(dir, backups[0]!))).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("deduplicates corrupt credential backups across independent Node processes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-corrupt-processes-"));
    const credentialsPath = join(dir, "credentials.json");

    try {
      await writeFile(credentialsPath, "{not-json", "utf-8");
      await runConcurrentCredentialWorkers(credentialsPath, 6, 0, "read-corrupt");

      const backups = (await readdir(dir)).filter((file) =>
        /^credentials\.json\.corrupt-.*\.bak$/.test(file),
      );
      expect(backups).toHaveLength(1);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});

// ZCT-2120452663971209216：同机 Desktop 把共享库固定为系统库来源时，Source Server Core
// 改用自有凭据库，并通过 ZCODE_CREDENTIALS_FILE 让其拉起的 Agent 读写同一文件。
describe("shared ZCode credentials path", () => {
  const credentialsFileEnv = "ZCODE_CREDENTIALS_FILE";

  it("uses the host-assigned credentials file before the data base dir", () => {
    const assigned = join(tmpdir(), "zcode-server-root", "credentials", "credentials.json");
    expect(
      resolveSharedZCodeCredentialsPath({
        env: { [credentialsFileEnv]: assigned, ZCODE_DATA_BASE_DIR: join(tmpdir(), "other") },
      }),
    ).toBe(assigned);
  });

  it("keeps explicit caller paths ahead of the host-assigned file", () => {
    const assigned = join(tmpdir(), "assigned", "credentials.json");
    const baseDir = join(tmpdir(), "explicit-base");
    const filePath = join(tmpdir(), "explicit", "credentials.json");
    const env = { [credentialsFileEnv]: assigned };
    expect(resolveSharedZCodeCredentialsPath({ baseDir, env })).toBe(
      join(baseDir, ".openzwork", "v2", "credentials.json"),
    );
    expect(resolveSharedZCodeCredentialsPath({ baseDir, env, filePath })).toBe(filePath);
  });

  it("treats an empty host-assigned file as unset", () => {
    const dataBaseDir = join(tmpdir(), "zcode-data-base");
    expect(
      resolveSharedZCodeCredentialsPath({
        env: { [credentialsFileEnv]: "  ", ZCODE_DATA_BASE_DIR: dataBaseDir },
      }),
    ).toBe(join(dataBaseDir, ".openzwork", "v2", "credentials.json"));
  });

  it("rejects a relative host-assigned file instead of resolving it against cwd", () => {
    const env = { [credentialsFileEnv]: join("relative", "credentials.json") };
    expect(() => resolveSharedZCodeCredentialsPath({ env })).toThrow(credentialsFileEnv);
    expect(() => createSharedZCodeCredentialStore({ env })).toThrow(credentialsFileEnv);
  });

  it("reads and writes only the host-assigned file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-auth-assigned-file-"));
    const assigned = join(dir, "server", "credentials", "credentials.json");
    const dataBaseDir = join(dir, "home");
    const env = { ...TEST_ENV, [credentialsFileEnv]: assigned, ZCODE_DATA_BASE_DIR: dataBaseDir };
    try {
      await mkdir(join(dir, "server", "credentials"), { recursive: true });
      const store = createSharedZCodeCredentialStore({ env });
      expect(store.filePath).toBe(assigned);
      await store.save("zcodejwttoken", "server-owned-token");

      expect(await createSharedZCodeCredentialStore({ env }).load("zcodejwttoken")).toBe(
        "server-owned-token",
      );
      expect(JSON.parse(await readFile(assigned, "utf-8"))).toHaveProperty("zcodejwttoken");
      await expect(
        stat(join(dataBaseDir, ".openzwork", "v2", "credentials.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});

async function runConcurrentCredentialWorkers(
  filePath: string,
  processCount: number,
  keysPerProcess: number,
  operation: "save" | "read-corrupt" = "save",
): Promise<void> {
  const workerUrl = new URL("./fixtures/shared-credentials-concurrent-process.ts", import.meta.url);
  const children = Array.from({ length: processCount }, (_, processIndex) =>
    fork(workerUrl, {
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    }),
  );

  try {
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", (code) =>
              reject(new Error(`credential child exited early: ${code}`)),
            );
            child.on("message", (message: { type?: unknown }) => {
              if (message.type === "ready") resolve();
            });
          }),
      ),
    );

    const results = children.map(
      (child) =>
        new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (code) => {
            if (code !== 0) reject(new Error(`credential child exited with code ${code}`));
          });
          child.on("message", (message: { error?: unknown; type?: unknown }) => {
            if (message.type === "done") resolve();
            if (message.type === "error") reject(new Error(String(message.error)));
          });
        }),
    );

    children.forEach((child, processIndex) => {
      child.send({
        filePath,
        keysPerProcess,
        operation,
        processIndex,
        type: "start",
      });
    });
    await Promise.all(results);
  } finally {
    for (const child of children) {
      if (child.connected) child.disconnect();
      child.kill();
    }
  }
}
