# Provider Settings 体验问题记录（2026-08-27）

## 1. 用途

本文记录 Provider Refactor 首轮 macOS 实包体验中发现的问题。处理原则：

- 不改变既有 Provider / Model Config、Overlay、Registry 抽象的问题直接修复并由测试固定；
- 涉及 Account Overlay、套餐权益或模型可用性事实来源的问题只记录运行时证据和代码边界，等待裁决；
- 不用 UI 兜底、强制启用或绕过 Resolver 掩盖领域问题。

## 2. 已直接修复

| 问题 | 根因 | 修复后的契约 |
| --- | --- | --- |
| 历史 Provider 重名阻断无关保存 | 保存时对整个 Effective Provider 集合重新执行唯一性门禁，迁移遗留的既有重名会阻断任意 Provider | 只禁止本次名称变更新引入重名；既有历史重名不阻断其他保存 |
| 空 Base URL 无法保存草稿 Provider | Renderer 把空输入序列化为 `baseURL: ""`，在 Resolver 判断完整性之前就被 URL Schema 拒绝 | 空值不写 `baseURL`；Provider 可以保存但不可执行，非空非法 URL 仍拒绝 |
| Provider / Model 整行不能拖动 | Provider 依赖独立 grip；Model 的自定义 Pointer Sensor 又把 `useSortable` 自动添加的行级 `role=button` 误判为交互控件 | Provider、Model 的名称、图标及非交互空白都可启动整行拖动，真实控件除外，拖动时禁止选中文字 |
| 模型弹窗可穿透拖动背景模型 | Radix Dialog 通过 Portal 渲染，但 React 事件仍沿组件树冒泡到模型行的 DnD activator | Dialog content、overlay 和显式 `data-no-model-drag` 区域都不能启动背景排序 |
| 模型行信息与开关排列混乱 | 摘要和操作没有稳定布局边界 | Context 紧跟 Model ID；开关固定在模型行最右侧；模型行不提供单字段“恢复默认” |
| Provider 启停重复展示 | 状态标签和操作按钮分别占位 | 一个按钮同时表达当前状态并执行切换 |
| 模型编辑器把继承值伪装成 Personal 输入 | Draft 使用 Effective Config 初始化；JSON 又额外重复展示只读值 | Personal 输入为空时，继承值只作为 placeholder；删除重复只读 JSON 区 |
| 模型编辑器层级过深且接近全屏 | 常用字段混在“高级”折叠中，弹窗最大高度接近整个视口 | 去掉“高级”；桌面使用居中的中等最大高度并仅滚动内容区 |
| 模型编辑器字段顺序不符合使用频率 | Max Output、输入输出格式排在能力和复杂 JSON 后 | `Model ID/启用 -> Context -> Max Output -> 输入 -> 输出 -> 能力 -> 复杂配置` |
| 只能逐字段恢复继承值 | 缺少模型级清空 Personal Overlay 的入口 | Footer 提供“全部恢复默认”，清空该模型的 Personal Model Config Overlay 后再由用户保存 |
| 国内 Provider 在新增菜单靠后 | 菜单直接使用 Built-in 配置顺序，旧顺序把海外 Provider 放在前面 | Built-in 配置及新增菜单统一先列国内 Provider，再列海外 Provider |

## 3. Personal Config 来源与 Official 名称核对

Pro 机器保留的迁移前备份与清理前备份证明：

```text
旧 ~/.openzwork/v2/config.json.provider
        |
        | Provider V1 importer
        v
新 config.json.providers + modelConfigRules
```

清理前的 Personal Config 不是新的 Official Config 内容本身，而是迁移器把旧配置投影进新 Personal Overlay 后留下的结果，
其中同时包含：

- 旧版本可编辑的 `builtin:*` Provider 配置；
- 用户创建的自定义 Provider；
- 用户对标准 Provider 顺序、模型成员和模型属性的 Personal 覆盖。
