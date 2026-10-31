/**
 * E2E 侧只复用 Node comparator，不引入 WDIO globals；运行时实现位于 scripts/lib。
 * v3.17.1 同步净化：telemetry-field-contract（ARMS 字段合同审计）随 ARMS 上报面剥离，
 * 不再转发 auditTelemetryFields；远端心跳 parity comparator 保持可用。
 */
export * from "../../../scripts/lib/conversation-telemetry-parity.mjs";
