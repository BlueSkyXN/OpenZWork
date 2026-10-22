# Current Send Runtime Model Unavailable Handling

## Background



If first send later reuses that stale value, the service rejects the request with `ZCODE_RUNTIME_MODEL_UNAVAILABLE` before any model request is sent.

## Expected Behavior

- Historical task restore errors that only say the old task model is unavailable remain hidden by the chat banner.
- Current draft/send failures with `ZCODE_RUNTIME_MODEL_UNAVAILABLE` must be visible so the user can switch models or report the issue.
- Repeating the same send action after a failure must produce a fresh visible error; dismissing or retrying the previous banner must not suppress the next failure with the same message.
- Once provider snapshot hydration proves a local agent model preference points to a provider that no longer exists, prepare must not reapply that stale preference over the agent session settings.
- Desktop continuous and web remote replayable paths keep the same service guard; the change is limited to UI selection reconciliation and error presentation.

## Fix Shape

The model selection reconciliation uses the hydrated provider snapshot as the boundary. A custom local preference is reapplied only while providers are not hydrated yet, or when the referenced provider still exists in the snapshot. If it is missing, the agent returned config options remain the source of truth.

`ChatErrorBanner` suppresses `ZCODE_RUNTIME_MODEL_UNAVAILABLE` only for historical-task messages. Current session or current selection messages are rendered like other actionable chat errors.

Current first-send failures attach a local trace id when upstream does not provide one. That keeps the visible error key distinct across repeated failures with the same code and message.
