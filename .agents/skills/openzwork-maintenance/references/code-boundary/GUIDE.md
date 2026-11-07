# 代码边界：OpenZWork 功能与上游代码

目标是让合入上游时冲突尽量少，冲突出现时能看出哪些行属于 OpenZWork。

## 新增功能

1. 先用 `pnpm architecture:check --changed` 和 `pnpm architecture:context <模块>` 确定归属模块，遵守 `.agents/skills/architecture-governance/`。
2. 功能代码放在新文件或新模块中。上游文件里只保留接入所需的改动：注册、调用入口、类型字段、i18n 键等。
3. 每个上游文件中的接线处加注释 `OpenZWork(<台账编号>): <原因>`，例如 `// OpenZWork(OZ-F002): 注入系统提示词设置入口`。同一处的多行改动只标一次。
4. 修复上游缺陷时按 `docs/openzwork/patches/downstream-patch-registry.md` 登记 `OW-Pxxx`，并在修复处和回归处加编号标记。
5. 在台账条目中登记：新文件写入 `paths`，接线的上游文件写入 `hooks`，回归测试写入 `tests`。

## 与上游共用的组件、store 和函数

前端设置页、侧栏、会话面板等区域常由上游组件、Zustand store 和协议类型共同承载。

- 查调用关系：`pnpm dep:refs --list-exports <文件>`；查产品层面的关联：`.agents/skills/feature-boundary-planner/references/zcode-feature-graph.yaml`。
- 扩展上游组件时，优先新建包装组件或插槽；只有包装无法实现时才改上游组件本身。
- 功能依赖但未修改的上游文件（共用 store、协议字段、公共 hook）也写入台账的 `hooks`。合入上游时，`pnpm openzwork:scan --upstream` 会列出这些文件的上游改动。
- 改动上游的状态所有者或协议时，按根 `AGENTS.md` 先更新 spec，并写明所有者与事件顺序。

## 修改上游文件时

- 只改行为必需的行；不格式化、不调整 import 顺序、不改无关注释。
- 用户级数据根只用 `.openzwork`，项目级配置目录保持 `.zcode`。
- 提交后执行 `pnpm openzwork:scan --check`，确认没有产生只差格式化的文件。

## 存量

已有的 `OpenZWork 净化：`、`OpenZWork：`、`Bugfix（…）` 等标记写法，在下次修改该处时改为上面的统一格式。没有标记的存量改动，按 `pnpm openzwork:scan --list upstream-modified --unclaimed` 逐步补登到台账。
