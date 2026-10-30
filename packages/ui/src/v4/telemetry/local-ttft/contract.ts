// OpenZWork 净化：local-ttft 观察器（首字延迟→ARMS 出口）随遥测域移除；
// 契约退化为空类型壳，消费点按 observer 为空处理，渲染时钟行为不受影响。
export interface LocalTtftObserver {
  needsTextRender?: never;
  projected?: never;
}

export function getLocalTtftObserver(): LocalTtftObserver | null {
  return null;
}

export function setLocalTtftObserver(): void {
  // 净化：不接受注册。
}
