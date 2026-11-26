import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createServerCredentialCipher,
  createSystemCredentialCipher,
  ZCODE_CREDENTIALS_FILE_ENV,
  type CredentialKeyStore,
} from "@zcode/shared/credential-security";
import {
  getAppConfigDir,
  getCredentialsFilePath,
  getZCodeDataRootDir,
  setDataBaseDir,
} from "@zcode/services/node";
import { prepareEntryHttpCredentials } from "../src/entry-http.js";

const ENV_KEYS = [
  ZCODE_CREDENTIALS_FILE_ENV,
  "ZCODE_CREDENTIAL_SECRET",
  "ZCODE_CREDENTIAL_SECRET_FILE",
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const tempRoots: string[] = [];

async function createTempDataBaseDir(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openzwork-entry-http-cred-")));
  tempRoots.push(root);
  return root;
}

function workingKeyStore(initial: string | null = null): CredentialKeyStore {
  let saved = initial;
  return {
    async get() {
      return saved;
    },
    async set(value) {
      saved = value;
    },
  };
}

function unavailableKeyStore(): {
  calls: { get: number; set: number };
  store: CredentialKeyStore;
} {
  const calls = { get: 0, set: 0 };
  return {
    calls,
    store: {
      async get() {
        calls.get += 1;
        throw Object.assign(new Error("Cannot find module '@napi-rs/keyring'"), {
          code: "ERR_MODULE_NOT_FOUND",
        });
      },
      async set() {
        calls.set += 1;
        throw Object.assign(new Error("Cannot find module '@napi-rs/keyring'"), {
          code: "ERR_MODULE_NOT_FOUND",
        });
      },
    },
  };
}

afterEach(async () => {
  setDataBaseDir(null);
  for (const key of ENV_KEYS) {
    const previous = originalEnv.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("entry-http standalone Web credential isolation", () => {
  it("isolates to <dataRoot>/server/credentials and sets ZCODE_CREDENTIALS_FILE when Desktop pinned OS keyring", async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const baseDir = await createTempDataBaseDir();
    setDataBaseDir(baseDir);

    const desktopV2Dir = getAppConfigDir();
    await mkdir(desktopV2Dir, { recursive: true });
    const desktopCredentialsPath = join(desktopV2Dir, "credentials.json");
    const desktopSourcePath = join(desktopV2Dir, "credential-source");

    // 模拟同机 Desktop 已将共享凭据库绑定到系统钥匙串并写入 enc:v2:os: 密文。
    const desktopKeyStore = workingKeyStore();
    const desktopCipher = createSystemCredentialCipher({
      filePath: desktopCredentialsPath,
      env: {},
      keyStore: desktopKeyStore,
    });
    const desktopEncrypted = await desktopCipher.encrypt("desktop-provider-api-key");
    expect(desktopEncrypted).toMatch(/^enc:v2:os:/);
    await writeFile(
      desktopCredentialsPath,
      `${JSON.stringify({ openai: desktopEncrypted }, null, 2)}\n`,
    );

    const desktopCredentialsSnapshot = await readFile(desktopCredentialsPath, "utf8");
    const desktopSourceSnapshot = await readFile(desktopSourcePath, "utf8");
    expect(desktopSourceSnapshot).toBe("os\n");

    const expectedServerCredentialsPath = join(
      getZCodeDataRootDir(),
      "server",
      "credentials",
      "credentials.json",
    );
    const expectedServerSecretPath = join(
      getZCodeDataRootDir(),
      "server",
      "credentials",
      "credential-secret",
    );

    const preparedPath = await prepareEntryHttpCredentials();
    expect(preparedPath).toBe(expectedServerCredentialsPath);
    expect(process.env[ZCODE_CREDENTIALS_FILE_ENV]).toBe(expectedServerCredentialsPath);
    // getCredentialsFilePath() 必须实时读取 ZCODE_CREDENTIALS_FILE，使 Server 与子进程 Agent 同源。
    expect(getCredentialsFilePath()).toBe(expectedServerCredentialsPath);

    const secretStats = await stat(expectedServerSecretPath);
    expect(secretStats.isFile()).toBe(true);
    if (process.platform !== "win32") {
      expect(secretStats.mode & 0o777).toBe(0o600);
    }

    // 即使独立 Web 进程缺少 @napi-rs/keyring 或系统钥匙串未解锁，createServerCredentialCipher 也直接成功。
    const brokenKeyring = unavailableKeyStore();
    const serverCipher = await createServerCredentialCipher({
      filePath: getCredentialsFilePath(),
      env: {},
      keyStore: brokenKeyring.store,
    });
    expect(brokenKeyring.calls).toEqual({ get: 0, set: 0 });
    const webCiphertext = await serverCipher.encrypt("web-provider-api-key");
    expect(webCiphertext).toMatch(/^enc:v2:env:/);
    expect(await serverCipher.decrypt(webCiphertext)).toBe("web-provider-api-key");

    // Desktop 的共享 credentials.json 与 credential-source 保持原样，且不会在 v2 下生成 credential-secret。
    expect(await readFile(desktopCredentialsPath, "utf8")).toBe(desktopCredentialsSnapshot);
    expect(await readFile(desktopSourcePath, "utf8")).toBe("os\n");
    await expect(stat(join(desktopV2Dir, "credential-secret"))).rejects.toHaveProperty(
      "code",
      "ENOENT",
    );
    expect(await desktopCipher.decrypt(desktopEncrypted)).toBe("desktop-provider-api-key");

    // 新进程再次启动时继续选择同一个已发布的隔离目录。
    delete process.env[ZCODE_CREDENTIALS_FILE_ENV];
    const resolvedOnRestart = await prepareEntryHttpCredentials();
    expect(resolvedOnRestart).toBe(expectedServerCredentialsPath);
    expect(process.env[ZCODE_CREDENTIALS_FILE_ENV]).toBe(expectedServerCredentialsPath);
  });

  it("prepares the isolated store on the first dev:web start after Desktop pinned the shared store", async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    setDataBaseDir(await createTempDataBaseDir());
    const desktopDir = getAppConfigDir();
    await mkdir(desktopDir, { recursive: true });
    await writeFile(join(desktopDir, "credential-source"), "os\n");
    const desktopFile = join(desktopDir, "credentials.json");
    await writeFile(desktopFile, "{}\n");
    const serverDir = join(getZCodeDataRootDir(), "server", "credentials");
    await expect(stat(serverDir)).rejects.toHaveProperty("code", "ENOENT");

    expect(await prepareEntryHttpCredentials()).toBe(join(serverDir, "credentials.json"));
    expect(getCredentialsFilePath()).toBe(join(serverDir, "credentials.json"));
    expect((await stat(join(serverDir, "credential-secret"))).isFile()).toBe(true);
    expect(await readFile(desktopFile, "utf8")).toBe("{}\n");
    expect(await readFile(join(desktopDir, "credential-source"), "utf8")).toBe("os\n");
  });

  it("prepares shared v2 credential-secret without setting ZCODE_CREDENTIALS_FILE on a clean headless host", async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const baseDir = await createTempDataBaseDir();
    setDataBaseDir(baseDir);

    const sharedCredentialsPath = join(getAppConfigDir(), "credentials.json");
    const preparedPath = await prepareEntryHttpCredentials();
    expect(preparedPath).toBe(sharedCredentialsPath);
    expect(process.env[ZCODE_CREDENTIALS_FILE_ENV]).toBeUndefined();
    expect(getCredentialsFilePath()).toBe(sharedCredentialsPath);

    const brokenKeyring = unavailableKeyStore();
    const serverCipher = await createServerCredentialCipher({
      filePath: getCredentialsFilePath(),
      env: {},
      keyStore: brokenKeyring.store,
    });
    expect(brokenKeyring.calls).toEqual({ get: 0, set: 0 });
    const encrypted = await serverCipher.encrypt("headless-secret");
    expect(await serverCipher.decrypt(encrypted)).toBe("headless-secret");
    await expect(stat(join(getZCodeDataRootDir(), "server", "credentials"))).rejects.toHaveProperty(
      "code",
      "ENOENT",
    );
  });

  it("preserves an explicitly pre-assigned ZCODE_CREDENTIALS_FILE", async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const baseDir = await createTempDataBaseDir();
    setDataBaseDir(baseDir);

    const customDir = join(baseDir, "custom-creds");
    await mkdir(customDir, { recursive: true });
    const customFile = join(customDir, "credentials.json");
    process.env[ZCODE_CREDENTIALS_FILE_ENV] = customFile;

    const preparedPath = await prepareEntryHttpCredentials();
    expect(preparedPath).toBe(customFile);
    expect(process.env[ZCODE_CREDENTIALS_FILE_ENV]).toBe(customFile);
    expect((await stat(join(customDir, "credential-secret"))).isFile()).toBe(true);
  });
});
