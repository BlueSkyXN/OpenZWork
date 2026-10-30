# 项目用量展示

概览保留 62aefeff 的指标与图表，在时间范围左侧增加项目选择，在会话数量标签行增加明细入口。AppUsageSection 独占项目、时间范围、until、视图与页码；hooks 只管理对应请求及迟到结果隔离。

明细为 SettingsBreadcrumbReporter 二级视图，50 行一页；桌面表格、窄容器列表，合计始终覆盖筛选下全量行。主会话与子任务数字取 Host 分页结果，不在 UI 聚合或推算。项目列显示 project / unassigned / not-in-task-list。进入聚焦标题、返回恢复 main 滚动与入口焦点。
