# 标准 Provider 模板维护

OpenZWork 不维护第三方厂商内置目录。当前规则、兼容边界和验收见[标准 Provider 模板](../spec/standard-provider-templates.md)。

日常变更只允许：

1. 修正三个中性协议模板的名称或 schema 兼容问题；
2. 维护通用模型默认值；
3. 维护三种标准协议的通用请求参数映射；
4. 同步正式与测试配置并递增 revision。

新增厂商模板、厂商域名、Logo、模型目录、站点规则或固定 Provider 时，先修改产品 spec 并单独说明需要恢复该内置厂商的原因。
