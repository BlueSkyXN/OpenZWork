# cli-storage-relocation

离线迁移 CLI 会话数据的唯一入口。调用方先取得源/目标业务根的排他门禁并复制到 staging。
本模块不打开源库，不启动 Agent、Provider 或工具；在副本事务内更新明确的路径列、
附件和工具结果引用，并同步本地路径派生的项目 ID 与记忆目录。
session/message/part ID 不变；正文、脚本、命令、任意工具 input 和远端记录不变。
工具输出提示仅转换与结构化引用精确匹配的 serializer 提示，不搜索替换任意历史文本。
错误传播，由调用方清除未发布 staging；发布后再迁移以新根为源，避免永久依赖旧根。
