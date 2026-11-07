# OpenZWork 文档索引

这里列出 OpenZWork 自己编写的全部文档。`docs/` 下其余文档来自上游 ZCode，保持上游原文。布局规则见 [维护模型](maintenance-model.md)。

| 位置                              | 内容                                              |
| --------------------------------- | ------------------------------------------------- |
| `docs/openzwork/`                 | 维护文档：上游整合、下游补丁、发行、CI 与历史记录 |
| `docs/specs/*-openzwork.md`       | OpenZWork 产品 spec                               |
| `docs/testing/*-openzwork.md`     | OpenZWork 测试计划                                |
| 上游其他目录下的 `*-openzwork.md` | 放在对应主题目录中的 OpenZWork 文档               |

上游文档与技能原文不动；OpenZWork 修改后的版本放在同目录、文件名带 `-openzwork`，全部登记在 [upstream-doc-variants.yaml](upstream-doc-variants.yaml)。

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
