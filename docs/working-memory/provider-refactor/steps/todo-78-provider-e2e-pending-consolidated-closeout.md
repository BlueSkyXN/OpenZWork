# Todo 78：Provider 相关 Desktop E2E 欠测统一收口

> 当前状态（2026-09-09）：本验证 Todo 已关闭，剩余事项由 [Todo102](todo-102-verification-debt-closeout.md) 唯一承接，不再独立排期。下文状态及失败为历史记录，关闭不表示原失败已通过。

> 状态：已完成（Air 已收口可执行回归；闲时任务保留明确 fixture/Account entitlement 阻塞）
>
> 日期：2026-09-04
>
> 执行环境：MacBook Air 的独立干净工作树 `/Users/dev/Desktop/projects/z-code-e2e`；所有后续 Provider/Desktop E2E 暂时统一在该机器执行。

> 基线：以同步到该工作树的当前待验证提交为准，不复用 Air 原有 `z-code` 目录中的旧提交或未提交改动。

## 1. 目的

把此前分散在 Todo 34、40、62、73、75、77 以及闲时任务相关 Todo 中的“待 Mac 实跑”统一到这里。后续只以本 Todo 的列表判断欠测，不在旧 Todo 中重复排期。

本 Todo 只负责 Desktop 图形 E2E 的真实运行、失败定位和必要修复；不重新打开已经有通过证据的核心 Provider/Conversation E2E，也不把静态 typecheck、fixture check 或构建成功当作图形 E2E 通过。

## 2. 本轮已发现的失败

| 用例                                  | 当前结果 | 直接现象                                                           | 后续处理                                                           |
| ------------------------------------- | -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `MP-UI-06` 模型设置推理档位与 Mapping | 失败     | 测试期待英文“Model capabilities”，运行语言为中文，实际为“模型能力” | 核对用例是否应按当前语言断言；若只是断言错误，改测试，不改产品文案 |
| `QR-E2E-09` 首次机会提醒              | 失败     | 页面没有机会徽标、提醒或对应请求                                   | 检查机会数据注入和显示条件；确认 fixture 后再决定改测试还是修产品  |
| `QR-E2E-10` 临期机会提醒              | 失败     | 页面没有临期提醒或对应请求                                         | 与 QR-E2E-09 一起定位，避免各写一套准备逻辑                        |
| `SE-01` Subagent 创建/编辑持久化      | 失败     | 生成的 Subagent Markdown 与表单内容不一致                          | 核对当前表单和持久化语义，确认测试是否仍使用旧字段或旧目录快照     |
| `SE-02` Subagent 默认 effort          | 失败     | 未操作默认 effort 仍写入 `agents-state.json`                       | 对照当前产品语义判断是实际回归还是旧测试预期                       |
| `SE-03` 删除已选模型                  | 失败     | 生成的 Subagent Markdown 与表单内容不一致                          | 与 SE-01 共用定位结果，避免单独增加兼容分支                        |

原记录的 30 个通过、10 个失败、1 个跳过来自迁移前的汇总，不能直接作为当前基线结果。

2026-09-05 在 MacBook Air 独立工作树完成的首轮结果：

- 设置页 `settings-ui-polish.test.ts`：7 passing、1 skipped。期间清理了旧的语言、模型启用行、能力数量和默认值断言；没有修改产品代码。
- Repo Wiki 设置与生成：2 个 spec 均通过。
- 闲时任务 3 个 spec：均停在创建入口/工作区前置，尚未进入业务断言；具体是灰度入口未出现和工作区未切换。
- Subagent 设置：进入业务断言但 3 项失败，分别涉及 Markdown 字段快照和未操作默认 effort 是否写入状态；需要按当前持久化契约继续核对。
- QR opportunity 全量用例尚未形成有效结果；Air 上一次运行被残留 Electron E2E 进程阻塞，清理后需单独重跑。

2026-09-05 在清理残留进程后补跑了 QR 与 Subagent：

- `coding-plan-team-usage.test.ts`：16 passing、QR-E2E-09/10 失败。两项都已进入 Composer，但当前页面没有 Context usage trigger、机会徽标或 reminder；暂不修改产品代码，保留为 QR 机会数据/展示条件的独立欠测。
- Subagent `settings-subagent-create-edit-persistence.test.ts`：原测试使用了旧的 `model`/`thoughtLevel` Markdown 快照。已按当前 `modelSelection` 序列化契约更新测试，并取消错误的 `skipProvider` 前置；SE-01 已通过。SE-02 原预期与当前设计相反：切换模型会物化该模型的 catalog 默认 reasoning（本轮验证得到 `max`），已改为验证这一语义；SE-03 在独立运行时仍因模型删除入口未找到目标模型而阻塞，需后续补充 UI 诊断后再决定是否是定位器问题。
- 闲时任务 3 个 spec：即使单独运行仍停在灰度创建入口前置，未进入业务断言；当前记录为 E2E fixture/Account Provider 可用性阻塞，不修改闲时业务代码。

2026-09-05 在 Air 上再次运行 Subagent spec（同步最新测试 helper 后）：

- `settings-subagent-create-edit-persistence.test.ts`：3/3 通过。
- 本次只修正了 E2E 契约：模型行当前由带 `data-testid` 的文本元素展示，删除 helper 同时读取文本内容和 input value；无显式 reasoning 时按当前设计物化最高档 `max`。没有修改产品运行时代码。
- SE-03 的通过结果确认删除已选模型后，Subagent 仍保留历史模型文案且不恢复候选；此前失败属于测试定位器和旧断言，不是 Provider/Registry 产品回归。

2026-09-05 在 Air 上再次运行 `coding-plan-team-usage.test.ts`（补充 CTP-02B 后）：

- `desktop-e2e-20260905-051133-051`：19/19 通过。

## 3. 从旧 Todo 收口的范围

### 3.1 已关闭

- Todo 34：Repo Wiki 三个正式 E2E 已在本基线通过。
- Todo 62、75、77：模型设置、Template 创建和推理档位相关图形 E2E 统一由 `settings-ui-polish.test.ts` 覆盖；当前只剩 `MP-UI-06` 的语言断言问题。

### 3.2 已记录的剩余环境阻塞

- Todo 73：已由 CTP-02B 独立覆盖并在 Air 上通过；不再作为欠测项重复排期。
- Todo 09 及闲时任务相关收口：三个 spec 因入口灰度/mock 未命中而未进入业务断言，按上表保留为 fixture/Account entitlement 阻塞。
- Subagent 设置持久化：SE-01～03 已在 Air 上通过；不再作为欠测项重复排期。

此前 Todo 57 已记录的 45 条 Provider/Conversation macOS 运行证据继续有效；真实 SSH Remote 用例仍因缺少凭据保持 blocked，不在本 Todo 伪造通过。

## 4. 执行顺序

1. 先处理不涉及产品语义的测试前置或语言断言，并独立运行确认。
2. 再定位 QR 与闲时任务的 mock/灰度数据，确认是测试准备问题还是产品显示条件变化。
3. 最后核对已补跑的 Subagent 持久化与 Todo 73 侧栏用例结果；只有证据明确时才改生产代码。
4. 每组结束后复查失败是否真正进入业务断言、是否引入新的 Provider/Selection 分支，再进入下一组。
5. 最终在 MacBook Air 的独立工作树重新执行本 Todo 列出的所有用例，并记录通过、失败、跳过和环境阻塞；未解决项目必须保留原因。

## 5. 验收门槛

- 本 Todo 中每个用例都有独立的 MacBook Air WDIO 结果，或明确记录前置阻塞。
- 测试失败、测试前置未命中和环境阻塞分开记录。
- 不因让断言变绿而改变 Provider、Registry、Overlay 或模型选择语义。
- 如修改了交互代码，补齐对应 Desktop E2E，并运行受影响单测、`pnpm typecheck` 和 `pnpm lint`。
- 完成后将旧 Todo 中“待 Mac 实跑”的描述改为指向本 Todo，避免重复欠测清单。

## 6. 当前执行条件记录（2026-09-04）

- 当前代码工作区为 Linux；正式 Desktop E2E 统一使用 MacBook Air 独立工作树，不复用 Air 原有 `z-code` 目录。
- 不把 Linux 静态检查或旧提交结果冒充图形证据；真实 SSH Remote 用例仍按 Todo 57 的凭据阻塞记录处理。
