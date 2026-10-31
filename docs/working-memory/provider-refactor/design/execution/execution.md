# Model 执行与继承

本篇规定 Submission 进入 Core 后，各类执行如何取得、保持或切换 Model。Selection 状态见
[`../interaction/interaction.md`](../interaction/interaction.md)，Model 创建和鉴权见
[`../registry/model-creation.md`](../registry/model-creation.md)。

## 总原则

1. 一次执行先确定 ModelSelection，再从 Registry/ModelFactory 创建 Model。
2. 每个 Agent Loop 持有自己的 Active Model。
3. Active Model 创建后保持不可变，直到 Loop 结束或 Guide 在明确 Step 边界切换。
4. Automatic Compact 使用当前 Loop Active Model。
5. Subagent 根据最终 Selection 创建自己的 Model。
6. Background/Goal 的新主 Loop 使用启动时的 Session Selection。
7. 特殊执行只附加 Request Auth、Ticket、attribution 或 override，不携带 Provider/Model 静态 Config。

## 执行分类

| 执行              | Selection 来源                        | Model 生命周期      | Session Selection        |
| ----------------- | ------------------------------------- | ------------------- | ------------------------ |
| 普通 start-now    | 当前 Submission                       | 新 Agent Loop       | 接收时更新               |
| 普通 Queue drain  | Queue item 保存的 Submission          | 新 Agent Loop       | 接纳时已更新，出队不覆盖 |
| Guide / “立即”    | Guide Submission                      | 当前 Loop 后续 Step | Guide 接收时更新         |
| Automatic Compact | 当前 Loop Active Model                | 当前 Loop           | 不更新                   |
| 手动 Compact      | Compact Submission                    | 新 Loop             | 普通规则                 |
| Subagent          | override > Profile > Parent Selection | Child 生命周期      | 不更新父 Session         |
| Background        | 每轮启动时确定的 Selection            | 当前后台模型轮      | 不反向更新               |
| Goal continuation | 续轮发生时的 Session Selection        | 每轮新的主 Loop     | 不额外保存               |

## 普通 Agent Loop

```text
Core Submission
      |
      v
Registry / ModelFactory
      |
      v
Agent Loop Active Model
├─ Model Step 1
├─ Tool Batch
├─ Model Step 2
└─ Automatic Compact
```

Composer 切换、普通 Session 配置变化或 Registry 刷新不改变当前 Active Model。下一次创建 Model 时才读取
新配置。

## Guide / “立即”

Guide 是当前 Loop 内的明确切换事件：

```text
Active Loop: Model A
        +
Guide Submission: Selection B
        |
        v
Registry 创建 Model B 并完成 admission
        |
        v
Context 加入 Guide input
Session Selection A -> B
Active Model A -> B（下一个 Model Step）
```

已经发出的请求继续使用 A，后续 Step 和后续 Automatic Compact 使用 B。Context 注入、Session
Selection 更新和 Active Model 切换构成一次原子接收结果；任一步失败时完整 Guide 转入普通 Queue，
不能只提交其中一部分。

## Compact

### Automatic Compact

Automatic Compact 是当前 Loop 内部行为：

```text
Current Active Model
├─ same Provider/Model Config
├─ same Model properties and limits
├─ same bound options
└─ same request-time access context
        |
        v
Automatic Compact request
```

它不读取 Composer 或 Session Selection，不建立另一套 Provider/Capability DTO。Guide 切换后，后续
Automatic Compact 使用新 Active Model。

### 手动 Compact

手动 Compact 是新的 Submission/Loop，按自己的 Selection 创建 Model。它不继承已结束 Loop 的临时
执行上下文。

## Subagent

Subagent Selection 优先级固定：

```text
Core Server Submission override
        >
Subagent Profile Selection
        >
Parent Loop Active Selection
```

确定 Selection 后，Child 从 Registry 创建自己的 Model：

```text
Final Child Selection
        |
        v
Registry / ModelFactory
        |
        v
Child-owned Active Model
```

Fresh/Fork 定义 Context 初始化，Foreground/Background 定义调度，不改变模型继承规则。Core Server
override 是通用执行选项，可以要求本次 Submission 派生的所有 Child 使用指定 Selection；它不是闲时
专属字段，也不进入 Agent tool 的 provider-visible input。

普通 Profile 显式模型和 reasoning 继续按 Subagent 设置语义解析。Profile 没有模型时继承 Parent Active
Selection；Child 不共享 Parent 的同一个可变 Model 对象。

## Goal

Goal 每次自动续跑都是新的主 Agent Loop：

```text
Goal Loop 1 使用 Selection A
        |
用户普通 Submission 使用 Selection B
        |
Session Selection = B
        |
Goal Loop 2 启动
        `-- 使用 Selection B
```

Goal 不保存额外 continuation Selection。新的 Loop 使用续跑发生时的 Session Selection，并通过 Registry
创建新 Model。

## Background

Background 启动时创建自己的 Model，并在当前模型轮内保持；消息恢复或后台唤起的新轮读取当前 Session Selection：

```text
Turn 1: Selection A，启动 Background A
Turn 2: 用户 Submission 使用 Selection B
Background A 完成
Turn 3: 唤醒主 Agent，读取 Session Selection B
```

Background 自身继续使用 A；完成后只触发新的主 Loop。Background Model 不反向修改 Session Selection。

## 独立模型任务

Title、Repo Wiki、Memory、WebFetch/WebSearch 和其他一次性模型任务都应显式接收 ModelSelection 或
Model，不读取全局可变 Runtime Model。它们根据自己的产品语义选择：

- 属于当前 Loop：使用当前 Active Model；
- 独立执行：从明确 Selection 创建自己的 Model；
- 后续唤醒主 Loop：使用届时 Session Selection。

默认标题在入队时冻结所属执行和 Selection，独立保留闲时票据租约，直到生成/保存完成或早退、失败。显式标题模型按独立配置执行；无闲时归属的外部标题不借用临时闲时 Session Selection。

## 归因

每次 ModelRequest 的 Usage、Trace 和错误归因到实际 `providerId + modelId`。Compact、Subagent、Goal、
在事后归因到新的 Active Model。

## 不变量

- 一个 Loop 在任一 Model Step 只有一个 Active Model。
- Config/Composer 变化不热改 Active Model。
- Guide 只在 Step 边界原子切换。
- Automatic Compact 使用当前 Active Model。
- 每个 Subagent 创建自己的 Model。
- Goal/Background 不反向修改 Session Selection。
- 闲时选择只暂存 Session；持久化保留普通选择，用户接管后不被旧闲时收口覆盖。
- 闲时 permission response 后同一 Turn 继续使用 idle Model。
- 动态 Request Auth/Ticket 不进入 Config、Registry View、普通 Queue 或持久化。
- 特殊执行不建立临时 Provider、第二个 Registry 或第二种 Model。
