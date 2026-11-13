import type { HumanMessage } from "@langchain/core/messages";

import {
  contextProcessingHash,
  contextProcessingRequestId,
  contextProcessingRequestMatches,
} from "./context-processing-state.js";
import type { ContextProcessingAllowance } from "./context-processing-state.js";
import {
  maxExternalRequests,
  modelRequestTimeoutMs,
} from "./fault-tolerance.js";
import type {
  ModelRequestBudget,
  ModelRequestBudgetOptions,
} from "./model-requests.js";
import { latestHumanMessage, messageText } from "./player-mentions.js";
import type { AgentStateType } from "./state.js";

type PrimaryOverflowRecoveryNode = "understand_request" | "lookup_player";

type PrimaryOverflowRecoveryFailureInput = {
  message: HumanMessage;
  messageCount: number;
  node: PrimaryOverflowRecoveryNode;
  requestAttemptsUsed: number;
  requestDurationMs: number;
  runId?: string;
  state: AgentStateType;
};

const consumedActiveTimeAfter = (
  allowance: ContextProcessingAllowance,
  requestDurationMs: number
): number =>
  Math.min(
    allowance.maxActiveTimeMs,
    allowance.consumedActiveTimeMs + requestDurationMs
  );

const primaryOverflowAllowanceAfterDuration = (
  allowance: ContextProcessingAllowance,
  requestDurationMs: number
): ContextProcessingAllowance => ({
  ...allowance,
  consumedActiveTimeMs: consumedActiveTimeAfter(allowance, requestDurationMs),
});

const primaryOverflowRecoveryFor = (
  state: AgentStateType,
  node: PrimaryOverflowRecoveryNode,
  message: HumanMessage,
  messageCount: number
) => {
  const sourceText = messageText(message);

  const recovery = state.providerOverflowRecovery;

  return recovery?.node === node &&
    contextProcessingRequestMatches(
      recovery,
      message.id,
      sourceText,
      messageCount
    )
    ? recovery
    : null;
};

const reservePrimaryOverflowRecovery = (
  node: PrimaryOverflowRecoveryNode,
  state: AgentStateType,
  requestAttemptsUsed: number,
  requestDurationMs: number,
  runId: string | undefined
): Partial<AgentStateType> | null => {
  const sourceMessage = latestHumanMessage(state.messages);

  if (sourceMessage === undefined) {
    return null;
  }

  const sourceText = messageText(sourceMessage);
  const sourceHash = contextProcessingHash(sourceText);

  const sourceRequestId = contextProcessingRequestId(
    sourceMessage.id,
    sourceText,
    state.messages.length
  );

  const { allowance } = state.contextProcessing;

  if (allowance === null) {
    return null;
  }

  const allowanceAfterFailedRequest = primaryOverflowAllowanceAfterDuration(
    allowance,
    requestDurationMs
  );

  if (
    allowance.requestId !== sourceRequestId ||
    allowance.reservation !== null ||
    allowance.consumedAdditionalCalls >= allowance.maxAdditionalCalls
  ) {
    return null;
  }

  const remainingActiveTimeMs =
    allowanceAfterFailedRequest.maxActiveTimeMs -
    allowanceAfterFailedRequest.consumedActiveTimeMs -
    allowanceAfterFailedRequest.reservedActiveTimeMs;

  if (remainingActiveTimeMs < 1) {
    return null;
  }

  const reservedActiveTimeMs = Math.min(
    modelRequestTimeoutMs,
    remainingActiveTimeMs
  );

  const recoveryAllowanceCallsReserved = Math.min(
    allowance.maxAdditionalCalls - allowance.consumedAdditionalCalls,
    Math.max(0, maxExternalRequests - requestAttemptsUsed)
  );

  if (recoveryAllowanceCallsReserved < 1) {
    return null;
  }

  const previousRecovery = state.providerOverflowRecovery;

  const previousRecoveryMatches =
    previousRecovery?.node === node &&
    contextProcessingRequestMatches(
      previousRecovery,
      sourceMessage.id,
      sourceText,
      state.messages.length
    );

  if (previousRecoveryMatches && previousRecovery.recoveryAllowanceOpen) {
    return null;
  }

  return {
    contextProcessing: {
      ...state.contextProcessing,
      allowance: {
        ...allowanceAfterFailedRequest,
        consumedAdditionalCalls:
          allowance.consumedAdditionalCalls + recoveryAllowanceCallsReserved,
        reservedActiveTimeMs:
          allowance.reservedActiveTimeMs + reservedActiveTimeMs,
      },
    },
    providerOverflowRecovery: {
      attempts: previousRecoveryMatches ? previousRecovery.attempts : 1,
      node,
      operationRequestsUsed: requestAttemptsUsed,
      primaryRequestReserved: false,
      recoveryAllowanceCallsReserved,
      recoveryAllowanceOpen: true,
      reservedActiveTimeMs,
      runId: runId ?? null,
      sourceHash,
      sourceRequestId,
    },
  };
};

const primaryOverflowRecoveryBudgetOptions = (
  state: AgentStateType,
  recovery: ReturnType<typeof primaryOverflowRecoveryFor>,
  runId?: string
): ModelRequestBudgetOptions => {
  if (recovery === null) {
    return {};
  }

  const { allowance } = state.contextProcessing;
  const sameRun = recovery.runId === (runId ?? null);

  const recoveryCanResume =
    recovery.recoveryAllowanceOpen &&
    recovery.primaryRequestReserved &&
    sameRun;

  const recoveryIsUnavailable =
    recovery.recoveryAllowanceOpen && !recoveryCanResume;

  let maximumActiveTimeMs = recovery.reservedActiveTimeMs;
  let maximumRequests = maxExternalRequests;

  if (recoveryCanResume) {
    maximumRequests = Math.min(
      maxExternalRequests,
      recovery.operationRequestsUsed + recovery.recoveryAllowanceCallsReserved
    );
  } else if (recoveryIsUnavailable) {
    maximumActiveTimeMs = 0;
    maximumRequests = recovery.operationRequestsUsed;
  }

  if (!recovery.recoveryAllowanceOpen && allowance !== null) {
    maximumActiveTimeMs = Math.max(
      0,
      allowance.maxActiveTimeMs -
        allowance.consumedActiveTimeMs -
        allowance.reservedActiveTimeMs
    );
  }

  return {
    maximumActiveTimeMs,
    maximumRequests,
    previousRequestsUsed: recovery.operationRequestsUsed,
    retryTransientFailuresInternally: recoveryCanResume,
  };
};

const settledAdditionalCalls = (
  allowance: ContextProcessingAllowance,
  recovery: NonNullable<AgentStateType["providerOverflowRecovery"]>,
  operationRequestsUsed: number,
  runId?: string
): number => {
  if (!recovery.recoveryAllowanceOpen) {
    return allowance.consumedAdditionalCalls;
  }

  if (recovery.primaryRequestReserved && recovery.runId !== (runId ?? null)) {
    return allowance.consumedAdditionalCalls;
  }

  const actualRecoveryCalls = Math.min(
    recovery.recoveryAllowanceCallsReserved,
    Math.max(0, operationRequestsUsed - recovery.operationRequestsUsed)
  );

  const unusedReservation =
    recovery.recoveryAllowanceCallsReserved - actualRecoveryCalls;

  return Math.max(0, allowance.consumedAdditionalCalls - unusedReservation);
};

const settlePrimaryOverflowRecoveryState = (
  state: AgentStateType,
  recovery: NonNullable<AgentStateType["providerOverflowRecovery"]>,
  update: Partial<AgentStateType>,
  operationRequestsUsed: number,
  requestDurationMs: number,
  runId: string | undefined,
  attemptIncrement: 0 | 1
): Partial<AgentStateType> => {
  const contextProcessing = update.contextProcessing ?? state.contextProcessing;
  const { allowance } = contextProcessing;

  if (allowance === null) {
    return update;
  }

  const recoveryCompletionIsUnknown =
    recovery.recoveryAllowanceOpen &&
    recovery.primaryRequestReserved &&
    recovery.runId !== (runId ?? null);

  const unknownRecoveryTime = recoveryCompletionIsUnknown
    ? recovery.reservedActiveTimeMs
    : requestDurationMs;

  return {
    ...update,
    contextProcessing: {
      ...contextProcessing,
      allowance: {
        ...primaryOverflowAllowanceAfterDuration(
          allowance,
          unknownRecoveryTime
        ),
        consumedAdditionalCalls: settledAdditionalCalls(
          allowance,
          recovery,
          operationRequestsUsed,
          runId
        ),
        reservedActiveTimeMs: Math.max(
          0,
          allowance.reservedActiveTimeMs - recovery.reservedActiveTimeMs
        ),
      },
    },
    providerOverflowRecovery: {
      ...recovery,
      attempts: recovery.attempts + attemptIncrement,
      operationRequestsUsed,
      primaryRequestReserved: false,
      recoveryAllowanceCallsReserved: 0,
      recoveryAllowanceOpen: false,
      reservedActiveTimeMs: 0,
    },
  };
};

const settlePrimaryOverflowRecovery = (
  state: AgentStateType,
  recovery: ReturnType<typeof primaryOverflowRecoveryFor>,
  budget: ModelRequestBudget,
  update: Partial<AgentStateType>,
  runId?: string
): Partial<AgentStateType> =>
  recovery === null
    ? update
    : settlePrimaryOverflowRecoveryState(
        state,
        recovery,
        update,
        budget.requestsUsed(),
        budget.activeTimeUsedMs(),
        runId,
        0
      );

const settlePrimaryOverflowRecoveryFailure = (
  input: PrimaryOverflowRecoveryFailureInput
): Partial<AgentStateType> | null => {
  const {
    message,
    messageCount,
    node,
    requestAttemptsUsed,
    requestDurationMs,
    runId,
    state,
  } = input;

  const recovery = primaryOverflowRecoveryFor(
    state,
    node,
    message,
    messageCount
  );

  const { allowance } = state.contextProcessing;

  if (recovery === null || allowance === null) {
    return null;
  }

  return settlePrimaryOverflowRecoveryState(
    state,
    recovery,
    {},
    requestAttemptsUsed,
    requestDurationMs,
    runId,
    1
  );
};

export {
  primaryOverflowAllowanceAfterDuration,
  primaryOverflowRecoveryBudgetOptions,
  primaryOverflowRecoveryFor,
  reservePrimaryOverflowRecovery,
  settlePrimaryOverflowRecoveryFailure,
  settlePrimaryOverflowRecovery,
};

export type { PrimaryOverflowRecoveryNode };
