# OpenZWork 文档索引

这里列出 OpenZWork 自己编写的全部文档。`docs/` 下其余文档来自上游 ZCode，保持上游原文。布局规则见 [维护模型](maintenance-model.md)。

| 位置                              | 内容                                              |
| --------------------------------- | ------------------------------------------------- |
| `docs/openzwork/`                 | 维护文档：上游整合、下游补丁、发行、CI 与历史记录 |
| `docs/specs/*-openzwork.md`       | OpenZWork 产品 spec                               |
| `docs/testing/*-openzwork.md`     | OpenZWork 测试计划                                |
| 上游其他目录下的 `*-openzwork.md` | 放在对应主题目录中的 OpenZWork 文档               |

上游文档与技能原文不动。只有被代码读取、被 OpenZWork 规则引用，或由 OpenZWork 改写维护的上游文档，才在同目录保留 `-openzwork` 版本，全部登记在 [upstream-doc-variants.yaml](upstream-doc-variants.yaml)；其余差异集中写在下方「与上游的差异」。

## 与上游的差异

`docs/` 下不带 `-openzwork` 后缀的文档是上游 ZCode 原文，描述的是上游产品。阅读时按下表理解 OpenZWork 的实际情况；同目录存在 `-openzwork` 版本的，以该版本为准（见 [upstream-doc-variants.yaml](upstream-doc-variants.yaml)）。本表与 [台账](ledger.yaml) 一致，由 `pnpm openzwork:scan --check` 校验。

通用差异：

- 产品名为 OpenZWork；用户级数据根为家目录下的 `.openzwork`（上游为 `.zcode`），项目级配置目录仍为 `<项目>/.zcode`。
- 模型只通过用户自行配置的 Provider 访问，没有官方账号、套餐与官方网关。

### 已移除的上游功能

| 编号    | 名称                         | 说明                                                                                      | 依据                                                                 |
| ------- | ---------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| OZ-D001 | 遥测（ARMS/OTel）            | 移除 desktop、services、ui、CLI 四层遥测与上报依赖。                                      | 净化工作包 WP-05；docs/openzwork/upstream/v3.17.1-integration.md     |
| OZ-D002 | 官方套餐、加速卡与闲时任务   | 移除 Coding Plan、Start Plan、Highspeed 加速卡与闲时任务。                                | 净化工作包 WP-08、WP-09                                              |
| OZ-D003 | 官方账号登录                 | 移除 BigModel/Z.AI 账号 OAuth 与 Web 登录。                                               | 净化工作包 WP-08                                                     |
| OZ-D004 | 云端分享、反馈与自动更新     | 移除会话云端分享、云端反馈与应用自动更新。                                                | 净化工作包 WP-07                                                     |
| OZ-D005 | 原生 CUA                     | 移除原生电脑控制实现，只保留兼容占位。                                                    | [spec](../specs/cua-placeholder-boundary-openzwork.md)               |
| OZ-D006 | 官方 MCP 鉴权与官方端点配置  | 移除官方 MCP 身份头、客户端配置下发、场景配置与官方命令端点。                             | 净化工作包 WP-06；docs/openzwork/upstream/v3.17.2-integration.md     |
| OZ-D007 | 营销触达、奖励与请求安全版本 | 移除营销触达、奖励内嵌与请求安全版本链路。                                                | v3.17.1 重净                                                         |
| OZ-D008 | 云端内容、公告与云端用量账本 | 移除云端内容弹窗、全局公告与上游云端用量统计。                                            | 净化工作包；本地替代见 OZ-F003、OZ-C005                              |
| OZ-D009 | image-search 插件            | 移除依赖官方后端与 zcode_official 鉴权的官方搜图 MCP 插件，不注册、不打包，图标一并删除。 | 用户 2026-11-08 决定；docs/openzwork/upstream/v3.17.1-integration.md |

### 改变了行为的上游功能

| 编号    | 名称                     | 说明                                                                   | 依据                                                         |
| ------- | ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| OZ-C001 | 产品身份与用户级数据根   | 用户级数据根改为 .openzwork，产品身份与 ZCode 隔离。                   | [spec](../specs/identity-and-data-isolation-openzwork.md)    |
| OZ-C002 | 旧 ZCode 记忆隔离        | 不再隐式复制旧 ZCode 记忆，保留已导入数据。                            | [spec](../specs/memory-migration-openzwork.md)               |
| OZ-C003 | 标准 Provider 模板       | 内置 Provider 入口只保留三种标准协议模板。                             | [spec](../specs/standard-provider-templates-openzwork.md)    |
| OZ-C004 | 模型能力与渠道匹配       | 恢复模型与站点的能力规则和推理映射。                                   | [spec](../specs/model-capability-matching-openzwork.md)      |
| OZ-C005 | 本地引导与 Bot 数据边界  | 本地首次偏好、Bot 凭据迁移和显式注册/启用边界。                        | [spec](../specs/onboarding-local-settings-openzwork.md)      |
| OZ-C006 | 自定义命令改名与保存     | 命令改名不丢数据，保存失败如实返回。                                   | [spec](../specs/command-file-update-openzwork.md)            |
| OZ-C007 | 技能开关链路             | 内置技能开关的规则、所有者与回归。                                     | [spec](../specs/skills-toggle-openzwork.md)                  |
| OZ-C008 | 设置页布局与远控入口     | 设置页内容布局调整，恢复侧栏底部的远控入口。                           | [spec](../specs/settings-visual-polish-openzwork.md)         |
| OZ-C009 | 业务数据目录完整迁移     | 保存迁移计划，重启前置阶段复制并转换 CLI/Host 数据，发布后切换数据根。 | [spec](../desktop/configurable-data-directory-openzwork.md)  |
| OZ-C010 | 发行许可与上游声明       | GPL-3.0 整体声明、上游 Apache-2.0 原文与 NOTICE 入口。                 | [分支声明](../../NOTICE.md)                                  |
| OZ-C011 | 工作流查询进程与生命周期 | 工作流总览读取共用独立查询 lane 并空闲回收，UI 读状态分代际。          | [spec](../specs/saved-workflow-query-lifecycle-openzwork.md) |

### OpenZWork 新增的功能

| 编号    | 名称                     | 说明                                                       | 依据                                                           |
| ------- | ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------- |
| OZ-F002 | 系统提示词设置与编辑器   | 系统提示词设置、完整预览、差异与模板。                     | [spec](../specs/system-prompt-settings-openzwork.md)           |
| OZ-F003 | 本地使用统计页           | 使用统计页按本机度量重建。                                 | [spec](../specs/app-usage-settings-openzwork.md)               |
| OZ-F004 | 会话累计用量             | 输入框工具栏显示会话累计用量。                             | [spec](../specs/session-usage-summary-openzwork.md)            |
| OZ-F005 | 原生会话指标栏           | 会话指标栏与自选指标。                                     | [spec](../specs/native-conversation-metrics-openzwork.md)      |
| OZ-F006 | 对话复制、筛选与项目排序 | 对话 Markdown 复制、任务筛选与项目活动排序。               | [spec](../specs/conversation-controls-openzwork.md)            |
| OZ-F007 | 外部会话多源导入         | 从多个外部客户端导入会话。                                 | [spec](../specs/external-session-import-openzwork.md)          |
| OZ-F008 | 模型列表拉取与项目用量   | 拉取模型目录、按项目查询用量。                             | [spec](../specs/model-discovery-project-usage-openzwork.md)    |
| OZ-F009 | Node 发行内置技能资产    | 普通 Node CLI/Web 发行包携带内置技能。                     | [spec](../specs/node-distribution-bundled-skills-openzwork.md) |
| OZ-F010 | V1 远控连接方式          | 官方 V1 远控页的多种连接方式与多入口。                     | [spec](../web-remote-control/v1-connection-modes-openzwork.md) |
| OZ-F011 | OpenZWork 构建与发行流程 | 发行版本、安装包校验与正式 tag 自动发布。                  | [发行规范](release/openzwork-release-version.md)               |
| OZ-F012 | CI 与桌面验证工程        | Core/Extended 编排、报告校验、桌面 runner 与已有回放材料。 | [CI 规范](ci/ci-job-orchestration.md)                          |

### 上游已删除、OpenZWork 保留

| 编号    | 名称                           | 说明                                                                          | 依据                                                                            |
| ------- | ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| OZ-R001 | 上游已退役的桌面测试与兼容源码 | 上游后续版本删除、OpenZWork 继续使用的桌面 E2E 用例、夹具与三个兼容源码文件。 | v3.17.1 整合（上游退役 App 单测与部分 E2E，OpenZWork 保留 CLI、E2E 与门禁测试） |

维护体系本身（OZ-F001）见 [维护模型](maintenance-model.md)。

## 维护

- [维护模型](maintenance-model.md)：双轨维护、来源分类、文档与代码布局、台账、扫描与经验库规则。

### 上游整合

- [ZCode v3.15.1 整合验收](upstream/v3.15.1-integration.md)
- [ZCode v3.16.1 整合验收](upstream/v3.16.1-integration.md)
- [ZCode v3.16.2 整合验收](upstream/v3.16.2-integration.md)
- [OpenZWork v3.16.2 候选版本说明](upstream/v3.16.2-candidate.md)
- [ZCode v3.17.1 整合验收](upstream/v3.17.1-integration.md)
- [ZCode v3.17.2 整合](upstream/v3.17.2-integration.md)
- [ZCode v3.17.2 整合验证](upstream/v3.17.2-validation.md)

### 下游补丁

- [下游补丁清单](patches/downstream-patch-registry.md)，登记表 [downstream-patches.yaml](patches/downstream-patches.yaml)
- [3.16.2 候选维护修复](patches/maintenance-fixes-3.16.2.md)
- [共享文件锁的 Windows 创建竞争](patches/shared-file-lock-acquisition.md)
- [Source Server 数据目录锁的取得顺序](patches/source-server-lock-acquisition.md)
- [Source Server 状态快照的原子替换](patches/source-server-status-persistence.md)

### 发行

- [OpenZWork 发行版本](release/openzwork-release-version.md)
- [正式 tag 自动发布 GitHub Release](release/automatic-github-release.md)

### CI 与测试基础设施

- [CI job 编排与并发预算](ci/ci-job-orchestration.md)
- [CI Linux 矩阵接入](ci/ci-linux-matrix.md)
- [Extended 测试按平台与分组并行](ci/extended-ci-parallel.md)
- [GitHub Actions 的 Node.js 24 运行时升级](ci/github-actions-runtime.md)
- [冷恢复集成测试的数据库夹具](ci/ci-cold-resume-fixtures.md)
- [远端本地 UAT 的产物与权限门禁](ci/remote-uat-artifact-gate.md)
- [Provider Provisioning 真实 Store 测试生命周期](ci/provider-provisioning-test-lifecycle.md)

### 历史记录

- [净化工作包验收状态](records/cleanup-acceptance-status.md)
- [迁移、远端 UAT 与 Node 发行修复验收记录](records/repair-acceptance-20261001.md)
- [迁移源父目录 alias 修复与干净提交树验证](records/source-alias-repair-validation-20261001.md)

## 产品 spec

- [产品身份与用户级数据根隔离](../specs/identity-and-data-isolation-openzwork.md)
- [可配置数据存储目录与完整迁移](../desktop/configurable-data-directory-openzwork.md)
- [旧 ZCode 记忆隔离](../specs/memory-migration-openzwork.md)
- [CUA 空占位边界](../specs/cua-placeholder-boundary-openzwork.md)
- [标准 Provider 模板](../specs/standard-provider-templates-openzwork.md)
- [模型能力与渠道匹配](../specs/model-capability-matching-openzwork.md)
- [模型列表拉取与项目用量查询](../specs/model-discovery-project-usage-openzwork.md)
- [系统提示词设置](../specs/system-prompt-settings-openzwork.md)
- [系统提示词编辑器](../specs/system-prompt-editor-openzwork.md)
- [使用统计页重建](../specs/app-usage-settings-openzwork.md)
- [会话累计用量展示](../specs/session-usage-summary-openzwork.md)
- [原生会话指标栏](../specs/native-conversation-metrics-openzwork.md)
- [对话复制、筛选与项目排序](../specs/conversation-controls-openzwork.md)
- [外部会话多源导入](../specs/external-session-import-openzwork.md)
- [自定义命令改名与保存失败](../specs/command-file-update-openzwork.md)
- [技能开关](../specs/skills-toggle-openzwork.md)
- [本地首次引导偏好](../specs/onboarding-local-settings-openzwork.md)
- [设置页布局与远控快捷入口](../specs/settings-visual-polish-openzwork.md)
- [普通 Node CLI/Web 发行的内置技能资产](../specs/node-distribution-bundled-skills-openzwork.md)

## 测试计划与专题文档

- [CUA 占位影响与验证](../testing/cua-placeholder-boundary-openzwork.md)
- [系统提示词编辑器实施与验收计划](../testing/system-prompt-editor-plan-openzwork.md)
- [V1 远程控制连接方式](../web-remote-control/v1-connection-modes-openzwork.md)
