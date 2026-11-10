import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import type { ContextProcessingAllowance } from "../context-processing-state.js";
import { contextProcessingHash } from "../context-processing-state.js";
import { scoutingEvidenceProjections } from "../lookup-evidence.js";
import { invokeWithModelContext } from "../model-context.js";
import type { ModelContextConfiguration } from "../model-context.js";
import { createModelRequestBudget } from "../model-requests.js";
import type { ModelRuntime } from "../model-requests.js";
import { latestHumanMessage, messageText } from "../player-mentions.js";
import type {
  AgentStateType,
  LookupEvidenceState,
  AgentState,
} from "../state.js";
import { defaultContextProcessingAllowance } from "./text-compaction.js";
import type { TextCompactionAllowanceConfiguration } from "./text-compaction.js";

const lookupEvidencePrompt = `你在解释一条已验证球员查询的结构化证据。输入是从完整结果生成的单批 scouting evidence projection；digest、记录引用、来源、赛季、coverage 和剩余范围来自程序。只回答当前这一批直接支持的事实，不从单批推导所有来源、所有赛季或整组球员的结论。fieldStates 中 state=value 表示来源给出了该值，state=source_null 表示来源明确返回 null。unselectedFields 表示没有选择的字段，不是缺失值。provider status=unavailable、not_found 和 not_queried 含义不同。Understat 的表现记录保留实际赛事和赛季；FM 是能力快照，不能据此声称赛季表现或当前注册。当 understat seasonMode=explicit_unresolved 时，说明用户明确写了赛季，但程序没有把它转换为查询范围；不能把 default_snapshot 的记录当成所请求的赛季，要求用户补充完整范围。可以标注记录实际包含的赛季，但不能用它替代用户的请求范围。不要引入外部事实，也不要重查来源。`;

const textContentSchema = z.array(
  z.looseObject({ text: z.string(), type: z.literal("text") })
);

const evidenceBatchProjectionSchema = z.object({
  batch: z.object({ recordRefs: z.array(z.string()) }),
});

type EvidenceRequestIdentity = {
  requestId: string;
  sourceMessageId: string;
};

type EvidenceRequestHashes = EvidenceRequestIdentity & {
  questionHash: string;
  resultDigest: string;
  source: "executed" | "saved";
  sourceHash: string;
};

type LookupEvidenceNodeConfiguration = {
  allowance?: TextCompactionAllowanceConfiguration;
  model: BaseChatModel;
  modelContextConfiguration?: ModelContextConfiguration;
};

const textFromMessage = (message: BaseMessage): string | null => {
  const directText = z.string().safeParse(message.content);

  if (directText.success) {
    return directText.data;
  }

  const blocks = textContentSchema.safeParse(message.content);

  return blocks.success ? blocks.data.map(({ text }) => text).join("") : null;
};

const requestIdentityForEvidence = (
  state: AgentStateType,
  sourceMessage: BaseMessage,
  question: string
): EvidenceRequestIdentity => {
  const { allowance } = state.contextProcessing;
  const { compaction } = state.contextProcessing;
  const sourceMessageId = sourceMessage.id ?? "";

  const compactionMatchesMessage =
    compaction !== null &&
    (sourceMessageId.length > 0
      ? compaction.sourceMessageId === sourceMessageId
      : compaction.sourceHash === contextProcessingHash(question));

  if (allowance !== null && compactionMatchesMessage && compaction !== null) {
    return {
      requestId: allowance.requestId,
      sourceMessageId: compaction.sourceMessageId,
    };
  }

  if (sourceMessageId.length > 0) {
    return { requestId: `message:${sourceMessageId}`, sourceMessageId };
  }

  const messageIndex = state.messages.indexOf(sourceMessage);
  const requestId = `message:${messageIndex + 1}:${contextProcessingHash(question)}`;

  return { requestId, sourceMessageId: requestId };
};

const requestHashesForEvidence = (
  identity: EvidenceRequestIdentity,
  question: string,
  resultJson: string,
  source: "executed" | "saved"
): EvidenceRequestHashes => {
  const resultDigest = contextProcessingHash(resultJson);
  const questionHash = contextProcessingHash(question);

  return {
    ...identity,
    questionHash,
    resultDigest,
    source,
    sourceHash: contextProcessingHash(
      `${source}:${identity.sourceMessageId}:${resultDigest}:${questionHash}:lookup-evidence-v1`
    ),
  };
};

const evidenceMatchesRequest = (
  evidence: LookupEvidenceState | null | undefined,
  input: EvidenceRequestHashes
): evidence is LookupEvidenceState => {
  if (evidence === null || evidence === undefined) {
    return false;
  }

  const sameRequest =
    evidence.requestId === input.requestId &&
    evidence.sourceMessageId === input.sourceMessageId &&
    evidence.source === input.source;

  const sameEvidence =
    evidence.questionHash === input.questionHash &&
    evidence.resultDigest === input.resultDigest &&
    evidence.sourceHash === input.sourceHash;

  return sameRequest && sameEvidence;
};

const lookupEvidenceMatchesCurrentOutcome = (
  state: AgentStateType
): boolean => {
  const { outcome } = state;
  const sourceMessage = latestHumanMessage(state.messages);

  if (
    outcome?.kind !== "player_lookup" ||
    outcome.resultJson === null ||
    !("source" in outcome) ||
    sourceMessage === undefined
  ) {
    return false;
  }

  const question = messageText(sourceMessage);

  const requestIdentity = requestIdentityForEvidence(
    state,
    sourceMessage,
    question
  );

  const requestHashes = requestHashesForEvidence(
    requestIdentity,
    question,
    outcome.resultJson,
    outcome.source
  );

  return evidenceMatchesRequest(state.lookupEvidence, requestHashes);
};

const evidenceForResult = (
  state: AgentStateType,
  input: {
    hashes: EvidenceRequestHashes;
    question: string;
    resultJson: string;
    source: "executed" | "saved";
  }
): LookupEvidenceState | null => {
  const existing = state.lookupEvidence ?? null;

  if (evidenceMatchesRequest(existing, input.hashes)) {
    return existing;
  }

  const projections = scoutingEvidenceProjections(
    input.resultJson,
    input.question,
    input.source
  );

  if (projections === null) {
    return null;
  }

  const batches = projections.map((projectionJson, index) => {
    const projection = evidenceBatchProjectionSchema.parse(
      JSON.parse(projectionJson)
    );

    return {
      answer: null,
      index,
      projectionJson,
      recordRefs: projection.batch.recordRefs,
      status: "pending" as const,
    };
  });

  return {
    batches,
    failureReason: null,
    questionHash: input.hashes.questionHash,
    requestId: input.hashes.requestId,
    resultDigest: input.hashes.resultDigest,
    source: input.source,
    sourceHash: input.hashes.sourceHash,
    sourceMessageId: input.hashes.sourceMessageId,
    status: "pending",
  };
};

const allowanceForEvidence = (
  state: AgentStateType,
  requestId: string,
  configuration: TextCompactionAllowanceConfiguration
): ContextProcessingAllowance => {
  const { allowance } = state.contextProcessing;

  if (allowance !== null && allowance.requestId === requestId) {
    return allowance;
  }

  return {
    consumedActiveTimeMs: 0,
    consumedAdditionalCalls: 0,
    maxActiveTimeMs:
      configuration.maxActiveTimeMs ??
      defaultContextProcessingAllowance.maxActiveTimeMs,
    maxAdditionalCalls:
      configuration.maxAdditionalCalls ??
      defaultContextProcessingAllowance.maxAdditionalCalls,
    requestId,
    reservation: null,
  };
};

const settleAllowance = (
  allowance: ContextProcessingAllowance,
  callsUsed: number,
  durationMs: number
): ContextProcessingAllowance => ({
  ...allowance,
  consumedActiveTimeMs: Math.min(
    allowance.maxActiveTimeMs,
    allowance.consumedActiveTimeMs + durationMs
  ),
  consumedAdditionalCalls: Math.min(
    allowance.maxAdditionalCalls,
    allowance.consumedAdditionalCalls + callsUsed
  ),
  reservation: null,
});

const failedEvidenceWithUnknownReservation = (
  state: AgentStateType,
  evidence: LookupEvidenceState,
  allowance: ContextProcessingAllowance
): Partial<AgentStateType> => {
  const { reservation } = allowance;

  if (
    reservation === null ||
    reservation.operation !== "explain_lookup_evidence"
  ) {
    return { lookupEvidence: { ...evidence, status: "failed" } };
  }

  return {
    contextProcessing: {
      ...state.contextProcessing,
      allowance: settleAllowance(
        allowance,
        reservation.maxAdditionalCalls,
        reservation.maxActiveTimeMs
      ),
    },
    lookupEvidence: {
      ...evidence,
      batches: evidence.batches.map((batch) =>
        batch.index === reservation.chunkIndex
          ? { ...batch, status: "failed" }
          : batch
      ),
      failureReason: "reservation_unknown",
      status: "failed",
    },
  };
};

const reserveNextEvidenceBatch = (
  state: AgentStateType,
  evidence: LookupEvidenceState,
  allowance: ContextProcessingAllowance
): Partial<AgentStateType> => {
  if (evidence.status !== "pending" && evidence.status !== "processing") {
    return {};
  }

  if (allowance.reservation !== null) {
    return failedEvidenceWithUnknownReservation(state, evidence, allowance);
  }

  const batchIndex = evidence.batches.findIndex(
    ({ status }) => status === "pending"
  );

  if (batchIndex === -1) {
    const allBatchesReady = evidence.batches.every(
      ({ answer, status }) => status === "ready" && answer !== null
    );

    if (!allBatchesReady) {
      return {
        lookupEvidence: {
          ...evidence,
          failureReason: "reservation_unknown",
          status: "failed",
        },
      };
    }

    return { lookupEvidence: { ...evidence, status: "complete" } };
  }

  const availableCalls =
    allowance.maxAdditionalCalls - allowance.consumedAdditionalCalls;

  const availableTime =
    allowance.maxActiveTimeMs - allowance.consumedActiveTimeMs;

  if (availableCalls < 1 || availableTime < 1) {
    return {
      lookupEvidence: {
        ...evidence,
        failureReason: "allowance_exhausted",
        status: "allowance_exhausted",
      },
    };
  }

  const batch = evidence.batches[batchIndex];

  if (batch === undefined) {
    return {
      lookupEvidence: {
        ...evidence,
        failureReason: "call_failed",
        status: "failed",
      },
    };
  }

  const reservation = {
    chunkIndex: batch.index,
    maxActiveTimeMs: availableTime,
    maxAdditionalCalls: 1,
    operation: "explain_lookup_evidence" as const,
    operationId: contextProcessingHash(
      `${evidence.requestId}:${evidence.sourceHash}:batch:${batch.index}`
    ),
    sourceHash: evidence.sourceHash,
    sourceMessageId: evidence.sourceMessageId,
  };

  return {
    contextProcessing: {
      ...state.contextProcessing,
      allowance: { ...allowance, reservation },
    },
    lookupEvidence: {
      ...evidence,
      batches: evidence.batches.map((item, index) =>
        index === batchIndex ? { ...item, status: "reserved" } : item
      ),
      status: "processing",
    },
  };
};

const createPrepareLookupEvidenceNode =
  (
    configuration: Pick<LookupEvidenceNodeConfiguration, "allowance">
  ): GraphNode<typeof AgentState> =>
  (state: AgentStateType) => {
    const { outcome } = state;

    if (
      outcome?.kind !== "player_lookup" ||
      outcome.resultJson === null ||
      !("source" in outcome)
    ) {
      return {};
    }

    const sourceMessage = latestHumanMessage(state.messages);

    if (sourceMessage === undefined) {
      return {};
    }

    const question = messageText(sourceMessage);

    const requestIdentity = requestIdentityForEvidence(
      state,
      sourceMessage,
      question
    );

    const hashes = requestHashesForEvidence(
      requestIdentity,
      question,
      outcome.resultJson,
      outcome.source
    );

    const evidence = evidenceForResult(state, {
      hashes,
      question,
      resultJson: outcome.resultJson,
      source: outcome.source,
    });

    if (evidence === null) {
      return {};
    }

    const allowance = allowanceForEvidence(
      state,
      hashes.requestId,
      configuration.allowance ?? {}
    );

    return reserveNextEvidenceBatch(state, evidence, allowance);
  };

const evidenceReservationFromState = (state: AgentStateType) => {
  const { allowance } = state.contextProcessing;
  const evidence = state.lookupEvidence ?? null;

  if (allowance === null || evidence === null) {
    return null;
  }

  const { reservation } = allowance;

  if (reservation === null) {
    return null;
  }

  if (
    reservation.operation !== "explain_lookup_evidence" ||
    reservation.chunkIndex === null
  ) {
    return null;
  }

  const batch = evidence.batches.find(
    ({ index, status }) =>
      index === reservation.chunkIndex && status === "reserved"
  );

  return batch === undefined
    ? null
    : { allowance, batch, evidence, reservation };
};

const failedBatchUpdate = (
  state: AgentStateType,
  failureReason: "call_failed" | "reservation_unknown",
  callsUsed: number,
  durationMs: number
): Partial<AgentStateType> => {
  const { allowance } = state.contextProcessing;
  const evidence = state.lookupEvidence ?? null;

  if (allowance === null || evidence === null) {
    return {
      lookupEvidence:
        evidence === null
          ? null
          : { ...evidence, failureReason, status: "failed" },
    };
  }

  const batchIndex = allowance.reservation?.chunkIndex;

  return {
    contextProcessing: {
      ...state.contextProcessing,
      allowance: settleAllowance(allowance, callsUsed, durationMs),
    },
    lookupEvidence: {
      ...evidence,
      batches: evidence.batches.map((batch) =>
        batch.index === batchIndex ? { ...batch, status: "failed" } : batch
      ),
      failureReason,
      status: "failed",
    },
  };
};

const responseText = (response: BaseMessage): string | null =>
  textFromMessage(response);

const createAnswerLookupEvidenceBatchNode =
  (
    configuration: LookupEvidenceNodeConfiguration
  ): GraphNode<typeof AgentState> =>
  async (state: AgentStateType, runtime: ModelRuntime) => {
    const reserved = evidenceReservationFromState(state);
    const sourceMessage = latestHumanMessage(state.messages);

    if (reserved === null || sourceMessage === undefined) {
      return failedBatchUpdate(state, "reservation_unknown", 0, 0);
    }

    const { allowance, batch, evidence, reservation } = reserved;

    const budget = createModelRequestBudget(
      runtime,
      "answer",
      reservation.maxAdditionalCalls
    );

    const startedAt = Date.now();

    const requestMessages = [
      new SystemMessage(lookupEvidencePrompt),
      new HumanMessage(
        `用户问题：${messageText(sourceMessage)}\n\nScouting evidence projection JSON:\n${batch.projectionJson}`
      ),
    ];

    const activeTimeSignal = AbortSignal.timeout(reservation.maxActiveTimeMs);

    const requestRuntime = {
      ...runtime,
      signal:
        runtime.signal === undefined
          ? activeTimeSignal
          : AbortSignal.any([runtime.signal, activeTimeSignal]),
    };

    try {
      const response = await invokeWithModelContext(
        configuration.model,
        { messages: requestMessages, purpose: "answer" },
        configuration.modelContextConfiguration ?? {},
        requestRuntime,
        async (limitedModel, signal) =>
          await limitedModel.invoke(requestMessages, { signal }),
        budget
      );

      const answer = responseText(response);

      if (answer === null || answer.trim().length === 0) {
        return failedBatchUpdate(
          state,
          "call_failed",
          budget.requestsUsed(),
          Date.now() - startedAt
        );
      }

      return {
        contextProcessing: {
          ...state.contextProcessing,
          allowance: settleAllowance(
            allowance,
            budget.requestsUsed(),
            Date.now() - startedAt
          ),
        },
        lookupEvidence: {
          ...evidence,
          batches: evidence.batches.map((item) =>
            item.index === batch.index
              ? { ...item, answer, status: "ready" }
              : item
          ),
        },
      };
    } catch {
      return failedBatchUpdate(
        state,
        "call_failed",
        budget.requestsUsed(),
        Date.now() - startedAt
      );
    }
  };

const lookupEvidenceRoute = (state: AgentStateType): string => {
  const evidence = state.lookupEvidence ?? null;
  const operation = state.contextProcessing.allowance?.reservation?.operation;

  return evidence?.status === "processing" &&
    operation === "explain_lookup_evidence"
    ? "answer_lookup_evidence_batch"
    : "answer";
};

export {
  createAnswerLookupEvidenceBatchNode,
  createPrepareLookupEvidenceNode,
  lookupEvidenceMatchesCurrentOutcome,
  lookupEvidenceRoute,
};
