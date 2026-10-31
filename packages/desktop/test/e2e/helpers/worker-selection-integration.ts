import type { ProjectRepositoryContract } from "../../../../services/src/project-storage/contract.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ModelSelectionViewInput } from "@zcode/provider";
import { NodeProviderRegistryRuntime, createNodeModelSelectionFacade } from "@zcode/provider-node";
import {
  createZCodeAgentService,
  createZCodeTaskServiceAdapter,
  getDataBaseDir,
  setDataBaseDir,
} from "@zcode/services/node";
import { TaskIndexRepo } from "../../../../services/src/session/taskIndexRepo.js";
import { createZCodeTaskIndexSyncer } from "../../../../services/src/zcode-agent/zcodeTaskIndexSyncer.js";
import { getE2EAppDataPaths } from "./desktop-app.js";

/** 独立测试 Host + 真实 stdio Worker；仅模型 HTTP 使用隔离 fixture。 */
export async function createWorkerSelectionIntegration(
  directory = "worker-selection-host",
  options: { workspacePath?: string; cliNodeArgs?: string[] } = {},
) {
  const paths = getE2EAppDataPaths();
  const home = join(paths.homeDir, directory);
  const workspacePath = options.workspacePath ?? join(home, "workspace");
  await mkdir(workspacePath, { recursive: true });
  const previousDataDir = getDataBaseDir();
  setDataBaseDir(home);
  const runtimePaths = {
    zcodeBuiltinFilePath: resolve("../../config/provider/zcode-builtin.json"),
    personalFilePath: join(home, ".zcode/v2/provider_config.json"),
  };
  // 独立 Host 不继承 Electron 设置。保持内建 HTTPS endpoint，
  // 将显式网络出口接到本轮数据面代理，避免假凭据直连或 HTTP 被官方请求安全校验拒绝。
  const httpProxy = process.env.ZCODE_HTTP_PROXY?.trim();
  const caCertFile = process.env.ZCODE_AGENT_CA_CERT?.trim();
  if (!httpProxy || !caCertFile) throw new Error("Worker 选择回归缺少隔离 HTTPS 数据面代理");
  await mkdir(join(home, ".zcode/cli"), { recursive: true });
  await writeFile(
    join(home, ".zcode/cli/config.json"),
    JSON.stringify({
      network: { httpProxy, caCertFile, noProxy: process.env.ZCODE_NO_PROXY },
    }),
  );
  // v3.17.1 同步净化：官方账号域（MutableAccountProviderConfigSource /
  // createFailClosedAccountProviderConfigSnapshot / accountSource / accountRequestAuthService）
  // 随 WP-04 账号链剥离；本夹具回归的会话重试/重发语义不依赖账号切换，
  // 模型选择走净化保留的 builtin + personal 两层配置。
  const runtime = new NodeProviderRegistryRuntime({
    ...runtimePaths,
    watch: false,
    personalPollingIntervalMs: false,
  });
  await runtime.start();
  const facade = createNodeModelSelectionFacade(runtime.registryService);
  const modelSelectionService = {
    getView: async (input?: ModelSelectionViewInput) => facade.getView(undefined, undefined, input),
    onDidChange: (listener: Parameters<typeof facade.onDidChange>[0]) => ({
      dispose: facade.onDidChange(listener),
    }),
  };
  const repo = new TaskIndexRepo();
  const projects: ProjectRepositoryContract = await repo.getProjectRepository();
  const agent = createZCodeAgentService({
    // 真实 Host 创建端口必须预留任务归属；旧夹具漏装配，Worker 启动前即报 creation-unavailable。
    prepareSessionCreation: async (target) => {
      const prepared = projects.reserveCreatedTask({
        task: { ...target, taskId: target.sessionId },
        projectId: target.projectId,
        creationCommand: target.creationCommand,
        additionalDirectories: target.additionalDirectories,
      });
      return { sessionId: prepared.taskId, additionalDirectories: prepared.additionalDirectories };
    },
    commandResolver: () => ({
      command: process.execPath,
      args: [
        ...(options.cliNodeArgs ?? []),
        resolve("../../apps/zcode-cli/packages/cli/dist/zcode.cjs"),
        "app-server",
        "--stdio",
      ],
      env: {
        HOME: home,
        USERPROFILE: home,
        ZCODE_DATA_BASE_DIR: home,
        ZCODE_RUNTIME_ENV: "development",
        ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: runtimePaths.zcodeBuiltinFilePath,
        ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: runtimePaths.personalFilePath,
      },
    }),
    modelSelectionReadinessSource: modelSelectionService,
  });
  const syncer = createZCodeTaskIndexSyncer({ agentService: agent, taskIndexRepo: repo });
  const task = createZCodeTaskServiceAdapter({
    zcodeAgentService: agent,
    taskIndexRepo: repo,
    taskIndexSyncer: syncer,
  });
  return {
    home,
    repo,
    projects,
    workspacePath,
    agent,
    task,
    modelSelectionService,
    async dispose() {
      syncer.disposeAll();
      await agent.disposeWorkspace({ workspacePath });
      await agent.disposeAllAndWait();
      repo.close();
      runtime.dispose();
      setDataBaseDir(previousDataDir);
    },
  };
}
