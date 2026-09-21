/**
 * OpenZWork 用户级数据根目录名。
 *
 * 仅替换外层目录名以实现与官方版用户数据的命名空间隔离；内层目录布局（v2/、cli/、
 * server/ 等）、`ZCODE_*` 环境变量名与项目级 `.zcode/` 目录保持原状（决策 D-03）。
 */
export const OPENZWORK_DATA_DIR_NAME = ".openzwork";

/** 运行期应用显示名（Electron app name，userData 目录随之派生）。 */
export const OPENZWORK_APP_NAME = "OpenZWork";
export const OPENZWORK_APP_NAME_PREVIEW = "OpenZWork Preview";
export const OPENZWORK_APP_NAME_DEV = "OpenZWork Dev";
