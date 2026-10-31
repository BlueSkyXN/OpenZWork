import { loadEndpointEnv } from "./load-endpoint-env.mjs";
const endpointEnv = await loadEndpointEnv();
// 净化裁决：上游闭源树在此处内置内网机器默认值；开源树按上游开源语义保留空默认，
// 由 .env 的 INTRANET_MACHINE_HOST / ZCODE_DEPS_BASE_URL 提供。测试闭源语义时以
// 保留的 intranet.example.invalid 占位域表示（与 remoteCdn.ts 测试常量同口径），不引入真实内网地址。
export const DEFAULT_INTRANET_MACHINE_HOST = "";
export function resolveIntranetMachineHost(env = { ...endpointEnv, ...process.env }) {
  // 自建镜像机器地址统一从 INTRANET_MACHINE_HOST 读取，避免多处硬编码漏改。
  return env.INTRANET_MACHINE_HOST?.trim() || DEFAULT_INTRANET_MACHINE_HOST;
}

export const INTRANET_MACHINE_HOST = resolveIntranetMachineHost();
export const INTRANET_ASSET_SERVICE_PORT = 12345;
export const INTRANET_ASSET_BASE_URL = INTRANET_MACHINE_HOST
  ? `http://${INTRANET_MACHINE_HOST}:${INTRANET_ASSET_SERVICE_PORT}/zcode`
  : "";
export const INTRANET_DEPS_BASE_URL = INTRANET_ASSET_BASE_URL
  ? `${INTRANET_ASSET_BASE_URL}/deps`
  : "";

export function resolveIntranetDepsBaseUrl(env = process.env) {
  env = { ...endpointEnv, ...env };
  const depsBaseUrl = env.ZCODE_DEPS_BASE_URL?.trim();
  if (depsBaseUrl) {
    return depsBaseUrl.replace(/\/+$/, "");
  }

  const host = resolveIntranetMachineHost(env);
  if (!host)
    throw new Error(
      "Configure ZCODE_DEPS_BASE_URL or INTRANET_MACHINE_HOST in .env before downloading internal dependencies",
    );
  return `http://${host}:${INTRANET_ASSET_SERVICE_PORT}/zcode/deps`;
}
