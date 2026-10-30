# 按会话集合读取用量

Host 解析项目归属，CLI 只接收 sessionIds。省略集合为全部，空数组为零。递归仅沿 selection_side_chat、subagent_child、workflow_child、nested_workflow_child；fork 为独立根。纯侧聊路径计入主会话，路径经过后三类时计入子任务。缺失父记录或缺失 session 行的 usage 保留独立聚合行。

queryUsageSessions 输入 since/until/tzOffsetMs、offset、limit。单 SQL 快照返回本页 rows、全量 totalCount / childSessionCount / totals；越界页仍保留全量合计。输出按 totalTokens 降序、sessionId 升序。无写入、迁移、缓存或标题正文推算。
