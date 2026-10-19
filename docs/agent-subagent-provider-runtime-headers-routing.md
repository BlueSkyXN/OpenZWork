# Explore 子 agent provider runtime headers 路由说明

## 背景

桌面端通过父 task 的 sessionId 订阅动态 session event。Explore 子 agent 在 CLI 内部会创建独立的子 sessionId，用于子会话事件、持久化和 trace 归档。



## 问题

修复前，Explore 子 agent 复用父 runtime 的 `providerRuntimeHeadersPort`，但刷新请求由子 runtime 发起，因此请求里带的是子 sessionId。

桌面 agent service 收到 `provider-runtime-headers` 请求后，会按请求里的 sessionId 派发动态事件；UI 只订阅父 task 的 sessionId，不会订阅 `sess_subagent_agent_*`。结果是子 agent 的 runtime headers 请求落到无人监听的子 session 通道，渲染端不会处理该请求，也不会调用 `respondProviderRuntimeHeaders`，子 agent 的模型请求就会一直等待，直到用户 stop 或请求被取消。

## 修复原则

Explore 子 agent 的子 sessionId 仍然保留，用于 CLI 内部账本：

- 子 session 的事件持久化仍写入子 sessionId。
- 子 agent lifecycle / tool event 仍按既有逻辑镜像到父 task。
- trace context 和 parentSessionId 关系不变。

只在子 agent 对外调用 `providerRuntimeHeadersPort.refreshBeforeModelRequest` 时，把请求 sessionId 改成父 task 的 sessionId。这样 runtime headers 请求会路由到桌面 UI 已订阅的父 task 通道，符合现有 `mirrorSubagentToolEvent` 的对外语义：子 agent 对用户可见的阻塞交互归属父 task。

## 影响范围



如果以后新增子 agent 的其他独立阻塞协议请求，也需要显式判断它应该路由到子 session 还是父 task session，不能假设 eventSink 镜像会覆盖协议请求。

## 2026-09-08 请求隔离

桌面生产消费者现为 workspace 常驻 controller；父 session 路由继续保留。
runtime headers 响应通过唯一 requestId 返回子 agent 当前模型调用，Host 不再用子模型改写父 runtimeModel。
每个子/父模型调用各自拥有独立的请求期重试预算，互不共享；不编辑父用户输入或重放已完成工具。
