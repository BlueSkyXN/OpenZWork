/** 所有用量聚合共享同一只读过滤；SQL 参数只使用绑定值。 */
export interface UsageQueryScope {
  cte: string;
  condition: string;
  parameters: string[];
}
