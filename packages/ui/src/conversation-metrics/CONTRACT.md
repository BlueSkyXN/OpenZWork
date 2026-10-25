# 指标界面

Composer 传入所属会话 snapshot、完整 workspace/remote 身份与显示偏好；普通编辑器不传 footer，偏好关闭或字段为空时同样不传。模块只读投影。查询由现有 hooks 完成，展开才挂载，按终态/子目录 revision 或手动刷新；本机今日强制可信 base service。历史入口仅接受所属 turnHeader，无定时器和额外查询。scope 变化卸载异步查询组件，拒收旧响应。

显示偏好由同模块的 store/conversationMetricsPreferencesStore.ts 唯一管理；稳定字段 ID、默认值和折叠优先级由 contract 定义。每 renderer 共用一份 store，同存储域经 storage 事件同步，接收只读当前值且不回写。监听按消费者引用计数挂载/清理。Host、全局 Store 与 Root 不增加状态。原展开 key 保留；新显示偏好以版本化 key 保存，坏值仅回退本分组，合法空集合不回填。

主栏与固定示例预览复用纯 SummaryRow。预览不挂查询、不写展开状态。按实际内容宽度折叠已勾选字段，测量副本不可交互、不进入可访问树；最多七项测量，相同可见集合不触发更新。更多与历史明细保留完整字段。
