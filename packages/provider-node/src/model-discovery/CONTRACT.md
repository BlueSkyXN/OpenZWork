# 模型列表读取

输入是所属 Environment 已保存的有效 Provider 配置。只 GET 同源 models 端点，不保存配置、不执行推理、不写日志；返回规范化模型 ID 或枚举错误。禁用重定向，限制总请求时间、分页、响应体与模型条数。自定义 headers 沿既有配置应用，凭据不进入返回值。保存与 Registry 更新仍由 Provider Settings 完成。
