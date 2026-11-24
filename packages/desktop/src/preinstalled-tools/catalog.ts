import { readFile } from "node:fs/promises";
import {
  resolvePreinstalledToolsCatalog,
  type PreinstalledToolConfiguration,
} from "@zcode/shared/preinstalled-tools";
import preinstalledToolCatalog from "@desktop/preinstalled-tools/catalog.json" with { type: "json" };

declare const __ZCODE_PREINSTALL_TEST_BUILD__: boolean;

const PREINSTALLED_TOOLS_CDN_BASE_URL_ENV = "ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL";

/**
 * OpenZWork(OZ-C015)：不内置官方预装工具 CDN 默认基址（WP-08）。
 * 显式设置 ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL 时按书写顺序使用候选；未设置时返回空数组。
 */
function resolvePreinstalledToolsCdnBaseUrls(): string[] {
  const override = process.env[PREINSTALLED_TOOLS_CDN_BASE_URL_ENV]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return override?.length ? override : [];
}

/**
 * Main 只装配构建配置；Host 无需等待本次读取或工具初始化。
 * 返回 null 表示清单不可用：工具归属未知，预装进程不得按 catalog 回收任何入口或目录。
 * 修复原因：此前任何装配失败都在 Main 变成空列表，预装进程把它当作全部工具移出 catalog，
 * 撤销入口并删除已安装资源（含 Python 附加区）。
 */
type CatalogLogger = { error(...args: unknown[]): void };

export async function loadPreinstalledToolsCatalog(
  logger: CatalogLogger,
  platform = process.platform,
  arch = process.arch,
): Promise<PreinstalledToolConfiguration[] | null> {
  try {
    const catalog: unknown =
      typeof __ZCODE_PREINSTALL_TEST_BUILD__ !== "undefined" &&
      __ZCODE_PREINSTALL_TEST_BUILD__ &&
      process.env.ZCODE_E2E_PREINSTALLED_TOOLS_CATALOG
        ? JSON.parse(await readFile(process.env.ZCODE_E2E_PREINSTALLED_TOOLS_CATALOG, "utf8"))
        : preinstalledToolCatalog;
    const cdnBaseUrls = resolvePreinstalledToolsCdnBaseUrls();
    const { tools, downloadBaseUrlsError } = resolvePreinstalledToolsCatalog(
      catalog,
      platform,
      arch,
      cdnBaseUrls,
    );
    // OpenZWork(OZ-C015)：未设置 ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL 时 cdnBaseUrls 为空属预期状态，仅显式配置的值校验失败时记 error。
    if (cdnBaseUrls.length > 0 && downloadBaseUrlsError)
      logger.error(
        `[preinstalled-tools] invalid ${PREINSTALLED_TOOLS_CDN_BASE_URL_ENV}; all tools have no target`,
        downloadBaseUrlsError,
      );
    return tools;
  } catch (error) {
    logger.error("[preinstalled-tools] invalid static target configuration", error);
    return null;
  }
}

export function hasPreinstalledToolsDownloadTarget(tools: PreinstalledToolConfiguration[] | null): boolean {
  return tools?.some((tool) => tool.manifest !== null) ?? false;
}
