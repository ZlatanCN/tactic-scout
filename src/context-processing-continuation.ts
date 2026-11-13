import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type {
  ContextProcessingAllowance,
  ContextProcessingAllowanceConfiguration,
  ContextProcessingGrant,
} from "./context-processing-state.js";
import {
  contextProcessingEvidenceOperation,
  contextProcessingHash,
  contextProcessingInputText,
  defaultContextProcessingAllowance,
} from "./context-processing-state.js";
import { latestHumanMessage, messageText } from "./player-mentions.js";
import type { AgentStateType, EvidenceBatchState } from "./state.js";
import { createInitialRequestState } from "./state.js";

type ContinuationKind = ContextProcessingGrant["kind"];

type EvidenceContinuationKind = Exclude<ContinuationKind, "text_compaction">;

type EvidenceContinuationDefinition = {
  getEvidence: (state: AgentStateType) => EvidenceBatchState | null;
  route: string;
  setEvidence: (evidence: EvidenceBatchState | null) => Partial<AgentStateType>;
};

type ContinuationCandidate = Pick<
  ContextProcessingGrant,
  "kind" | "requestId" | "sourceHash" | "sourceMessageId"
>;

type ContinuationDecision =
  | { kind: "none" }
  | { kind: "active"; grant: ContextProcessingGrant }
  | { kind: "blocked"; update: Partial<AgentStateType> }
  | {
      kind: "duplicate";
      grant: ContextProcessingGrant;
      update: Partial<AgentStateType>;
    }
  | {
      kind: "granted";
      grant: ContextProcessingGrant;
      update: Partial<AgentStateType>;
    };

const evidenceContinuationByKind = {
  [contextProcessingEvidenceOperation.lookup]: {
    getEvidence: (state) => state.lookupEvidence,
    route: "prepare_lookup_evidence",
    setEvidence: (lookupEvidence) => ({ lookupEvidence }),
  },
  [contextProcessingEvidenceOperation.comparison]: {
    getEvidence: (state) => state.comparisonEvidence,
    route: "prepare_comparison_evidence",
    setEvidence: (comparisonEvidence) => ({ comparisonEvidence }),
  },
  [contextProcessingEvidenceOperation.playerRecommendation]: {
    getEvidence: (state) => state.playerRecommendationEvidence,
    route: "prepare_player_recommendation_evidence",
    setEvidence: (playerRecommendationEvidence) => ({
      playerRecommendationEvidence,
    }),
  },
  [contextProcessingEvidenceOperation.teamRecommendation]: {
    getEvidence: (state) => state.teamRecommendationEvidence,
    route: "prepare_team_recommendation_evidence",
    setEvidence: (teamRecommendationEvidence) => ({
      teamRecommendationEvidence,
    }),
  },
} satisfies Record<EvidenceContinuationKind, EvidenceContinuationDefinition>;

const explicitContinuationText =
  /^(?:继续(?:处理|刚才的(?:请求|任务)|上次的(?:请求|任务))?|continue(?: processing)?|resume)[。.!！?？]*$/iu;

const continuationKindByCommand = new Map<string, ContinuationKind>([
  ["继续长指令", "text_compaction"],
  ["继续查询", contextProcessingEvidenceOperation.lookup],
  ["继续比较", contextProcessingEvidenceOperation.comparison],
  ["继续球员推荐", contextProcessingEvidenceOperation.playerRecommendation],
  ["继续球队推荐", contextProcessingEvidenceOperation.teamRecommendation],
  ["continue instruction", "text_compaction"],
  ["continue lookup", contextProcessingEvidenceOperation.lookup],
  ["continue comparison", contextProcessingEvidenceOperation.comparison],
  [
    "continue player recommendation",
    contextProcessingEvidenceOperation.playerRecommendation,
  ],
  [
    "continue team recommendation",
    contextProcessingEvidenceOperation.teamRecommendation,
  ],
]);

const continuationKindFromMessage = (
  message: HumanMessage
): ContinuationKind | null =>
  continuationKindByCommand.get(
    messageText(message).trim().toLocaleLowerCase()
  ) ?? null;

const continuationMessageRequested = (message: BaseMessage): boolean =>
  message instanceof HumanMessage &&
  (explicitContinuationText.test(messageText(message).trim()) ||
    continuationKindFromMessage(message) !== null);

const humanMessageById = (
  state: AgentStateType,
  messageId: string
): HumanMessage | undefined => {
  const source = state.messages.find(
    (message) => message instanceof HumanMessage && message.id === messageId
  );

  return source instanceof HumanMessage ? source : undefined;
};

const compactionCanContinue = (
  state: AgentStateType,
  allowance: ContextProcessingAllowance | null
): boolean => {
  const { compaction } = state.contextProcessing;

  if (allowance === null || compaction === null) {
    return false;
  }

  const stoppedForAllowance =
    compaction.status === "allowance_exhausted" &&
    compaction.stopReason === "allowance_exhausted";

  return (
    stoppedForAllowance &&
    allowance.reservation === null &&
    allowance.requestId === compaction.requestId
  );
};

const evidenceCanContinue = (
  task: ReturnType<typeof outcomeEvidence>,
  allowance: ContextProcessingAllowance | null
): task is NonNullable<ReturnType<typeof outcomeEvidence>> & {
  evidence: EvidenceBatchState;
} => {
  const evidence = task?.evidence;

  if (
    task === null ||
    allowance === null ||
    evidence === null ||
    evidence === undefined
  ) {
    return false;
  }

  const stoppedForAllowance =
    evidence.status === "allowance_exhausted" &&
    evidence.failureReason === "allowance_exhausted";

  const requestIdentityMatches = evidence.requestId === allowance.requestId;

  return (
    stoppedForAllowance &&
    allowance.reservation === null &&
    requestIdentityMatches
  );
};

const continuationIsBlocked = (state: AgentStateType): boolean =>
  state.pendingClarification !== null ||
  state.faultTolerance.failure !== null ||
  state.outcome?.kind === "state_compatibility";

const compactionContinuationCandidate = (
  state: AgentStateType
): ContinuationCandidate | null => {
  const { allowance, clarification, compaction } = state.contextProcessing;

  if (!compactionCanContinue(state, allowance) || compaction === null) {
    return null;
  }

  const sourceMessage = humanMessageById(state, compaction.sourceMessageId);

  if (sourceMessage === undefined) {
    return null;
  }

  const sourceText = contextProcessingInputText(
    messageText(sourceMessage),
    compaction.sourceMessageId,
    clarification
  );

  if (contextProcessingHash(sourceText) !== compaction.sourceHash) {
    return null;
  }

  return {
    kind: "text_compaction",
    requestId: compaction.requestId,
    sourceHash: compaction.sourceHash,
    sourceMessageId: compaction.sourceMessageId,
  };
};

const outcomeEvidence = (
  state: AgentStateType
): {
  evidence: EvidenceBatchState | null;
  kind: ContinuationKind;
  resultJson: string;
  source: string;
} | null => {
  const { outcome } = state;

  if (
    outcome === null ||
    outcome.resultJson === null ||
    !("source" in outcome)
  ) {
    return null;
  }

  if (outcome.kind === "player_lookup") {
    if (
      state.conversationContext.activeLookup?.resultJson !== outcome.resultJson
    ) {
      return null;
    }

    return {
      evidence:
        evidenceContinuationByKind[
          contextProcessingEvidenceOperation.lookup
        ].getEvidence(state),
      kind: contextProcessingEvidenceOperation.lookup,
      resultJson: outcome.resultJson,
      source: outcome.source,
    };
  }

  if (outcome.kind === "player_comparison") {
    if (
      state.conversationContext.activeComparison.resultJson !==
      outcome.resultJson
    ) {
      return null;
    }

    return {
      evidence:
        evidenceContinuationByKind[
          contextProcessingEvidenceOperation.comparison
        ].getEvidence(state),
      kind: contextProcessingEvidenceOperation.comparison,
      resultJson: outcome.resultJson,
      source: outcome.source,
    };
  }

  if (outcome.kind === "player_recommendation") {
    if (
      state.conversationContext.activeRecommendation?.resultJson !==
      outcome.resultJson
    ) {
      return null;
    }

    return {
      evidence:
        evidenceContinuationByKind[
          contextProcessingEvidenceOperation.playerRecommendation
        ].getEvidence(state),
      kind: contextProcessingEvidenceOperation.playerRecommendation,
      resultJson: outcome.resultJson,
      source: outcome.source,
    };
  }

  if (outcome.kind === "team_recommendation") {
    if (
      state.conversationContext.activeTeamRecommendation?.resultJson !==
      outcome.resultJson
    ) {
      return null;
    }

    return {
      evidence:
        evidenceContinuationByKind[
          contextProcessingEvidenceOperation.teamRecommendation
        ].getEvidence(state),
      kind: contextProcessingEvidenceOperation.teamRecommendation,
      resultJson: outcome.resultJson,
      source: outcome.source,
    };
  }

  return null;
};

const evidenceContinuationCandidate = (
  state: AgentStateType
): ContinuationCandidate | null => {
  const { allowance } = state.contextProcessing;
  const task = outcomeEvidence(state);

  if (!evidenceCanContinue(task, allowance) || task === null) {
    return null;
  }

  const { evidence } = task;

  const sourceMessage = humanMessageById(state, evidence.sourceMessageId);

  if (
    sourceMessage === undefined ||
    evidence.questionHash !== contextProcessingHash(messageText(sourceMessage))
  ) {
    return null;
  }

  return {
    kind: task.kind,
    requestId: evidence.requestId,
    sourceHash: evidence.sourceHash,
    sourceMessageId: evidence.sourceMessageId,
  };
};

const continuationCandidatesFor = (
  state: AgentStateType
): ContinuationCandidate[] =>
  [
    compactionContinuationCandidate(state),
    evidenceContinuationCandidate(state),
  ].filter(
    (candidate): candidate is ContinuationCandidate => candidate !== null
  );

const continuationCommandForKind: Record<ContinuationKind, string> = {
  [contextProcessingEvidenceOperation.lookup]: "继续查询",
  [contextProcessingEvidenceOperation.comparison]: "继续比较",
  [contextProcessingEvidenceOperation.playerRecommendation]: "继续球员推荐",
  [contextProcessingEvidenceOperation.teamRecommendation]: "继续球队推荐",
  text_compaction: "继续长指令",
};

const blockedContinuationUpdate = (
  state: AgentStateType,
  message: HumanMessage,
  candidates: ContinuationCandidate[]
): Partial<AgentStateType> => {
  const commands = [
    ...new Set(candidates.map(({ kind }) => continuationCommandForKind[kind])),
  ];

  const answer =
    commands.length > 0
      ? `可继续的上下文处理目标：${commands.join("、")}。请明确回复目标；本次未追加额度。`
      : "当前没有可安全续接的上下文处理断点。只有任务明确因自动上下文处理额度耗尽、且原始请求和已验证进度仍有效时，继续才会追加额度。";

  return {
    messages: [new AIMessage(answer)],
    request: {
      ...(state.request ?? createInitialRequestState()),
      processedMessageId: message.id ?? null,
    },
  };
};

const currentContinuationGrant = (
  state: AgentStateType,
  message: BaseMessage | undefined
): ContextProcessingGrant | null => {
  if (message?.id === undefined || message.id.length === 0) {
    return null;
  }

  return (
    state.contextProcessing.allowance?.grants.find(
      (grant) => grant.continuationMessageId === message.id
    ) ?? null
  );
};

const existingCompactionGrantIsActive = (
  state: AgentStateType,
  grant: ContextProcessingGrant
): boolean => {
  const { allowance, clarification, compaction } = state.contextProcessing;

  if (
    grant.kind !== "text_compaction" ||
    allowance === null ||
    compaction === null
  ) {
    return false;
  }

  const isRunning = ["reserved", "chunking", "merging"].includes(
    compaction.status
  );

  const requestMatches =
    allowance.requestId === grant.requestId &&
    compaction.requestId === grant.requestId;

  const sourceMatches =
    compaction.sourceMessageId === grant.sourceMessageId &&
    compaction.sourceHash === grant.sourceHash;

  const identityMatches = requestMatches && sourceMatches;

  if (!isRunning || !identityMatches) {
    return false;
  }

  const sourceMessage = humanMessageById(state, grant.sourceMessageId);

  if (sourceMessage === undefined) {
    return false;
  }

  const sourceText = contextProcessingInputText(
    messageText(sourceMessage),
    grant.sourceMessageId,
    clarification
  );

  return contextProcessingHash(sourceText) === grant.sourceHash;
};

const existingEvidenceGrantIsActive = (
  state: AgentStateType,
  grant: ContextProcessingGrant
): boolean => {
  const { allowance } = state.contextProcessing;
  const task = outcomeEvidence(state);

  if (grant.kind === "text_compaction" || allowance === null || task === null) {
    return false;
  }

  if (task.kind !== grant.kind || task.evidence === null) {
    return false;
  }

  if (allowance.requestId !== grant.requestId) {
    return false;
  }

  const evidenceIdentityMatches =
    task.evidence.requestId === grant.requestId &&
    task.evidence.sourceMessageId === grant.sourceMessageId;

  const sourceMessage = humanMessageById(state, grant.sourceMessageId);

  const sourceQuestionMatches =
    sourceMessage !== undefined &&
    task.evidence.questionHash ===
      contextProcessingHash(messageText(sourceMessage));

  const { reservation } = allowance;

  const reservationMatchesGrant =
    reservation?.operation === grant.kind &&
    reservation.sourceMessageId === grant.sourceMessageId &&
    reservation.sourceHash === task.evidence.sourceHash;

  const processingWithoutReservation =
    task.evidence.status === "processing" && reservation === null;

  return (
    evidenceIdentityMatches &&
    sourceQuestionMatches &&
    (processingWithoutReservation || reservationMatchesGrant)
  );
};

const contextProcessingSourceMessage = (
  state: AgentStateType,
  currentMessage: HumanMessage
): HumanMessage => {
  const grant = currentContinuationGrant(state, currentMessage);

  if (
    grant === null ||
    state.request?.processedMessageId === grant.continuationMessageId
  ) {
    return currentMessage;
  }

  return humanMessageById(state, grant.sourceMessageId) ?? currentMessage;
};

const latestContextProcessingSourceMessage = (
  state: AgentStateType
): HumanMessage | undefined => {
  const latestMessage = latestHumanMessage(state.messages);

  return latestMessage === undefined
    ? undefined
    : contextProcessingSourceMessage(state, latestMessage);
};

const continuationUpdate = (
  state: AgentStateType,
  message: HumanMessage,
  grant: ContextProcessingGrant,
  allowance: ContextProcessingAllowance,
  status: "granted" | "duplicate"
): Partial<AgentStateType> => {
  if (status === "duplicate") {
    return {
      request: {
        ...(state.request ?? createInitialRequestState()),
        processedMessageId: message.id ?? null,
      },
    };
  }

  const contextProcessing = {
    ...state.contextProcessing,
    allowance,
  };

  if (grant.kind === "text_compaction") {
    const { compaction } = contextProcessing;

    return {
      contextProcessing: {
        ...contextProcessing,
        compaction:
          compaction === null
            ? null
            : {
                ...compaction,
                status: "chunking",
                stopReason: null,
              },
      },
    };
  }

  const task = outcomeEvidence(state);

  if (task === null || task.evidence === null || task.kind !== grant.kind) {
    return { contextProcessing };
  }

  const nextEvidence =
    task.evidence.batches.length === 0
      ? null
      : {
          ...task.evidence,
          failureReason: null,
          status: "processing" as const,
        };

  return {
    contextProcessing,
    ...evidenceContinuationByKind[grant.kind].setEvidence(nextEvidence),
  };
};

const evidenceContinuationNodeFor = (kind: EvidenceContinuationKind): string =>
  evidenceContinuationByKind[kind].route;

const beginContextProcessingContinuation = (
  state: AgentStateType,
  message: HumanMessage,
  configuration: ContextProcessingAllowanceConfiguration
): ContinuationDecision => {
  if (!continuationMessageRequested(message)) {
    return { kind: "none" };
  }

  if (message.id === undefined || message.id.length === 0) {
    return {
      kind: "blocked",
      update: {
        messages: [
          new AIMessage(
            "继续请求缺少稳定消息 ID，未追加额度。请重新发送一次“继续”。"
          ),
        ],
      },
    };
  }

  const { allowance } = state.contextProcessing;
  const existingGrant = currentContinuationGrant(state, message);

  if (allowance !== null && existingGrant !== null) {
    if (continuationIsBlocked(state)) {
      return {
        kind: "blocked",
        update: blockedContinuationUpdate(state, message, []),
      };
    }

    if (
      existingCompactionGrantIsActive(state, existingGrant) ||
      existingEvidenceGrantIsActive(state, existingGrant)
    ) {
      return { grant: existingGrant, kind: "active" };
    }

    return {
      grant: existingGrant,
      kind: "duplicate",
      update: continuationUpdate(
        state,
        message,
        existingGrant,
        allowance,
        "duplicate"
      ),
    };
  }

  const availableCandidates = continuationCandidatesFor(state);
  const requestedKind = continuationKindFromMessage(message);

  const candidates =
    requestedKind === null
      ? availableCandidates
      : availableCandidates.filter(({ kind }) => kind === requestedKind);

  const [candidate] = candidates;

  if (
    allowance === null ||
    candidate === undefined ||
    candidates.length !== 1 ||
    continuationIsBlocked(state)
  ) {
    return {
      kind: "blocked",
      update: blockedContinuationUpdate(
        state,
        message,
        continuationIsBlocked(state) ? [] : availableCandidates
      ),
    };
  }

  const grant: ContextProcessingGrant = {
    additionalActiveTimeMs:
      configuration.maxActiveTimeMs ??
      defaultContextProcessingAllowance.maxActiveTimeMs,
    additionalCalls:
      configuration.maxAdditionalCalls ??
      defaultContextProcessingAllowance.maxAdditionalCalls,
    continuationMessageId: message.id ?? "",
    kind: candidate.kind,
    requestId: candidate.requestId,
    sourceHash: candidate.sourceHash,
    sourceMessageId: candidate.sourceMessageId,
  };

  const updatedAllowance: ContextProcessingAllowance = {
    ...allowance,
    grants: [...allowance.grants, grant],
    maxActiveTimeMs: allowance.maxActiveTimeMs + grant.additionalActiveTimeMs,
    maxAdditionalCalls: allowance.maxAdditionalCalls + grant.additionalCalls,
  };

  return {
    grant,
    kind: "granted",
    update: continuationUpdate(
      state,
      message,
      grant,
      updatedAllowance,
      "granted"
    ),
  };
};

export {
  beginContextProcessingContinuation,
  contextProcessingSourceMessage,
  latestContextProcessingSourceMessage,
  continuationMessageRequested,
  currentContinuationGrant,
  evidenceContinuationNodeFor,
};

export type {
  ContinuationKind,
  ContinuationDecision,
  EvidenceContinuationKind,
};
