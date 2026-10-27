# host-storage-relocation

由 project-storage owner 提供离线目录转换，不改变数据库版本和旧迁移 checksum。
只在 staging 内更新本机任务、项目 roots、定时定义、分组键与旧会话快照目录。
远端 Host/identity、用户正文、task/project ID 保持原值。任何身份碰撞或坏 JSON 阻止发布。
固定 HOME 设置通过纯转换函数交回 settingService，与新根指针一起提交。
