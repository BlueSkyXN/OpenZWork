# 代码边界：OpenZWork 功能与上游代码

目标是让合入上游时冲突尽量少，冲突出现时能看出哪些行属于 OpenZWork。

## 新增功能

1. 先用 `pnpm architecture:check --changed` 和 `pnpm architecture:context <模块>` 确定归属模块，遵守 `.agents/skills/architecture-governance/`。
2. 功能代码放在新文件或新模块中。上游文件里只保留接入所需的改动：注册、调用入口、类型字段、i18n 键等。
3. 每个上游文件中的接线处加注释 `OpenZWork(<台账编号>): <原因>`，例如 `// OpenZWork(OZ-F002): 注入系统提示词设置入口`。同一处的多行改动只标一次。
4. 修复上游缺陷时按 `docs/openzwork/patches/downstream-patch-registry.md` 登记 `OW-Pxxx`，并在修复处和回归处加编号标记。
5. 在台账条目中登记：新文件写入 `paths`，接线的上游文件写入 `hooks`，回归测试写入 `tests`。至少一个回归测试要在核心 CI 中运行（见 `ledger` 子能力），用 `pnpm openzwork:scan --entries` 核对保证与接线面。

## 与上游共用的组件、store 和函数

前端设置页、侧栏、会话面板等区域常由上游组件、Zustand store 和协议类型共同承载。

- 查调用关系：`pnpm dep:refs --list-exports <文件>`；查产品层面的关联：`.agents/skills/feature-boundary-planner/references/zcode-feature-graph-openzwork.yaml`（OpenZWork 版本）。
- 扩展上游组件时，优先新建包装组件或插槽；只有包装无法实现时才改上游组件本身。
- 功能依赖但未修改的上游文件（共用 store、协议字段、公共 hook）也写入台账的 `hooks`。合入上游时，`pnpm openzwork:scan --upstream` 会列出这些文件的上游改动。
- 改动上游的状态所有者或协议时，按根 `AGENTS.md` 先更新 spec，并写明所有者与事件顺序。

## 修改上游文件时

- 只改行为必需的行；不格式化、不调整 import 顺序、不改无关注释。
- `.agents/skills/` 下上游技能的脚本不按本节修改，见 `docs-layout` 子能力。
- 用户级数据根只用 `.openzwork`，项目级配置目录保持 `.zcode`。
- 提交后执行 `pnpm openzwork:scan --check`，确认没有产生只差格式化的文件。
- 格式只检查自己新增的文件：`pnpm exec oxfmt --check <文件…>`。不对上游文件运行 oxfmt，也不运行全仓的 `pnpm fmt`。
- 提交前用 `git diff --stat <上游基准> -- <文件>` 看差异行数是否与实际改动相称（上游基准见台账 `upstream.commit`）。行数远大于改动，说明文件被整体格式化了，按下一节恢复。

## 恢复被整文件格式化的上游文件

上游文件在改动时被整文件格式化，或被其他工具改写了空白，与上游的差异就会远大于实质改动。门禁拦截格式化造成的差异达到 20 行且超过实质改动一半的文件；低于门槛的在下次修改该文件时一并恢复（经验 `OZK-PIT-014`）。

```bash
node .agents/skills/openzwork-maintenance/scripts/unformat.mjs [路径…]           # 列出噪声和可恢复到的差异行数
node .agents/skills/openzwork-maintenance/scripts/unformat.mjs --apply [路径…]   # 写入工作区
node .agents/skills/openzwork-maintenance/scripts/unformat.mjs --verify <提交>   # 核对该提交到 HEAD 只改了排版
```

工具以已提交的 HEAD 为准。先提交实质改动，再恢复排版，恢复单独成一个提交，便于用 `--verify` 复核。

工具的判定方式，手工处理时遵守同样的标准：

1. 量化噪声。取上游原文 B 和当前文件 H，分别用仓库的 oxfmt 格式化。噪声 = B 与 H 的差异行数 − 两份格式化结果的差异行数。我方给上游代码包了一层造成的缩进变化，格式化之后仍然存在，不计入噪声，也不恢复。
2. 生成恢复结果。依次尝试三种方法，取通过第 3、4 步且与上游差异最小的一个：
   - 三方合并：以格式化后的 B 为公共祖先，把实质改动合并到 B 上，冲突处保留 H 的写法；
   - 分段换回：格式化后的 B 中我方没有动过的段，换回对应的上游原文段；
   - 空白对齐：B 与 H 只差空白的行用 B，其余用 H。
3. 等价证明。恢复结果与 H 分别格式化后必须逐字节一致。不一致的结果不采用。
4. 不越界。恢复掉的行数不得超过第 1 步量出的噪声，否则说明把结构性缩进也换回去了。YAML 和 JSON 的缩进就是语义，由第 3 步保证，不受这条限制。
5. 没有任何方法通过时保持现状。需要手工恢复时，同样以第 3 步作为验收标准。
6. 恢复后照常执行类型检查、Lint、相关回归和 `pnpm openzwork:scan --check`。

## 存量

已有的 `OpenZWork 净化：`、`OpenZWork：`、`Bugfix（…）` 等标记写法，在下次修改该处时改为上面的统一格式。没有标记的存量改动不批量补登；修改到某处并确认它属于哪个条目时，再加标记并写入该条目的 `hooks`。
