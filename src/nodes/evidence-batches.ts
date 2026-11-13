import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import {
  currentContinuationGrant,
  latestContextProcessingSourceMessage,
} from "../context-processing-continuation.js";
import type {
  ContextProcessingAllowance,
  ContextProcessingAllowanceConfiguration,
  ContextProcessingEvidenceOperation,
  ContextProcessingReservation,
} from "../context-processing-state.js";
import {
  contextProcessingHash,
  defaultContextProcessingAllowance,
} from "../context-processing-state.js";
import { maxExternalRequests } from "../fault-tolerance.js";
import {
  assessModelRequest,
  invokeWithModelContext,
  modelContextFailure,
} from "../model-context.js";
import type { ModelContextConfiguration } from "../model-context.js";
import { createModelRequestBudget } from "../model-requests.js";
import type { ModelRequestBudget, ModelRuntime } from "../model-requests.js";
import { latestHumanMessage, messageText } from "../player-mentions.js";
import type {
  AgentState,
  AgentStateType,
  EvidenceBatchState,
} from "../state.js";

type EvidenceSource = "executed" | "saved";

type EvidenceProjection = {
  projectionJson: string;
  recordRefs: string[];
};

type EvidenceTask = {
  maxItemsPerBatch?: number;
  question: string;
  resultJson: string;
  source: EvidenceSource;
};

type EvidenceRequestHashes = {
  questionHash: string;
  requestId: string;
  resultDigest: string;
  source: EvidenceSource;
  sourceHash: string;
  sourceMessageId: string;
};

type EvidenceWorkflow = {
  cacheTag: string;
  complete?: (evidence: EvidenceBatchState, task: EvidenceTask) => boolean;
  getEvidence: (state: AgentStateType) => EvidenceBatchState | null | undefined;
  getResult: (state: AgentStateType) => {
    resultJson: string;
    source: EvidenceSource;
  } | null;
  operation: ContextProcessingEvidenceOperation;
  project: (
    task: EvidenceTask & {
      deadlineAt: number;
      maxItemsPerBatch?: number;
      sourceMessageId: string;
    }
  ) => Promise<EvidenceProjection[] | null> | EvidenceProjection[] | null;
  splitBatch?: (
    task: EvidenceTask,
    batches: EvidenceBatchState["batches"],
    batchIndex: number
  ) => EvidenceProjection[] | null;
  questionMessage: (question: string, projectionJson: string) => string;
  setEvidence: (evidence: EvidenceBatchState) => Partial<AgentStateType>;
  shouldProcess?: (
    state: AgentStateType,
    task: EvidenceTask,
    sourceMessage: BaseMessage
  ) => Promise<boolean>;
  systemPrompt: string;
  transformAnswer?: (answer: string, projectionJson: string) => string;
};

type EvidenceBatchNodeConfiguration = {
  allowance?: ContextProcessingAllowanceConfiguration;
  model: BaseChatModel;
  modelContextConfiguration?: ModelContextConfiguration;
};

const evidenceProjectionsFitModelInput = async (
  projections: readonly { projectionJson: string }[],
  model: BaseChatModel,
  modelContextConfiguration: ModelContextConfiguration | undefined,
  deadlineAt: number,
  messagesForProjection: (projectionJson: string) => BaseMessage[]
): Promise<boolean> => {
  const projectionFitsAt = async (index: number): Promise<boolean> => {
    if (Date.now() >= deadlineAt) {
      return false;
    }

    const projection = projections[index];

    if (projection === undefined) {
      return true;
    }

    try {
      const assessment = await assessModelRequest(
        model,
        {
          messages: messagesForProjection(projection.projectionJson),
          purpose: "answer",
        },
        modelContextConfiguration ?? {}
      );

      return (
        assessment.failure === null &&
        Date.now() < deadlineAt &&
        (await projectionFitsAt(index + 1))
      );
    } catch {
      return false;
    }
  };

  return await projectionFitsAt(0);
};

const largestFittingEvidencePlan = async (
  maximumBatchSize: number,
  deadlineAt: number,
  projectAtSize: (batchSize: number) => EvidenceProjection[] | null,
  projectionsFit: (projections: EvidenceProjection[]) => Promise<boolean>
): Promise<EvidenceProjection[] | null> => {
  const findAtSize = async (
    batchSize: number
  ): Promise<EvidenceProjection[] | null> => {
    if (Date.now() >= deadlineAt) {
      return null;
    }

    const projections = projectAtSize(batchSize);

    if (projections !== null && (await projectionsFit(projections))) {
      return projections;
    }

    return batchSize <= 1 ? null : await findAtSize(batchSize - 1);
  };

  return await findAtSize(Math.max(maximumBatchSize, 1));
};

type EvidenceRequestIdentity = {
  requestId: string;
  sourceMessageId: string;
};

const textContentSchema = z.array(
  z.looseObject({ text: z.string(), type: z.literal("text") })
);

const messageTextFromResponse = (message: BaseMessage): string | null => {
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
  const { allowance, compaction } = state.contextProcessing;
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
  workflow: EvidenceWorkflow,
  identity: EvidenceRequestIdentity,
  task: EvidenceTask
): EvidenceRequestHashes => {
  const resultDigest = contextProcessingHash(task.resultJson);
  const questionHash = contextProcessingHash(task.question);

  return {
    ...identity,
    questionHash,
    resultDigest,
    source: task.source,
    sourceHash: contextProcessingHash(
      `${task.source}:${identity.sourceMessageId}:${resultDigest}:${questionHash}:${workflow.cacheTag}`
    ),
  };
};

const evidenceMatchesRequest = (
  evidence: EvidenceBatchState | null | undefined,
  input: EvidenceRequestHashes
): evidence is EvidenceBatchState => {
  if (evidence === null || evidence === undefined) {
    return false;
  }

  const mismatches = [
    evidence.requestId !== input.requestId,
    evidence.sourceMessageId !== input.sourceMessageId,
    evidence.source !== input.source,
    evidence.questionHash !== input.questionHash,
    evidence.resultDigest !== input.resultDigest,
    evidence.sourceHash !== input.sourceHash,
  ];

  return mismatches.every((mismatch) => !mismatch);
};

const answerEvidenceRecoveryIsPending = (state: AgentStateType): boolean =>
  state.faultTolerance.failure?.node === "answer" &&
  state.faultTolerance.failure.category === "context_limit" &&
  (state.faultTolerance.failure.contextIssue === "provider_overflow" ||
    state.faultTolerance.failure.contextIssue === "response_truncated");

const evidenceShouldBeSkipped = async (
  state: AgentStateType,
  workflow: EvidenceWorkflow,
  task: EvidenceTask,
  sourceMessage: BaseMessage,
  deadlineAt: number,
  overflowRecovery: boolean,
  existingMatches: boolean,
  continuationResume: boolean
): Promise<boolean> => {
  if (
    overflowRecovery ||
    existingMatches ||
    continuationResume ||
    workflow.shouldProcess === undefined
  ) {
    return false;
  }

  if (Date.now() >= deadlineAt) {
    return false;
  }

  return !(await workflow.shouldProcess(state, task, sourceMessage));
};

const evidenceForTask = async (
  state: AgentStateType,
  workflow: EvidenceWorkflow,
  task: EvidenceTask & {
    deadlineAt: number;
    hashes: EvidenceRequestHashes;
  }
): Promise<EvidenceBatchState | null> => {
  const existing = workflow.getEvidence(state);

  if (evidenceMatchesRequest(existing, task.hashes)) {
    return existing;
  }

  const projectionDeadlineExceeded = Date.now() >= task.deadlineAt;

  if (projectionDeadlineExceeded) {
    return {
      batches: [],
      failureReason: "allowance_exhausted",
      questionHash: task.hashes.questionHash,
      requestId: task.hashes.requestId,
      resultDigest: task.hashes.resultDigest,
      source: task.source,
      sourceHash: task.hashes.sourceHash,
      sourceMessageId: task.hashes.sourceMessageId,
      status: "allowance_exhausted",
    };
  }

  const projections = await workflow.project({
    deadlineAt: task.deadlineAt,
    maxItemsPerBatch: task.maxItemsPerBatch,
    question: task.question,
    resultJson: task.resultJson,
    source: task.source,
    sourceMessageId: task.hashes.sourceMessageId,
  });

  const allowanceExhausted = Date.now() >= task.deadlineAt;

  if (projections === null || projections.length === 0) {
    return {
      batches: [],
      failureReason: allowanceExhausted ? "allowance_exhausted" : "call_failed",
      questionHash: task.hashes.questionHash,
      requestId: task.hashes.requestId,
      resultDigest: task.hashes.resultDigest,
      source: task.source,
      sourceHash: task.hashes.sourceHash,
      sourceMessageId: task.hashes.sourceMessageId,
      status: allowanceExhausted ? "allowance_exhausted" : "failed",
    };
  }

  return {
    batches: projections.map((projection, index) => ({
      answer: null,
      index,
      projectionJson: projection.projectionJson,
      recordRefs: projection.recordRefs,
      status: "pending" as const,
    })),
    failureReason: allowanceExhausted ? "allowance_exhausted" : null,
    questionHash: task.hashes.questionHash,
    requestId: task.hashes.requestId,
    resultDigest: task.hashes.resultDigest,
    source: task.source,
    sourceHash: task.hashes.sourceHash,
    sourceMessageId: task.hashes.sourceMessageId,
    status: allowanceExhausted ? "allowance_exhausted" : "pending",
  };
};

const allowanceForEvidence = (
  state: AgentStateType,
  requestId: string,
  configuration: ContextProcessingAllowanceConfiguration
): ContextProcessingAllowance => {
  const { allowance } = state.contextProcessing;

  if (allowance !== null && allowance.requestId === requestId) {
    return allowance;
  }

  return {
    consumedActiveTimeMs: 0,
    consumedAdditionalCalls: 0,
    grants: [],
    maxActiveTimeMs:
      configuration.maxActiveTimeMs ??
      defaultContextProcessingAllowance.maxActiveTimeMs,
    maxAdditionalCalls:
      configuration.maxAdditionalCalls ??
      defaultContextProcessingAllowance.maxAdditionalCalls,
    requestId,
    reservation: null,
    reservedActiveTimeMs: 0,
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

const updateBatchStatus = (
  evidence: EvidenceBatchState,
  chunkIndex: number | null,
  status: "failed" | "ready" | "reserved",
  answer?: string
): EvidenceBatchState => ({
  ...evidence,
  batches: evidence.batches.map((batch) =>
    batch.index === chunkIndex
      ? { ...batch, answer: answer ?? batch.answer, status }
      : batch
  ),
});

const failedEvidenceWithUnknownReservation = (
  state: AgentStateType,
  workflow: EvidenceWorkflow,
  evidence: EvidenceBatchState,
  allowance: ContextProcessingAllowance
): Partial<AgentStateType> => {
  const { reservation } = allowance;

  if (reservation === null || reservation.operation !== workflow.operation) {
    return workflow.setEvidence({ ...evidence, status: "failed" });
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
    ...workflow.setEvidence({
      ...updateBatchStatus(evidence, reservation.chunkIndex, "failed"),
      failureReason: "reservation_unknown",
      status: "failed",
    }),
  };
};

const reserveNextEvidenceBatch = (
  state: AgentStateType,
  workflow: EvidenceWorkflow,
  evidence: EvidenceBatchState,
  allowance: ContextProcessingAllowance,
  task: EvidenceTask
): Partial<AgentStateType> => {
  if (evidence.status !== "pending" && evidence.status !== "processing") {
    return {};
  }

  if (allowance.reservation !== null) {
    return failedEvidenceWithUnknownReservation(
      state,
      workflow,
      evidence,
      allowance
    );
  }

  const batchIndex = evidence.batches.findIndex(
    ({ status }) => status === "pending"
  );

  if (batchIndex === -1) {
    const allBatchesReady = evidence.batches.every(
      ({ answer, status }) => status === "ready" && answer !== null
    );

    const complete =
      allBatchesReady && (workflow.complete?.(evidence, task) ?? true);

    return complete
      ? workflow.setEvidence({ ...evidence, status: "complete" })
      : workflow.setEvidence({
          ...evidence,
          failureReason: allBatchesReady
            ? "call_failed"
            : "reservation_unknown",
          status: "failed",
        });
  }

  const availableCalls =
    allowance.maxAdditionalCalls - allowance.consumedAdditionalCalls;

  const availableTime =
    allowance.maxActiveTimeMs -
    allowance.consumedActiveTimeMs -
    allowance.reservedActiveTimeMs;

  if (availableCalls < 1 || availableTime < 1) {
    return {
      contextProcessing: {
        ...state.contextProcessing,
        allowance,
      },
      ...workflow.setEvidence({
        ...evidence,
        failureReason: "allowance_exhausted",
        status: "allowance_exhausted",
      }),
    };
  }

  const batch = evidence.batches[batchIndex];

  if (batch === undefined) {
    return workflow.setEvidence({
      ...evidence,
      failureReason: "call_failed",
      status: "failed",
    });
  }

  const reservation: ContextProcessingReservation = {
    chunkIndex: batch.index,
    maxActiveTimeMs: availableTime,
    maxAdditionalCalls: Math.min(availableCalls, maxExternalRequests),
    operation: workflow.operation,
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
    ...workflow.setEvidence({
      ...updateBatchStatus(evidence, batch.index, "reserved"),
      status: "processing",
    }),
  };
};

const failCurrentBatch = (
  state: AgentStateType,
  workflow: EvidenceWorkflow,
  evidence: EvidenceBatchState,
  allowance: ContextProcessingAllowance,
  reservation: ContextProcessingReservation,
  callsUsed: number,
  durationMs: number
): Partial<AgentStateType> => ({
  contextProcessing: {
    ...state.contextProcessing,
    allowance: settleAllowance(allowance, callsUsed, durationMs),
  },
  ...workflow.setEvidence({
    ...updateBatchStatus(evidence, reservation.chunkIndex, "failed"),
    failureReason: "call_failed",
    status: "failed",
  }),
});

type EvidenceProjectionCall = {
  budget: ModelRequestBudget;
  configuration: EvidenceBatchNodeConfiguration;
  projectionJson: string;
  runtime: ModelRuntime;
  task: EvidenceTask;
  workflow: EvidenceWorkflow;
};

const messagesForEvidenceProjection = (
  workflow: EvidenceWorkflow,
  question: string,
  projectionJson: string
) => [
  new SystemMessage(workflow.systemPrompt),
  new HumanMessage(workflow.questionMessage(question, projectionJson)),
];

const invokeEvidenceProjection = async (
  input: EvidenceProjectionCall
): Promise<string> => {
  const messages = messagesForEvidenceProjection(
    input.workflow,
    input.task.question,
    input.projectionJson
  );

  const response = await invokeWithModelContext(
    input.configuration.model,
    { messages, purpose: "answer" },
    input.configuration.modelContextConfiguration ?? {},
    input.runtime,
    async (limitedModel, signal) =>
      await limitedModel.invoke(messages, { signal }),
    input.budget
  );

  const answer = messageTextFromResponse(response);

  if (answer === null || answer.trim().length === 0) {
    throw new Error("The model returned an empty evidence explanation.");
  }

  return (
    input.workflow.transformAnswer?.(answer, input.projectionJson) ?? answer
  );
};

const evidenceAfterRecoverableAnswerFailureSplit = async (input: {
  batchIndex: number;
  configuration: EvidenceBatchNodeConfiguration;
  error: unknown;
  evidence: EvidenceBatchState;
  task: EvidenceTask;
  workflow: EvidenceWorkflow;
}): Promise<EvidenceBatchState | null> => {
  const modelFailure =
    input.error instanceof Error ? modelContextFailure(input.error) : null;

  if (
    (modelFailure !== "provider_overflow" &&
      modelFailure !== "response_truncated") ||
    input.workflow.splitBatch === undefined
  ) {
    return null;
  }

  const parent = input.evidence.batches[input.batchIndex];

  if (parent === undefined) {
    return null;
  }

  const splitProjections = input.workflow.splitBatch(
    input.task,
    input.evidence.batches,
    input.batchIndex
  );

  if (
    splitProjections === null ||
    splitProjections.length !== input.evidence.batches.length + 1
  ) {
    return null;
  }

  const firstChild = splitProjections[input.batchIndex];
  const secondChild = splitProjections[input.batchIndex + 1];

  if (firstChild === undefined || secondChild === undefined) {
    return null;
  }

  const assessProjection = async (projectionJson: string) => {
    const messages = messagesForEvidenceProjection(
      input.workflow,
      input.task.question,
      projectionJson
    );

    return await assessModelRequest(
      input.configuration.model,
      { messages, purpose: "answer" },
      input.configuration.modelContextConfiguration ?? {}
    );
  };

  const [parentAssessment, childAssessments] = await Promise.all([
    assessProjection(parent.projectionJson),
    Promise.all([
      assessProjection(firstChild.projectionJson),
      assessProjection(secondChild.projectionJson),
    ]),
  ]);

  const eachChildIsSmaller =
    parentAssessment.failure === null &&
    childAssessments.every(
      ({ assessment, failure }) =>
        failure === null &&
        assessment.estimatedInputTokens <
          parentAssessment.assessment.estimatedInputTokens
    );

  if (!eachChildIsSmaller) {
    return null;
  }

  const batches: EvidenceBatchState["batches"] = [];

  for (const [index, projection] of splitProjections.entries()) {
    if (index === input.batchIndex || index === input.batchIndex + 1) {
      batches.push({
        answer: null,
        index,
        projectionJson: projection.projectionJson,
        recordRefs: projection.recordRefs,
        status: "pending",
      });

      continue;
    }

    const previousIndex = index < input.batchIndex ? index : index - 1;
    const previousBatch = input.evidence.batches[previousIndex];

    if (previousBatch === undefined) {
      return null;
    }

    batches.push({
      ...previousBatch,
      index,
      projectionJson: projection.projectionJson,
      recordRefs: projection.recordRefs,
    });
  }

  return {
    ...input.evidence,
    batches,
    failureReason: null,
    status: "processing",
  };
};

const createEvidenceBatchNodes = (workflow: EvidenceWorkflow) => {
  const createPrepareNode =
    (
      configuration: Pick<EvidenceBatchNodeConfiguration, "allowance">
    ): GraphNode<typeof AgentState> =>
    async (state) => {
      const result = workflow.getResult(state);
      const sourceMessage = latestContextProcessingSourceMessage(state);

      if (result === null || sourceMessage === undefined) {
        return {};
      }

      const question = messageText(sourceMessage);

      const task: EvidenceTask = {
        question,
        resultJson: result.resultJson,
        source: result.source,
      };

      const identity = requestIdentityForEvidence(
        state,
        sourceMessage,
        question
      );

      const hashes = requestHashesForEvidence(workflow, identity, task);

      const overflowRecovery = answerEvidenceRecoveryIsPending(state);

      const continuationGrant = currentContinuationGrant(
        state,
        latestHumanMessage(state.messages)
      );

      const continuationResume =
        continuationGrant?.kind === workflow.operation &&
        state.request?.processedMessageId !==
          continuationGrant.continuationMessageId;

      const existingMatches = evidenceMatchesRequest(
        workflow.getEvidence(state),
        hashes
      );

      const currentAllowance = allowanceForEvidence(
        state,
        hashes.requestId,
        configuration.allowance ?? {}
      );

      const preparationStartedAt = existingMatches ? null : Date.now();

      const deadlineAt =
        preparationStartedAt === null
          ? Number.POSITIVE_INFINITY
          : preparationStartedAt +
            Math.max(
              0,
              currentAllowance.maxActiveTimeMs -
                currentAllowance.consumedActiveTimeMs -
                currentAllowance.reservedActiveTimeMs
            );

      if (
        await evidenceShouldBeSkipped(
          state,
          workflow,
          task,
          sourceMessage,
          deadlineAt,
          overflowRecovery,
          existingMatches,
          continuationResume
        )
      ) {
        return {};
      }

      const projectionTask = overflowRecovery
        ? { ...task, maxItemsPerBatch: 1 }
        : task;

      const evidence = await evidenceForTask(state, workflow, {
        ...projectionTask,
        deadlineAt,
        hashes,
      });

      if (evidence === null) {
        return {};
      }

      const preparationDuration =
        preparationStartedAt === null
          ? 0
          : Math.max(0, Date.now() - preparationStartedAt);

      const allowance = {
        ...currentAllowance,
        consumedActiveTimeMs: Math.min(
          currentAllowance.maxActiveTimeMs,
          currentAllowance.consumedActiveTimeMs + preparationDuration
        ),
      };

      const invalidCompletedEvidence =
        evidence.status === "complete" &&
        workflow.complete !== undefined &&
        !workflow.complete(evidence, task);

      if (
        evidence.status === "failed" ||
        evidence.status === "allowance_exhausted" ||
        invalidCompletedEvidence
      ) {
        return {
          contextProcessing: { ...state.contextProcessing, allowance },
          ...workflow.setEvidence({
            ...evidence,
            failureReason: invalidCompletedEvidence
              ? "call_failed"
              : evidence.failureReason,
            status: invalidCompletedEvidence ? "failed" : evidence.status,
          }),
        };
      }

      return reserveNextEvidenceBatch(
        state,
        workflow,
        evidence,
        allowance,
        task
      );
    };

  const createAnswerNode =
    (
      configuration: EvidenceBatchNodeConfiguration
    ): GraphNode<typeof AgentState> =>
    async (state, runtime) => {
      const evidence = workflow.getEvidence(state);
      const { allowance } = state.contextProcessing;
      const reservation = allowance?.reservation ?? null;

      const batch =
        reservation !== null &&
        reservation.operation === workflow.operation &&
        reservation.chunkIndex !== null
          ? evidence?.batches.find(
              ({ index, status }) =>
                index === reservation.chunkIndex && status === "reserved"
            )
          : undefined;

      if (evidence === null || evidence === undefined) {
        return {};
      }

      if (allowance === null || reservation === null || batch === undefined) {
        return {};
      }

      const sourceMessage = latestContextProcessingSourceMessage(state);

      if (sourceMessage === undefined) {
        return {};
      }

      const budget = createModelRequestBudget(
        runtime,
        "answer",
        reservation.maxAdditionalCalls
      );

      const startedAt = Date.now();

      const timeout = AbortSignal.timeout(reservation.maxActiveTimeMs);

      const requestRuntime = {
        ...runtime,
        signal:
          runtime.signal === undefined
            ? timeout
            : AbortSignal.any([runtime.signal, timeout]),
      };

      const task: EvidenceTask = {
        question: messageText(sourceMessage),
        resultJson: workflow.getResult(state)?.resultJson ?? "",
        source: evidence.source,
      };

      try {
        const finalBatchAnswer = await invokeEvidenceProjection({
          budget,
          configuration,
          projectionJson: batch.projectionJson,
          runtime: requestRuntime,
          task,
          workflow,
        });

        const update: Partial<AgentStateType> = {
          contextProcessing: {
            ...state.contextProcessing,
            allowance: settleAllowance(
              allowance,
              budget.requestsUsed(),
              Date.now() - startedAt
            ),
          },
          ...workflow.setEvidence(
            updateBatchStatus(evidence, batch.index, "ready", finalBatchAnswer)
          ),
        };

        const thisWasTheFinalBatch = evidence.batches.every(
          ({ answer, index, status }) =>
            index === batch.index || (status === "ready" && answer !== null)
        );

        if (!thisWasTheFinalBatch || !answerEvidenceRecoveryIsPending(state)) {
          return update;
        }

        return {
          ...update,
          faultTolerance: { ...state.faultTolerance, failure: null },
        };
      } catch (error) {
        const splitEvidence = await evidenceAfterRecoverableAnswerFailureSplit({
          batchIndex: batch.index,
          configuration,
          error,
          evidence,
          task,
          workflow,
        });

        if (splitEvidence !== null) {
          return {
            contextProcessing: {
              ...state.contextProcessing,
              allowance: settleAllowance(
                allowance,
                budget.requestsUsed(),
                Date.now() - startedAt
              ),
            },
            ...workflow.setEvidence(splitEvidence),
          };
        }

        return failCurrentBatch(
          state,
          workflow,
          evidence,
          allowance,
          reservation,
          budget.requestsUsed(),
          Date.now() - startedAt
        );
      }
    };

  const route = (state: AgentStateType): boolean => {
    const evidence = workflow.getEvidence(state);
    const operation = state.contextProcessing.allowance?.reservation?.operation;

    return (
      evidence?.status === "processing" && operation === workflow.operation
    );
  };

  const matchesCurrentOutcome = (state: AgentStateType): boolean => {
    const result = workflow.getResult(state);
    const sourceMessage = latestContextProcessingSourceMessage(state);

    if (result === null || sourceMessage === undefined) {
      return false;
    }

    const question = messageText(sourceMessage);
    const identity = requestIdentityForEvidence(state, sourceMessage, question);

    const hashes = requestHashesForEvidence(workflow, identity, {
      question,
      resultJson: result.resultJson,
      source: result.source,
    });

    return evidenceMatchesRequest(workflow.getEvidence(state), hashes);
  };

  return {
    createAnswerNode,
    createPrepareNode,
    matchesCurrentOutcome,
    route,
  };
};

export {
  createEvidenceBatchNodes,
  evidenceProjectionsFitModelInput,
  largestFittingEvidencePlan,
};

export type { EvidenceProjection, EvidenceTask, EvidenceWorkflow };
