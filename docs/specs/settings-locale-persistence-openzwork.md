# 界面语言持久化兼容合同（OpenZWork 保留）

- 状态：实现规格（2026-11-17 J1 返工）
- 上游合同：`docs/i18n/ui-locales.md`（上游 v3.18.0 引入，权威原文不改写）
- 登记条目：ledger OZ-C012；回归 `packages/services/test/settingsLocalePersistence.test.ts`（核心 CI `retained-provider-protocol-and-user-storage`）

## 1. 问题与根因

上游 v3.18.0 在 `packages/services/src/setting/settingService.ts` 的 `writeSettingsAt` 引入
界面语言落盘兼容：写盘时经 `toPersistedSettingsLocaleFields(settings)` 覆盖四个语言字段
（`locale`/`localePreference` 只写旧版能识别的 `zh-CN`/`en-US`/`system`，真实选择写
`uiLocale`/`uiLocalePreference`），并在 `shouldPersistSettingsMigrations` 以
`hasLegacyIncompatiblePersistedLocale(raw)` 触发旧格式迁移重写。

OpenZWork 合入 v3.18.0（merge `4d263563`）的冲突裁决把这两段丢失：`writeSettingsAt`
退化为 `const persisted = settings` 直写，`hasLegacyIncompatiblePersistedLocale` 导入
存在但未被使用。3.18.0/3.18.1/3.18.2 三个候选（A `fa2921f7`、B 冻结 `db1ed4b2`、
C `2217ef01`）均带此回归。独立隔离复现（真实 `createSettingService().update({
locale:'ja-JP', localePreference:'ja-JP'})` 后读临时 `.openzwork/v2/setting.json`）：
`locale/localePreference` 落 `ja-JP`、`uiLocale/uiLocalePreference` 缺失——旧版本读到
`ja-JP` 会使 `appSettingsSchema.safeParse` 失败并把整份设置重置为默认值（上游
ui-locales.md「setting.json 存储格式与降级兼容」节描述的丢失场景）。

登记口径：缺陷代码不在上游（上游 b95ebaff…fec97590 的该函数均正确），属我方 merge
丢失，不进 `docs/openzwork/patches/downstream-patches.yaml`（其登记范围为上游来源缺陷）；
按台账 OZ-C 登记，用核心 CI 回归守护该合同，防止后续上游同步再次静默丢失。

## 2. 保留行为（与上游一致的合同）

1. `settingService` 是语言字段落盘的唯一转换入口：任何写盘（update、迁移重写）都经
   `toPersistedSettingsLocaleFields` 产出四个字段；不在别处手写该格式。
2. 常规设置和设置页左下角的语言菜单均接受系统默认与五种界面语言，选中后立即切换。
   内存 `AppSettings` 保留真实选择（`ja-JP`/`ru-RU`/`ko-KR`/`zh-CN`/`en-US`），落盘
   旧字段只写旧版可解析的值：`locale`→`toZhOrEnLocale`（中文 zh、其余 en）、
   `localePreference`→`system`/`zh-CN`/`en-US`（非中英偏好写 `en-US`）。
3. 真实选择写 `uiLocale`/`uiLocalePreference`；读取经 schema preprocess
   （`resolvePersistedUiLocale`/`resolvePersistedUiLocalePreference`）合并回内存，
   新字段与降级后旧字段不一致时以旧字段为准。
4. 旧格式检测：`shouldPersistSettingsMigrations` 含 `hasLegacyIncompatiblePersistedLocale(raw)`
   ——磁盘旧字段已带新值（内部测试期写入或降级残留）时，下一次 `get()` 触发迁移重写
   为新格式，避免旧版本长期暴露在整份设置被重置的风险下。
5. 其余设置字段在任何语言写入/迁移中保持原值（update 合并语义、迁移以最新文件为底）。
6. 我方与上游该函数的既定差异保留：账号/team 回滚域（`rollbackFields`、
   `commitAccountSelection`）按官方账号裁剪不搬回（既有 OZ-D 条目）。

## 3. 验收（OZ-CLH 补齐：持久化/冷恢复合同）

| 验收                      | 入口                                                    | 断言                                                                                    |
| ------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| L1 多语言落盘             | 工程回归（真实服务+真实文件+隔离数据根）                | ja/ru/ko：旧字段=en-US、新字段=真实值；zh 写 zh；偏好 system 照写                       |
| L2 冷恢复真实语言         | 同上（新服务实例重读文件）                              | `get().locale` 等于真实选择（非降级值）                                                 |
| L3 旧客户端 schema 可识别 | 同上                                                    | 落盘 locale/localePreference 值均在旧枚举内（strict 解析不失败）                        |
| L4 旧格式迁移             | 同上（种子写入旧字段=ja-JP 的文件）                     | `get()` 后文件被重写为新格式，内存仍识别 ja-JP                                          |
| L5 其他设置保留           | 同上（先写无关字段再改语言）                            | 无关字段不丢                                                                            |
| OZ-CLH-02 UI 链落盘       | E2E `settings-client-language-header-openzwork.test.ts` | 设置页选 ja-JP 后，应用数据根 `v2/setting.json` 出现 `uiLocale=ja-JP` 且 `locale=en-US` |

OZ-CLH-01（UI 实时切换 + client/configs 零请求）不变。上游
`settings-client-language-header.test.ts` 的 5 个 case 仍按 OZ-D008 裁剪标不适用
（本合同不恢复其远端拉取断言）。

## 4. 维护规则

五种界面语言都提供使用统计的项目筛选、时间范围、会话明细，以及设置中的会话指标、系统提示词编辑、配置包和远控连接文案。回归读取各自的原始词表，核对插值参数，并在客户端切换语言查看对应控件。

- 上游同步触及 `writeSettingsAt`/`shouldPersistSettingsMigrations` 时，必须保住第 2 节
  六条行为；冲突裁决后跑 `settingsLocalePersistence.test.ts`。
- `docs/i18n/ui-locales.md` 为上游文档，OpenZWork 差异只在第 6 条（账号回滚域缺席），
  不在本文档重复其字段表。
