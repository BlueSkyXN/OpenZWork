import type { AgentRuntimeInternal } from "../internal.js";
import { sampleModel } from "./sample-model.js";
import { grantPermissionMode } from "../permission-full-access.js";
import {getSessionShellSelection, initializeSessionShellEnvironmentIfNeeded, updateConfig, setExecutionState, getMode, getPlanEnabled, getSessionModelSelection, setSessionModelSelection, getProjectId, setWorkingDirectory, ensureSessionPersistedForExternalActivity, getActiveTurnInfo, getTools, invalidateToolCache, getToolRegistry, getToolExecutor, subscribeEvents, getSessionEventStore, notifyExternalChildSessionEvent, createChildClientPorts, getContextBuilder, getPendingPermissionRequests, getProjection, getSessionId} from "./config.js";
import {
  markContextCompositionChanged,
  subscribeContextCompositionChanged,
} from "../context-composition/state.js";
import { getContextComposition } from "../context-composition/query.js";
import { recordUserInputAutoResolutionUpdate } from "./interaction-auto-resolution.js";
import { recordDynamicWorkflowRunProgress } from "./dynamic-workflow-run-progress.js";
import { trackResumedDynamicWorkflowRun } from "./dynamic-workflow-run-track.js";
import { activateDynamicWorkflowTools } from "./dynamic-workflow-activation.js";
import { recordSessionFeature } from "../session-features/contract.js";
import { startSavedWorkflowRun } from "./dynamic-workflow-run-start.js";
import { amendWorkflowRunSettings } from "./dynamic-workflow-run-settings.js";
import {enqueueDeferredInput, steerTurn, beginActiveTurn, reserveTurnStart, releaseTurnStart, finishActiveTurn, createPendingInputId, rejectTurnSteer, hasPendingInput, hasInlineGuidePendingInput, fallbackPendingGuidesToQueue, drainPendingInput, clearAllPendingInputs, completeExternalQueueDrain, discardHeldPendingInputById, discardPendingInput, editPendingInputById, emitModeChanged, getPendingInputEditLock, lockPendingInputEdit, releasePendingInputEdit, emitModelSelected, markPendingInputPromoting, releasePendingInputReservation, removePendingInputById, reorderPendingInput, reservePendingInputById, setFollowupMode, setQueueAutoDrain, discardPersistedPendingSteerInputs} from "./steering.js";
import {
  enqueueBackgroundTaskNotification,
  sealBackgroundTaskNotifications,
} from "./background-notifications.js";
import { drainPendingRuntimeCommandsForActiveLoop } from "./runtime-command-active-loop.js";
import { enqueueSubagentMessage } from "./subagent-messages.js";
import {
  acquireForegroundPromotionLease,
  drainRuntimeCommandQueue,
  enqueueRuntimeCommand,
  getActiveForegroundExecutionId,
  hasActiveOrQueuedTurnWork,
  releaseForegroundPromotionLease,
  stopActiveForegroundExecution,
} from "./runtime-command-queue.js";
import { hasResidencyBlockingWork, trackResidencyBlockingWork } from "./residency.js";
import { createDefaultSubagentPort } from "./subagent.js";
import {ensureContextInitialized, getSkillCatalog, createContextBuilderFromSnapshot, loadProjectMemoryRoot, logMemorySkipped, discoverSkillsForContext, createConfigOnlyContextSnapshot, initializeMessageHistoryFromContext, extractToolCallsFromResult, shouldStreamModelText} from "./context.js";
import { injectPluginReferenceReminderFromTurn } from "./plugin-reference.js";
import { initializeMcp, startMcpStartup } from "./mcp.js";
import { runModelTextRequest } from "./model.js";
import { emitModelStreamingEvent } from "./model-streaming-event.js";
import {createModelStatusSink, logModelNetworkStatus} from "./model-status.js";
import {logContextUsageSnapshot, logModelRequestSteeringContext, buildModelMessageTailDiagnostics, buildContextUsageSnapshot, buildContextUsageBreakdownFromSnapshot, buildContextUsageCategory, buildToolUsageDetail, buildSkillUsageDetails, buildMessageRoleBreakdown, estimatedMetric, estimatedMetricFromKnown, sumMetrics} from "./context-usage.js";
import {toScheduleState, resumeFromStore, readSessionTodosForContext, readSessionTargetForContext, injectTargetStateIntoMessageHistory} from "./resume.js";
import {recordTargetChanged, continueActiveTargetIfIdle, targetContinuationCandidate, accountTargetTurnCompletion, startTargetTurnAccounting, heartbeatTargetTurnAccounting, finishTargetTurnAccounting, pauseActiveTargetForCancellation, activatePausedTargetAfterResume} from "./target.js";
import { recordGoalStateChangeReminder } from "./goal-state-reminder.js";
import { continueActiveTargetLoop } from "./target-continuation-loop.js";
import {
  runSessionStartHooks,
  runStopHooks,
  runUserPromptSubmitHooks,
  shouldContinueAfterStopHooks,
} from "./hooks.js";
import { executeTurn, executeTurnCommand } from "./turn.js";
import { admitPrompt } from "./prompt-admission.js";
import {executeManualCompact, autoCompactIfNeeded, reactiveCompactAfterContextExceeded} from "./compact.js";
import { microcompactIfNeeded } from "./microcompact.js";
import { compactActiveConversation } from "./compact-active.js";
import {executeRewindCommand, formatRewindStatus, rewindWorkspaceToCheckpoint, finishUnavailableRewind} from "./rewind.js";
import {rewindConversationToMessage, rewindCascadeToMessage, rewindToMessage, rewindWorkspaceToMessage} from "./rewind-message.js";
import {restoreWorkspaceCheckpointArtifact, copySessionMessagesForFork, listWorkspaceCheckpoints, forkWorkspaceFromCheckpoint, loadCheckpointMessagePreviews} from "./workspace-checkpoints.js";
import {
  createSelectionSideConversation,
  forkConversationBeforeMessage,
  forkStableConversationAtMessage,
} from "./session-fork.js";
import { applyWorkspaceFileRewind, previewWorkspaceFileRewind } from "./file-rewind.js";
import {scheduleTools, executeTools, emitToolScheduledEvents, emitFileMutationCheckpoint, emitPermissionRequest, resolvePermission} from "./tools.js";
import {cancelBackgroundTask, cancelRunningRuntimeBackgroundTasks, hasRunningBackgroundTasks, stopBackgroundTask, buildBackgroundTaskPayload} from "./background.js";
import { readBackgroundBashOutput } from "./background-bash-output.js";
import {createEvent, appendEvent, notifyEventSinks, ensureSessionPersisted, isSessionPersisted} from "./events.js";
import {buildCompactTimelinePayload, persistCompactTimeline, finishCompactTimelineFailure, recoverInterruptedCompactTimelines, persistCompactSummary} from "./compact-persistence.js";
import { recordExternalUserPrompt } from "./control-only-turn.js";
import {persistUserPrompt, persistSyntheticUserNotice, persistSyntheticUserNoticeForSession, persistAssistantMessage, persistMessage, persistPart, rebuildProjection} from "./message-persistence.js";
import {persistPendingWorktreeCreationTimeline, recordPendingModelChange, recordPendingWorktreeCreation, persistPendingModelChangeTimeline, persistAssistantTimelinePartForSession} from "./timeline-persistence.js";
import { generateWorkspaceText, testModelConnectivity } from "./workspace-generate-text.js";
import { maybeStartGoalSummaryTitleGeneration } from "./goal-summary-title.js";
import {maybeStartSessionTitleGenerationFromExternalInput, setCustomSessionTitle} from "./session-title.js";
import {
  drainMemoryExtractions,
  isProjectMemoryEnabled,
} from "../helpers/project-memory-extraction.js";

type AgentRuntimeConstructor = { prototype: object };

export function installAgentRuntimeMethods(ctor: AgentRuntimeConstructor): void {
  const proto = ctor.prototype as Record<string, unknown>;
  proto.updateConfig = updateConfig;
  proto.setExecutionState = setExecutionState;
  proto.grantPermissionMode = grantPermissionMode;
  proto.initializeSessionShellEnvironmentIfNeeded = initializeSessionShellEnvironmentIfNeeded;
  proto.getSessionShellSelection = getSessionShellSelection;
  proto.getMode = getMode;
  proto.getPlanEnabled = getPlanEnabled;
  proto.getSessionModelSelection = getSessionModelSelection;
  proto.setSessionModelSelection = setSessionModelSelection;
  proto.getProjectId = getProjectId;
  proto.setWorkingDirectory = setWorkingDirectory;
  proto.ensureSessionPersistedForExternalActivity = ensureSessionPersistedForExternalActivity;
  proto.maybeStartSessionTitleGenerationFromExternalInput =
    maybeStartSessionTitleGenerationFromExternalInput;
  proto.setCustomSessionTitle = setCustomSessionTitle;
  proto.maybeStartGoalSummaryTitleGeneration = maybeStartGoalSummaryTitleGeneration;
  proto.testModelConnectivity = testModelConnectivity;
  proto.recordExternalUserPrompt = recordExternalUserPrompt;
  proto.getActiveTurnInfo = getActiveTurnInfo;
  proto.getTools = getTools;
  proto.invalidateToolCache = invalidateToolCache;
  proto.getToolRegistry = getToolRegistry;
  proto.getToolExecutor = getToolExecutor;
  proto.subscribeEvents = subscribeEvents;
  proto.getContextComposition = getContextComposition;
  proto.subscribeContextCompositionChanged = subscribeContextCompositionChanged;
  proto.markContextCompositionChanged = markContextCompositionChanged;
  proto.getSessionEventStore = getSessionEventStore;
  proto.notifyExternalChildSessionEvent = notifyExternalChildSessionEvent;
  proto.createChildClientPorts = createChildClientPorts;
  proto.getContextBuilder = getContextBuilder;
  proto.getPendingPermissionRequests = getPendingPermissionRequests;
  proto.recordUserInputAutoResolutionUpdate = recordUserInputAutoResolutionUpdate;
  proto.recordDynamicWorkflowRunProgress = recordDynamicWorkflowRunProgress;
  proto.trackResumedDynamicWorkflowRun = trackResumedDynamicWorkflowRun;
  proto.activateDynamicWorkflowTools = activateDynamicWorkflowTools;
  proto.recordSessionFeature = recordSessionFeature;
  proto.startSavedWorkflowRun = startSavedWorkflowRun;
  proto.amendWorkflowRunSettings = amendWorkflowRunSettings;
  proto.getProjection = getProjection;
  proto.getSessionId = getSessionId;
  proto.enqueueDeferredInput = enqueueDeferredInput;
  proto.steerTurn = steerTurn;
  proto.beginActiveTurn = beginActiveTurn;
  proto.reserveTurnStart = reserveTurnStart;
  proto.releaseTurnStart = releaseTurnStart;
  proto.finishActiveTurn = finishActiveTurn;
  proto.createPendingInputId = createPendingInputId;
  proto.rejectTurnSteer = rejectTurnSteer;
  proto.hasPendingInput = hasPendingInput;
  proto.hasInlineGuidePendingInput = hasInlineGuidePendingInput;
  proto.fallbackPendingGuidesToQueue = fallbackPendingGuidesToQueue;
  proto.drainPendingInput = drainPendingInput;
  proto.enqueueRuntimeCommand = enqueueRuntimeCommand;
  proto.drainRuntimeCommandQueue = drainRuntimeCommandQueue;
  proto.hasActiveOrQueuedTurnWork = hasActiveOrQueuedTurnWork;
  proto.hasResidencyBlockingWork = hasResidencyBlockingWork;
  proto.trackResidencyBlockingWork = trackResidencyBlockingWork;
  proto.acquireForegroundPromotionLease = acquireForegroundPromotionLease;
  proto.getActiveForegroundExecutionId = getActiveForegroundExecutionId;
  proto.releaseForegroundPromotionLease = releaseForegroundPromotionLease;
  proto.stopActiveForegroundExecution = stopActiveForegroundExecution;
  proto.enqueueBackgroundTaskNotification = enqueueBackgroundTaskNotification;
  proto.enqueueSubagentMessage = enqueueSubagentMessage;
  proto.drainPendingRuntimeCommandsForActiveLoop = drainPendingRuntimeCommandsForActiveLoop;
  proto.sealBackgroundTaskNotifications = sealBackgroundTaskNotifications;
  proto.discardPendingInput = discardPendingInput;
  proto.removePendingInputById = removePendingInputById;
  proto.reservePendingInputById = reservePendingInputById;
  proto.markPendingInputPromoting = markPendingInputPromoting;
  proto.releasePendingInputReservation = releasePendingInputReservation;
  proto.editPendingInputById = editPendingInputById;
  proto.lockPendingInputEdit = lockPendingInputEdit;
  proto.releasePendingInputEdit = releasePendingInputEdit;
  proto.getPendingInputEditLock = getPendingInputEditLock;
  proto.reorderPendingInput = reorderPendingInput;
  proto.setQueueAutoDrain = setQueueAutoDrain;
  proto.completeExternalQueueDrain = completeExternalQueueDrain;
  proto.setFollowupMode = setFollowupMode;
  proto.emitModelSelected = emitModelSelected;
  proto.emitModeChanged = emitModeChanged;
  proto.discardPersistedPendingSteerInputs = discardPersistedPendingSteerInputs;
  proto.discardHeldPendingInputById = discardHeldPendingInputById;
  proto.clearAllPendingInputs = clearAllPendingInputs;
  proto.createDefaultSubagentPort = createDefaultSubagentPort;
  proto.ensureContextInitialized = ensureContextInitialized;
  proto.getSkillCatalog = getSkillCatalog;
  proto.createContextBuilderFromSnapshot = createContextBuilderFromSnapshot;
  proto.loadProjectMemoryRoot = loadProjectMemoryRoot;
  proto.logMemorySkipped = logMemorySkipped;
  proto.injectPluginReferenceReminderFromTurn = injectPluginReferenceReminderFromTurn;
  proto.initializeMcp = initializeMcp;
  proto.startMcpStartup = startMcpStartup;
  proto.discoverSkillsForContext = discoverSkillsForContext;
  proto.createConfigOnlyContextSnapshot = createConfigOnlyContextSnapshot;
  proto.initializeMessageHistoryFromContext = initializeMessageHistoryFromContext;
  proto.extractToolCallsFromResult = extractToolCallsFromResult;
  proto.shouldStreamModelText = shouldStreamModelText;
  proto.runModelTextRequest = runModelTextRequest;
  proto.emitModelStreamingEvent = emitModelStreamingEvent;
  proto.createModelStatusSink = createModelStatusSink;
  proto.logModelNetworkStatus = logModelNetworkStatus;
  proto.logContextUsageSnapshot = logContextUsageSnapshot;
  proto.logModelRequestSteeringContext = logModelRequestSteeringContext;
  proto.buildModelMessageTailDiagnostics = buildModelMessageTailDiagnostics;
  proto.buildContextUsageSnapshot = buildContextUsageSnapshot;
  proto.buildContextUsageBreakdownFromSnapshot = buildContextUsageBreakdownFromSnapshot;
  proto.buildContextUsageCategory = buildContextUsageCategory;
  proto.buildToolUsageDetail = buildToolUsageDetail;
  proto.buildSkillUsageDetails = buildSkillUsageDetails;
  proto.buildMessageRoleBreakdown = buildMessageRoleBreakdown;
  proto.estimatedMetric = estimatedMetric;
  proto.estimatedMetricFromKnown = estimatedMetricFromKnown;
  proto.sumMetrics = sumMetrics;
  proto.toScheduleState = toScheduleState;
  proto.resumeFromStore = resumeFromStore;
  proto.readSessionTodosForContext = readSessionTodosForContext;
  proto.readSessionTargetForContext = readSessionTargetForContext;
  proto.injectTargetStateIntoMessageHistory = injectTargetStateIntoMessageHistory;
  proto.recordTargetChanged = recordTargetChanged;
  proto.recordGoalStateChangeReminder = recordGoalStateChangeReminder;
  proto.continueActiveTargetIfIdle = continueActiveTargetIfIdle;
  proto.continueActiveTargetLoop = continueActiveTargetLoop;
  proto.targetContinuationCandidate = targetContinuationCandidate;
  proto.accountTargetTurnCompletion = accountTargetTurnCompletion;
  proto.startTargetTurnAccounting = startTargetTurnAccounting;
  proto.heartbeatTargetTurnAccounting = heartbeatTargetTurnAccounting;
  proto.finishTargetTurnAccounting = finishTargetTurnAccounting;
  proto.pauseActiveTargetForCancellation = pauseActiveTargetForCancellation;
  proto.activatePausedTargetAfterResume = activatePausedTargetAfterResume;
  proto.runSessionStartHooks = runSessionStartHooks;
  proto.runUserPromptSubmitHooks = runUserPromptSubmitHooks;
  proto.runStopHooks = runStopHooks;
  proto.shouldContinueAfterStopHooks = shouldContinueAfterStopHooks;
  proto.executeTurn = executeTurn;
  proto.admitPrompt = admitPrompt;
  proto.executeTurnCommand = function (
    this: AgentRuntimeInternal,
    ...args: Parameters<typeof executeTurnCommand>
  ) {
    return this.trackResidencyBlockingWork(executeTurnCommand.apply(this, args));
  };
  proto.executeManualCompact = executeManualCompact;
  proto.autoCompactIfNeeded = autoCompactIfNeeded;
  proto.microcompactIfNeeded = microcompactIfNeeded;
  proto.reactiveCompactAfterContextExceeded = reactiveCompactAfterContextExceeded;
  proto.compactActiveConversation = compactActiveConversation;
  proto.executeRewindCommand = executeRewindCommand;
  proto.formatRewindStatus = formatRewindStatus;
  proto.rewindWorkspaceToCheckpoint = rewindWorkspaceToCheckpoint;
  proto.rewindToMessage = rewindToMessage;
  proto.rewindCascadeToMessage = rewindCascadeToMessage;
  proto.rewindConversationToMessage = rewindConversationToMessage;
  proto.rewindWorkspaceToMessage = rewindWorkspaceToMessage;
  proto.finishUnavailableRewind = finishUnavailableRewind;
  proto.restoreWorkspaceCheckpointArtifact = restoreWorkspaceCheckpointArtifact;
  proto.copySessionMessagesForFork = copySessionMessagesForFork;
  proto.listWorkspaceCheckpoints = listWorkspaceCheckpoints;
  proto.forkWorkspaceFromCheckpoint = forkWorkspaceFromCheckpoint;
  proto.forkStableConversationAtMessage = forkStableConversationAtMessage;
  proto.createSelectionSideConversation = createSelectionSideConversation;
  proto.forkConversationBeforeMessage = forkConversationBeforeMessage;
  proto.loadCheckpointMessagePreviews = loadCheckpointMessagePreviews;
  proto.previewWorkspaceFileRewind = previewWorkspaceFileRewind;
  proto.applyWorkspaceFileRewind = applyWorkspaceFileRewind;
  proto.scheduleTools = scheduleTools;
  proto.executeTools = executeTools;
  proto.emitToolScheduledEvents = emitToolScheduledEvents;
  proto.emitFileMutationCheckpoint = emitFileMutationCheckpoint;
  proto.emitPermissionRequest = emitPermissionRequest;
  proto.resolvePermission = resolvePermission;
  proto.readBackgroundBashOutput = readBackgroundBashOutput;
  proto.cancelBackgroundTask = cancelBackgroundTask;
  proto.stopBackgroundTask = stopBackgroundTask;
  proto.cancelRunningRuntimeBackgroundTasks = cancelRunningRuntimeBackgroundTasks;
  proto.hasRunningBackgroundTasks = hasRunningBackgroundTasks;
  proto.buildBackgroundTaskPayload = buildBackgroundTaskPayload;
  proto.createEvent = createEvent;
  proto.appendEvent = appendEvent;
  proto.notifyEventSinks = notifyEventSinks;
  proto.ensureSessionPersisted = ensureSessionPersisted;
  proto.isSessionPersisted = isSessionPersisted;
  proto.buildCompactTimelinePayload = buildCompactTimelinePayload;
  proto.persistCompactTimeline = persistCompactTimeline;
  proto.finishCompactTimelineFailure = finishCompactTimelineFailure;
  proto.recoverInterruptedCompactTimelines = recoverInterruptedCompactTimelines;
  proto.persistCompactSummary = persistCompactSummary;
  proto.persistUserPrompt = persistUserPrompt;
  proto.recordPendingModelChange = recordPendingModelChange;
  proto.recordPendingWorktreeCreation = recordPendingWorktreeCreation;
  proto.persistPendingWorktreeCreationTimeline = persistPendingWorktreeCreationTimeline;
  proto.persistPendingModelChangeTimeline = persistPendingModelChangeTimeline;
  proto.persistSyntheticUserNotice = persistSyntheticUserNotice;
  proto.persistSyntheticUserNoticeForSession = persistSyntheticUserNoticeForSession;
  proto.persistAssistantTimelinePartForSession = persistAssistantTimelinePartForSession;
  proto.persistAssistantMessage = persistAssistantMessage;
  proto.persistMessage = persistMessage;
  proto.persistPart = persistPart;
  proto.rebuildProjection = rebuildProjection;
  proto.generateWorkspaceText = generateWorkspaceText;
  proto.sampleModel = sampleModel;
  proto.drainMemoryExtractions = drainMemoryExtractions;
  proto.isProjectMemoryEnabled = isProjectMemoryEnabled;
}
