# 标准 Provider 模板维护

OpenZWork 只提供三个中性协议入口，模型能力与公共渠道差异单独维护。产品边界见[标准 Provider 模板](../spec/standard-provider-templates.md)，匹配与验收见[模型能力匹配](../spec/model-capability-matching.md)。

日常维护：

1. 修正三个中性协议模板的名称或 schema 兼容问题；
2. 按可追溯的上游版本或接口资料维护模型、协议与公共站点能力；
3. 保留未知模型的通用请求行为，逐档验证已维护模型的最终参数；
4. 同步正式与测试配置并递增 revision。

新增厂商模板、默认连接、Logo、模型目录或账号 Provider 属于独立产品变更。能力规则不得携带账号、凭据、内部地址或自动添加模型的成员配置。

规则更新需记录来源版本、涉及型号／协议／endpoint、映射变化和验证范围。Personal 显式覆盖始终优先；规则发布随应用版本进行，不声称在线同步上游目录。

本次基线为 `v3.17.1` / `a60ba6a7e5a06742270ca605f5d2cc2766afa7e1`。复核或导入本地已有 Git 版本：

```sh
node scripts/model-capability-rules.mjs --source-ref v3.17.1
node scripts/model-capability-rules.mjs --source-ref v3.17.1 --write
```

首条只预览并校验；第二条同步生产、测试配置与公开渠道验收 fixture。内容不变时 revision 不变。原厂模板中的能力按精确型号＋协议导入，聚合与渠道专有覆盖保留精确 endpoint；成员启用标记、连接、账号与鉴权字段不导入。验收 fixture 只用于测试，不向用户添加模型。
