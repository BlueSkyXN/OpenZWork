// 保留历史导出以兼容旧调用；这些常量不参与能力启用或环境注入。
export const WINDOWS_CUA_DEV_ROOT_ENV = "ZCODE_CUA_DEV_ROOT";
export const WINDOWS_CUA_PRODUCER_SEGMENTS = ["packages", "zcode-cua"];

/**
 * OpenZWork 的 CUA 环境解析为空占位，不为任何平台派生后端位置。
 * 保留函数参数兼容旧启动脚本，调用方 env 不作修改。
 */
export function resolveDevDesktopWindowsCuaEnv(_options = {}) {
  return {};
}
