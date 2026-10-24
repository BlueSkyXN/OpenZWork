# 系统提示词设置界面

SystemPromptSettingsSection 通过 hooks 使用本地 Host 的 useSettings 和目录查询；SystemPromptEditor 仅持有草稿、baseline 和选中章节。设置 snapshot 是持久化权威，目录文本是 CLI 当前版本权威。

onSave 传入完整草稿和打开时快照，服务在文件锁内比较后提交。失败保留草稿；远端刷新不覆盖脏草稿。查看默认和本章预览不发送模型请求。生成数据使用来源说明，不伪装为当前会话完整上下文。
