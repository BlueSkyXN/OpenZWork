import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createSystemCredentialCipher,
  type CredentialKeyStore,
} from "@zcode/shared/credential-security";
import type { CopiedDataRootCredentialKeyStores } from "#src/main/desktopDataBaseDirBootstrap.js";

// 独立复核 F1 回归（2026-11-15）：覆盖 Main 实际装配的启动门禁凭据密钥共享。
// 被验证对象是真实装配函数 shareCopiedDataRootCredentialKey（main/index.ts 注入
// applyPendingDataBaseDirMigration 的同一函数）+ 真实迁移提交链；只把系统密钥库替换为
// 显式注入的内存 keyStore（cipher 的公开注入面），share 回调不做任何 stub。
// 旧缺陷形态：Main 把 cipher 绑定到目标凭据路径再向同一路径 share，同路径短路使目标
// 密钥条目零写入，复制后的密文解不开（CREDENTIAL_SECURE_STORAGE_UNAVAILABLE）。

const envKeys = ["HOME", "ZCODE_DESKTOP_HOME_DIR", "ZCODE_DATA_BASE_DIR"] as const;
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const roots: string[] = [];

async function temp() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openzwork-credential-migration-")));
  roots.push(root);
  return root;
}

function countingKeyStore(initial: string | null = null): {
  calls: { get: number; set: number };
  saved: () => string | null;
  store: CredentialKeyStore;
} {
  let saved = initial;
  const calls = { get: 0, set: 0 };
  return {
    calls,
    saved: () => saved,
    store: {
      get: async () => {
        calls.get += 1;
        return saved;
      },
      set: async (key: string) => {
        calls.set += 1;
        saved = key;
      },
    },
  };
}

// 独立复核 G1（2026-11-15）：真实 systemKeyStore 的系统条目按 resolve(凭据路径) 分条目，
// 不归并符号链接别名。替身按同一规则命名：共享与重启读取各自按真实路径取库，
// 不能共用一个固定 targetStore——那会把「登记到别名条目」掩盖成通过。
function perPathKeyStore() {
  const saved = new Map<string, string>();
  const storeFor = (file: string): CredentialKeyStore => ({
    get: async () => saved.get(resolve(file)) ?? null,
    set: async (key) => {
      saved.set(resolve(file), key);
    },
  });
  const hasEntry = (file: string) => saved.has(resolve(file));
  return { saved, storeFor, hasEntry };
}

type MigrationServices = typeof import("@zcode/services/node");
type MigrationBootstrap = typeof import("#src/main/desktopDataBaseDirBootstrap.js");

async function runtime(): Promise<{
  home: string;
  services: MigrationServices;
  bootstrap: MigrationBootstrap;
}> {
  const home = await temp();
  process.env.HOME = home;
  process.env.ZCODE_DESKTOP_HOME_DIR = home;
  delete process.env.ZCODE_DATA_BASE_DIR;
  vi.resetModules();
  // 同一 specifier 保证 setDataBaseDir 单例与 settingService/迁移实现共享同一实例。
  const services = (await import("@zcode/services/node")) as MigrationServices;
  const bootstrap =
    (await import("#src/main/desktopDataBaseDirBootstrap.js")) as MigrationBootstrap;
  services.setDataBaseDir(home);
  await mkdir(join(home, ".openzwork", "v2"), { recursive: true });
  return { home, services, bootstrap };
}

/** 源根按真实登录形态准备：os 来源标记 + 系统条目（注入库）密文。 */
async function seedSourceLogin(home: string, sourceStore: { store: CredentialKeyStore }) {
  const credentialsPath = join(home, ".openzwork", "v2", "credentials.json");
  const sourceCipher = createSystemCredentialCipher({
    filePath: credentialsPath,
    env: {},
    keyStore: sourceStore.store,
  });
  const token = await sourceCipher.encrypt("source-login");
  await writeFile(credentialsPath, JSON.stringify({ token }));
  return { sourceCipher, credentialsPath, token };
}

// 只注入密钥库替身；路径绑定、真实 cipher 与共享执行全部是被验证的生产装配。
const shareWith =
  (bootstrap: MigrationBootstrap, stores: CopiedDataRootCredentialKeyStores) =>
  (plan: { sourceBaseDir: string; targetBaseDir: string }) =>
    bootstrap.shareCopiedDataRootCredentialKey(plan, stores);

// G1 别名场景的共享入口：keyStore 按 plan 实际传入的凭据路径取对应条目库，
// 真实装配/真实迁移链不变——修复前 target 传别名即登记到别名条目、重启读 canonical
// 条目为空（CREDENTIAL_SECURE_STORAGE_UNAVAILABLE）。
const shareWithPerPathStores =
  (bootstrap: MigrationBootstrap, stores: ReturnType<typeof perPathKeyStore>) =>
  async (plan: { sourceBaseDir: string; targetBaseDir: string }) => {
    const credentialsPath = (baseDir: string) =>
      join(baseDir, ".openzwork", "v2", "credentials.json");
    await bootstrap.shareCopiedDataRootCredentialKey(plan, {
      sourceKeyStore: stores.storeFor(credentialsPath(plan.sourceBaseDir)),
      targetKeyStore: stores.storeFor(credentialsPath(plan.targetBaseDir)),
    });
    return plan.targetBaseDir;
  };

afterEach(async () => {
  for (const key of envKeys) {
    const original = originalEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("registers the planned source key at the target root so the copied credentials decrypt there and at the source", async () => {
  const { home, services, bootstrap } = await runtime();
  const target = await temp();
  const sourceStore = countingKeyStore();
  const targetStore = countingKeyStore();
  const { credentialsPath, token } = await seedSourceLogin(home, sourceStore);
  const service = services.createSettingService();
  await service.update({ locale: "en-US", dataBaseDir: home });
  await service.updateDataBaseDir(target);

  await services.applyPendingDataBaseDirMigration(undefined, {
    shareCredentialKeyWithDataRoot: shareWith(bootstrap, {
      sourceKeyStore: sourceStore.store,
      targetKeyStore: targetStore.store,
    }),
  });

  const committed = await services.createSettingService().get();
  expect(committed.dataBaseDir).toBe(target);
  expect(committed.pendingDataBaseDirMigration).toBeUndefined();
  // F1 缺陷判别：目标条目恰好写入一次（旧装配同路径短路为 0 次）。
  expect(targetStore.calls.set).toBe(1);

  // 目标新实例可解密复制后的密文，并能完成新的登录往返。
  const targetCipher = createSystemCredentialCipher({
    filePath: join(target, ".openzwork", "v2", "credentials.json"),
    env: {},
    keyStore: targetStore.store,
  });
  const copiedToken = JSON.parse(
    await readFile(join(target, ".openzwork", "v2", "credentials.json"), "utf8"),
  ).token as string;
  expect(await targetCipher.decrypt(copiedToken)).toBe("source-login");
  expect(await targetCipher.decrypt(await targetCipher.encrypt("relogin"))).toBe("relogin");
  // 旧源仍可读（切回/核对合同）。
  expect(await sourceCipherOf(credentialsPath, sourceStore.store).decrypt(token)).toBe(
    "source-login",
  );
});

function sourceCipherOf(credentialsPath: string, store: CredentialKeyStore) {
  return createSystemCredentialCipher({ filePath: credentialsPath, env: {}, keyStore: store });
}

// 独立复核 G1（2026-11-15）正向回归：已登录＋目标符号链接别名。迁移提交的是 canonical
// 目标（copyDataDirectory 按 realpath 执行），共享密钥必须登记到同一条目名下，新实例按
// 持久化 dataBaseDir 才能解密；别名名下不得出现凭空条目。
it("shares the key to the committed canonical target when the user picked a symlink alias", async () => {
  const { home, services, bootstrap } = await runtime();
  const taskRoot = await temp();
  const destination = join(taskRoot, "destination");
  const alias = join(taskRoot, "destination-alias");
  await mkdir(destination);
  await symlink(destination, alias, "dir");
  const stores = perPathKeyStore();
  const sourceCredentials = join(home, ".openzwork", "v2", "credentials.json");
  const { token } = await seedSourceLogin(home, {
    store: stores.storeFor(sourceCredentials),
  });
  const service = services.createSettingService();
  await service.update({ locale: "en-US", dataBaseDir: home });
  await service.updateDataBaseDir(alias);

  let sharedTarget: string | undefined;
  await services.applyPendingDataBaseDirMigration(undefined, {
    shareCredentialKeyWithDataRoot: async (plan) => {
      sharedTarget = await shareWithPerPathStores(bootstrap, stores)(plan);
    },
  });

  // 提交指针与共享目标是同一条目名：canonical 目标，不是用户输入的别名。
  const committed = await services.createSettingService().get();
  expect(committed.dataBaseDir).toBe(destination);
  expect(committed.pendingDataBaseDirMigration).toBeUndefined();
  expect(sharedTarget).toBe(destination);

  // 新实例按持久化 dataBaseDir 命名取条目可解密（修复前该条目为空）。
  const canonicalCredentials = join(destination, ".openzwork", "v2", "credentials.json");
  const copiedToken = JSON.parse(await readFile(canonicalCredentials, "utf8")).token as string;
  const targetCipher = createSystemCredentialCipher({
    filePath: canonicalCredentials,
    env: {},
    keyStore: stores.storeFor(canonicalCredentials),
  });
  expect(await targetCipher.decrypt(copiedToken)).toBe("source-login");
  expect(await targetCipher.decrypt(await targetCipher.encrypt("relogin"))).toBe("relogin");
  // 条目确实写在 canonical 名下；别名名下没有条目（别名不是密钥 owner 的命名）。
  expect(stores.hasEntry(canonicalCredentials)).toBe(true);
  expect(stores.hasEntry(join(alias, ".openzwork", "v2", "credentials.json"))).toBe(false);
  // 旧源仍按原命名可读（切回/核对合同）。
  expect(
    await sourceCipherOf(sourceCredentials, stores.storeFor(sourceCredentials)).decrypt(token),
  ).toBe("source-login");
});

it("keeps the pointer and the plan when the source key is unavailable, and a retry after recovery commits", async () => {
  const { home, services, bootstrap } = await runtime();
  const target = await temp();
  const sourceStore = countingKeyStore();
  const targetStore = countingKeyStore();
  await seedSourceLogin(home, sourceStore);
  const service = services.createSettingService();
  await service.update({ locale: "en-US", dataBaseDir: home });
  await service.updateDataBaseDir(target);

  // 系统库不可用（注入库读取失败）；真实装配与真实迁移链不得把失败吞成成功。
  const lockedSourceStore: CredentialKeyStore = {
    get: async () => {
      throw new Error("keyring locked");
    },
    set: async () => {
      throw new Error("keyring locked");
    },
  };
  await expect(
    services.applyPendingDataBaseDirMigration(undefined, {
      shareCredentialKeyWithDataRoot: shareWith(bootstrap, {
        sourceKeyStore: lockedSourceStore,
        targetKeyStore: targetStore.store,
      }),
    }),
  ).rejects.toMatchObject({ code: "CREDENTIAL_SECURE_STORAGE_UNAVAILABLE" });

  const aborted = await services.createSettingService().get();
  expect(aborted.dataBaseDir).toBe(home);
  expect(aborted.pendingDataBaseDirMigration?.targetBaseDir).toBe(target);
  expect(targetStore.calls.set).toBe(0);

  // 恢复后重试：已发布副本走 republish 提交路径，共享成功后指针提交。
  await services.applyPendingDataBaseDirMigration(undefined, {
    shareCredentialKeyWithDataRoot: shareWith(bootstrap, {
      sourceKeyStore: sourceStore.store,
      targetKeyStore: targetStore.store,
    }),
  });
  const committed = await services.createSettingService().get();
  expect(committed.dataBaseDir).toBe(target);
  expect(committed.pendingDataBaseDirMigration).toBeUndefined();
  expect(targetStore.calls.set).toBe(1);
});

it("refuses to overwrite a different key already registered at the target and keeps the plan until the entry is cleared", async () => {
  const { home, services, bootstrap } = await runtime();
  const target = await temp();
  const sourceStore = countingKeyStore();
  // 目标条目已有另一把合法密钥（历史残留/受影响根形态）；目标密文随复制来自源。
  const targetStore = countingKeyStore(Buffer.alloc(32, 9).toString("base64url"));
  const { credentialsPath, token } = await seedSourceLogin(home, sourceStore);
  const service = services.createSettingService();
  await service.update({ locale: "en-US", dataBaseDir: home });
  await service.updateDataBaseDir(target);

  await expect(
    services.applyPendingDataBaseDirMigration(undefined, {
      shareCredentialKeyWithDataRoot: shareWith(bootstrap, {
        sourceKeyStore: sourceStore.store,
        targetKeyStore: targetStore.store,
      }),
    }),
  ).rejects.toMatchObject({ code: "CREDENTIAL_SECURE_STORAGE_UNAVAILABLE" });
  expect(targetStore.calls.set).toBe(0);
  const refused = await services.createSettingService().get();
  expect(refused.dataBaseDir).toBe(home);
  expect(refused.pendingDataBaseDirMigration?.targetBaseDir).toBe(target);

  // 条目清空（补救后）重试成功，登记的是源密钥。
  const clearedTargetStore = countingKeyStore();
  await services.applyPendingDataBaseDirMigration(undefined, {
    shareCredentialKeyWithDataRoot: shareWith(bootstrap, {
      sourceKeyStore: sourceStore.store,
      targetKeyStore: clearedTargetStore.store,
    }),
  });
  const committed = await services.createSettingService().get();
  expect(committed.dataBaseDir).toBe(target);
  expect(clearedTargetStore.calls.set).toBe(1);
  const copiedToken = JSON.parse(
    await readFile(join(target, ".openzwork", "v2", "credentials.json"), "utf8"),
  ).token as string;
  expect(
    await sourceCipherOf(
      join(target, ".openzwork", "v2", "credentials.json"),
      clearedTargetStore.store,
    ).decrypt(copiedToken),
  ).toBe("source-login");
  expect(await sourceCipherOf(credentialsPath, sourceStore.store).decrypt(token)).toBe(
    "source-login",
  );
});

it("does not touch any key store when the source never logged in, and still commits the pointer", async () => {
  const { home, services, bootstrap } = await runtime();
  const target = await temp();
  const sourceStore = countingKeyStore();
  const targetStore = countingKeyStore();
  const service = services.createSettingService();
  await service.update({ locale: "en-US", dataBaseDir: home });
  await service.updateDataBaseDir(target);

  await services.applyPendingDataBaseDirMigration(undefined, {
    shareCredentialKeyWithDataRoot: shareWith(bootstrap, {
      sourceKeyStore: sourceStore.store,
      targetKeyStore: targetStore.store,
    }),
  });

  const committed = await services.createSettingService().get();
  expect(committed.dataBaseDir).toBe(target);
  expect(committed.pendingDataBaseDirMigration).toBeUndefined();
  expect(sourceStore.calls.get).toBe(0);
  expect(targetStore.calls.get).toBe(0);
  expect(targetStore.calls.set).toBe(0);
});

// 复制语义对齐守卫：确保本文件假定的「整目录复制、保留来源标记」与真实迁移一致。
it("copies the credential-source marker so the target keeps the os source binding", async () => {
  const { home, services, bootstrap } = await runtime();
  const target = await temp();
  const sourceStore = countingKeyStore();
  const targetStore = countingKeyStore();
  await seedSourceLogin(home, sourceStore);
  const service = services.createSettingService();
  await service.update({ locale: "en-US", dataBaseDir: home });
  await service.updateDataBaseDir(target);

  await services.applyPendingDataBaseDirMigration(undefined, {
    shareCredentialKeyWithDataRoot: shareWith(bootstrap, {
      sourceKeyStore: sourceStore.store,
      targetKeyStore: targetStore.store,
    }),
  });

  const marker = await readFile(join(target, ".openzwork", "v2", "credential-source"), "utf8");
  expect(marker).toBe(await readFile(join(home, ".openzwork", "v2", "credential-source"), "utf8"));
  expect(marker).toBe("os\n");
});

// OZ-C009 + P1-1 回归：源目录已有 OS 密文与 "os\n" 标记，且源 cipher 已缓存密钥；随后恢复代次变化、
// Linux 私有文件密钥回退开启、同时系统钥匙串变为不可读（锁屏/未解锁）。迁移读取源密钥触发代际重读时，
// getKey(false, allowAutoReset=false) 递归必须保留 allowAutoReset=false，绝不把源 credentials.json
// 自动清空为 "{}\n" 或生成 .bak、删除 credential-source。
it("preserves OS-bound source credentials when generation changes and keyring locks under private-file fallback", async () => {
  const { home, services, bootstrap } = await runtime();
  const credentialSecurity = await import("@zcode/shared/credential-security");
  const onReset = vi.fn();
  expect(credentialSecurity.enablePrivateFileKeyFallback({ onReset })).toBe(true);

  const target = await temp();
  let savedKey: string | null = null;
  let keyringLocked = false;
  const calls = { get: 0, set: 0 };
  const sourceKeyStore: CredentialKeyStore = {
    get: async () => {
      calls.get += 1;
      if (keyringLocked) {
        throw new Error("GNOME Keyring locked");
      }
      return savedKey;
    },
    set: async (value: string) => {
      calls.set += 1;
      savedKey = value;
    },
  };
  const targetStore = countingKeyStore();

  const sourceV2Dir = join(home, ".openzwork", "v2");
  const credentialsPath = join(sourceV2Dir, "credentials.json");
  const sourceMarkerPath = join(sourceV2Dir, "credential-source");
  const sourceCipher = credentialSecurity.createSystemCredentialCipher({
    filePath: credentialsPath,
    env: {},
    keyStore: sourceKeyStore,
  });

  // 1) 源目录写入 OS 密文与 "os\n" 标记，并通过先期读取确认密钥已缓存在同一 keyStore 桶内。
  const token = await sourceCipher.encrypt("source-login");
  const originalCredentialsRaw = `${JSON.stringify({ token }, null, 2)}\n`;
  await writeFile(credentialsPath, originalCredentialsRaw);
  expect(await readFile(sourceMarkerPath, "utf8")).toBe("os\n");
  const getCallsAfterSeed = calls.get;
  expect(await sourceCipher.decrypt(token)).toBe("source-login");
  expect(calls.get).toBe(getCallsAfterSeed);

  const service = services.createSettingService();
  await service.update({ locale: "en-US", dataBaseDir: home });
  await service.updateDataBaseDir(target);

  // 2) 磁盘恢复代次变化，使已缓存密钥在下次 getKey 时走代际失效递归分支。
  await writeFile(`${credentialsPath}.recovery-generation`, "generation-after-bump");

  // 3) 迁移执行时源钥匙串不可读（get() 抛错，诊断阶段为 read）。
  keyringLocked = true;
  await expect(
    services.applyPendingDataBaseDirMigration(undefined, {
      shareCredentialKeyWithDataRoot: shareWith(bootstrap, {
        sourceKeyStore,
        targetKeyStore: targetStore.store,
      }),
    }),
  ).rejects.toMatchObject({ code: "CREDENTIAL_SECURE_STORAGE_UNAVAILABLE" });

  // 等待后台微任务/文件锁排空，确认 pendingKey.catch 未调度 resetBoundCredentialStore。
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));

  // 4) 确认发生了代际重读，但迁移安全中止，且源凭据原件、无 .bak 与来源标记完整保留。
  expect(calls.get).toBeGreaterThan(getCallsAfterSeed);
  expect(onReset).not.toHaveBeenCalled();
  expect(targetStore.calls.set).toBe(0);
  expect(await readFile(credentialsPath, "utf8")).toBe(originalCredentialsRaw);
  expect(await readFile(sourceMarkerPath, "utf8")).toBe("os\n");
  const sourceEntries = await readdir(sourceV2Dir);
  expect(sourceEntries.filter((name) => name.includes(".bak"))).toEqual([]);

  const aborted = await services.createSettingService().get();
  expect(aborted.dataBaseDir).toBe(home);
  expect(aborted.pendingDataBaseDirMigration?.targetBaseDir).toBe(target);
});
