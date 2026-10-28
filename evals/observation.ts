import { createHash } from "node:crypto";

import type { CallbackHandlerMethods } from "@langchain/core/callbacks/base";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod/v4";

import type { ReferenceLookupResult } from "../src/player-data/contracts.js";
import type { AgentStateType } from "../src/state.js";
import type {
  EvaluationActionEvent,
  EvaluationWorkerRequest,
  DeliveredEvidence,
  IdentityLookupEvent,
  JsonValue,
  TurnObservation,
  WorkerTrialResult,
} from "./contracts.js";

const sourceProviderSchema = z.enum(["api_football", "fm", "understat"]);
const jsonRecordSchema = z.record(z.string(), z.json());

type SourceProvider = z.output<typeof sourceProviderSchema>;

type JsonRecord = z.output<typeof jsonRecordSchema>;

const sourceRecordSchema = z.object({
  competition: z.string().nullable().optional(),
  provider: sourceProviderSchema,
  season: z.string().nullable().optional(),
  sourceId: z.string(),
});

const sourceRecordKey = (record: z.output<typeof sourceRecordSchema>): string =>
  `${record.provider}:${record.sourceId}:${record.competition ?? ""}:${record.season ?? ""}`;

const sourceRecordsFromObject = (
  object: JsonRecord,
  providerHint?: SourceProvider
): z.output<typeof sourceRecordSchema>[] => {
  const records: z.output<typeof sourceRecordSchema>[] = [];
  const directRecord = sourceRecordSchema.safeParse(object);

  if (directRecord.success) {
    records.push(directRecord.data);
  }

  const recordProvider = sourceProviderSchema.safeParse(object.provider);
  const fmId = z.string().safeParse(object.identitySourceId);

  if (fmId.success) {
    records.push({
      provider: recordProvider.success
        ? recordProvider.data
        : (providerHint ?? "fm"),
      sourceId: fmId.data,
    });
  }

  const recommendationFmId = z.string().safeParse(object.fmId);

  if (recommendationFmId.success) {
    records.push({ provider: "fm", sourceId: recommendationFmId.data });
  }

  const recommendationFmIds = z.array(z.string()).safeParse(object.fmIds);

  if (recommendationFmIds.success) {
    records.push(
      ...recommendationFmIds.data.map((sourceId) => ({
        provider: "fm" as const,
        sourceId,
      }))
    );
  }

  const understatId = z.string().safeParse(object.sourcePlayerId);

  if (understatId.success) {
    records.push({ provider: "understat", sourceId: understatId.data });
  }

  const apiFootballPlayerId = z
    .union([z.string(), z.number()])
    .safeParse(object.apiFootballPlayerId);

  if (apiFootballPlayerId.success) {
    records.push({
      provider: "api_football",
      sourceId: `player:${apiFootballPlayerId.data}`,
    });
  }

  const teamObject = jsonRecordSchema.safeParse(object.team);

  const teamId = teamObject.success
    ? z.number().int().positive().safeParse(teamObject.data.id)
    : { success: false as const };

  if (teamId.success) {
    records.push({
      provider: "api_football",
      sourceId: `team:${teamId.data}`,
    });
  }

  if (providerHint !== undefined) {
    const sourceId = z.string().safeParse(object.sourceId);

    if (sourceId.success) {
      records.push({ provider: providerHint, sourceId: sourceId.data });
    }
  }

  return records;
};

const sourceRecordsFromValue = (value: JsonValue | null) => {
  const records = new Map<string, z.output<typeof sourceRecordSchema>>();

  const visit = (item: JsonValue, providerHint?: SourceProvider): void => {
    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child, providerHint);
      }

      return;
    }

    const parsedObject = jsonRecordSchema.safeParse(item);

    if (!parsedObject.success) {
      return;
    }

    const object = parsedObject.data;

    for (const record of sourceRecordsFromObject(object, providerHint)) {
      records.set(sourceRecordKey(record), record);
    }

    for (const [key, child] of Object.entries(object)) {
      const nestedProvider =
        key === "fm" || key === "understat" || key === "api_football"
          ? key
          : providerHint;

      visit(child, nestedProvider);
    }
  };

  if (value !== null) {
    visit(value);
  }

  return [...records.values()].toSorted(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.sourceId.localeCompare(right.sourceId)
  );
};

const contentString = (value: BaseMessage["content"]): string => {
  const parsedString = z.string().safeParse(value);

  if (parsedString.success) {
    return parsedString.data;
  }

  const parsedJson = z.json().safeParse(value);

  return parsedJson.success ? (JSON.stringify(parsedJson.data) ?? "") : "";
};

const parsedResult = (value: JsonValue): JsonValue | null => {
  const parsedString = z.string().safeParse(value);

  if (!parsedString.success) {
    return value;
  }

  try {
    return z.json().parse(JSON.parse(parsedString.data));
  } catch {
    return null;
  }
};

const outcomeFromResult = (value: JsonValue | null): string | null => {
  const object = z.record(z.string(), z.json()).safeParse(value);

  if (!object.success) {
    return null;
  }

  const directStatus = z.string().safeParse(object.data.status);

  if (directStatus.success) {
    return directStatus.data;
  }

  const providerStatuses = new Set(
    ["fm", "understat"].flatMap((provider) => {
      const result = z
        .object({ status: z.string() })
        .safeParse(object.data[provider]);

      return result.success ? [result.data.status] : [];
    })
  );

  if (providerStatuses.has("unavailable")) {
    return "unavailable";
  }

  if (providerStatuses.has("found")) {
    return "found";
  }

  if (providerStatuses.has("not_found")) {
    return "not_found";
  }

  return null;
};

const evidenceContent = (message: BaseMessage): string | null => {
  if (message instanceof ToolMessage) {
    return contentString(message.content);
  }

  if (message instanceof HumanMessage) {
    const content = contentString(message.content);

    const markers = ["结构化工具结果：\n", "已保存的查询结果 JSON：\n"];

    const marker = markers.find((item) => content.includes(item));

    return marker === undefined
      ? null
      : content.slice(content.indexOf(marker) + marker.length);
  }

  return null;
};

const effectiveConditionsForState = (
  state: AgentStateType
): TurnObservation["effectiveConditions"] => {
  if (state.request.kind === "player_recommendation") {
    return {
      includePotential: state.request.recommendation.includePotential,
      maxAge: state.request.recommendation.maxAge,
      minimumCurrentAbility: state.request.recommendation.minimumCurrentAbility,
      minimumPotentialAbility:
        state.request.recommendation.minimumPotentialAbility,
      position: state.request.recommendation.position,
      referenceMode: null,
      resultLimit: state.request.recommendation.resultLimit,
      teamId: null,
      teamName: null,
    };
  }

  if (state.request.kind === "team_recommendation") {
    const { team, ...teamRequest } = state.request.teamRecommendation;

    return {
      includePotential: teamRequest.includePotential,
      maxAge: teamRequest.maxAge,
      minimumCurrentAbility: teamRequest.minimumCurrentAbility,
      minimumPotentialAbility: teamRequest.minimumPotentialAbility,
      position: teamRequest.position,
      referenceMode: teamRequest.referenceMode,
      resultLimit: teamRequest.resultLimit,
      teamId: team?.id ?? null,
      teamName: team?.name ?? teamRequest.teamName,
    };
  }

  return null;
};

const availableResultKindsForState = (
  state: AgentStateType
): TurnObservation["availableResultKinds"] => {
  const resultKinds: TurnObservation["availableResultKinds"] = [];
  const context = state.conversationContext;

  if (context.activeLookup !== null) {
    resultKinds.push("player_lookup");
  }

  if (context.activeComparison.players.length >= 2) {
    resultKinds.push("player_comparison");
  }

  if (context.activeRecommendation !== null) {
    resultKinds.push("player_recommendation");
  }

  if (context.activeTeamRecommendation !== null) {
    resultKinds.push("team_recommendation");
  }

  return resultKinds;
};

type EvaluationObserver = {
  actionEvents: EvaluationActionEvent[];
  callbacks: CallbackHandlerMethods;
  deliveredEvidence: DeliveredEvidence[];
  allocateActionId: () => string;
  getDriverIssue: () => string | null;
  identityLookupEvents: IdentityLookupEvent[];
  observeState: (state: { messages: BaseMessage[] }) => void;
  recordClarificationAnswer: (
    turnId: string,
    kind: string,
    value: string
  ) => void;
  recordClarificationKind: (turnId: string, kind: string) => void;
  recordActionEvent: (
    event: Omit<
      EvaluationActionEvent,
      "caseId" | "runId" | "trialId" | "turnId"
    > & { turnId?: string }
  ) => void;
  recordTurn: (
    turn: EvaluationWorkerRequest["turns"][number],
    state: AgentStateType,
    players: WorkerTrialResult["players"]
  ) => void;
  recordIdentityLookupAttempt: (lookupName: string) => string;
  recordIdentityLookupFailure: (
    eventId: string,
    lookupName: string,
    error: string,
    durationMs: number
  ) => void;
  recordIdentityLookupResult: (
    eventId: string,
    lookupName: string,
    result: ReferenceLookupResult,
    durationMs: number
  ) => void;
  setDriverIssue: (issue: string) => void;
  setActiveTurn: (turnId: string) => void;
  turnObservations: TurnObservation[];
};

const createEvaluationObserver = (
  request: EvaluationWorkerRequest
): EvaluationObserver => {
  const actionEvents: EvaluationActionEvent[] = [];
  const identityLookupEvents: IdentityLookupEvent[] = [];
  const deliveredEvidence: DeliveredEvidence[] = [];
  const turnObservations: TurnObservation[] = [];
  const deliveredByTurn = new Map<string, Set<string>>();
  const clarificationKindsByTurn = new Map<string, string[]>();

  const clarificationAnswersByTurn = new Map<
    string,
    { kind: string; value: string }[]
  >();

  const actionIdByCallId = new Map<string, string>();

  const actionByRunId = new Map<
    string,
    { eventIndex: number; startedAt: number }
  >();

  const observedRequestIds = new Set<string>();
  const observedInvalidToolCallIds = new Set<string>();
  const observedToolResultIds = new Set<string>();

  let activeTurnId = request.turnIds[0] ?? "unknown-turn";
  let operationIndex = 0;
  let identityLookupIndex = 0;
  let modelCallIndex = 0;
  let driverIssue: string | null = null;

  const nextActionId = (): string => {
    operationIndex += 1;

    return `${request.trialId}:${activeTurnId}:operation-${operationIndex}`;
  };

  const appendActionEvent = (
    event: Omit<
      EvaluationActionEvent,
      "caseId" | "runId" | "trialId" | "turnId"
    > & {
      turnId?: string;
    }
  ): void => {
    actionEvents.push({
      ...event,
      caseId: request.caseId,
      runId: request.runId,
      trialId: request.trialId,
      turnId: event.turnId ?? activeTurnId,
    });
  };

  const recordActionEvent: EvaluationObserver["recordActionEvent"] = (
    event
  ) => {
    appendActionEvent(event);
  };

  const recordDeliveredEvidence = (
    messages: BaseMessage[],
    modelRunId: string
  ): void => {
    modelCallIndex += 1;
    const currentEvidenceIds = deliveredByTurn.get(activeTurnId) ?? new Set();

    for (const [messageIndex, message] of messages.entries()) {
      const content = evidenceContent(message);

      if (content === null || content.length === 0) {
        continue;
      }

      const records = sourceRecordsFromValue(parsedResult(content));
      const contentHash = createHash("sha256").update(content).digest("hex");

      const sources =
        records.length === 0
          ? [{ provider: "application" as const, sourceId: null }]
          : records;

      for (const source of sources) {
        const evidenceId = `${request.trialId}:${activeTurnId}:model-${modelCallIndex}:message-${messageIndex}:${source.provider}:${source.sourceId ?? contentHash}`;

        deliveredEvidence.push({
          content,
          evidenceId,
          messageIndex,
          modelCallIndex,
          modelRunId,
          provider: source.provider,
          sourceId: source.sourceId,
          trialId: request.trialId,
          turnId: activeTurnId,
        });
        currentEvidenceIds.add(evidenceId);
      }
    }

    deliveredByTurn.set(activeTurnId, currentEvidenceIds);
  };

  const observeRequestedToolCalls = (message: AIMessage): void => {
    for (const call of message.tool_calls ?? []) {
      const callId = call.id;

      if (callId === undefined || observedRequestIds.has(callId)) {
        continue;
      }

      observedRequestIds.add(callId);
      const actionId = actionIdByCallId.get(callId) ?? nextActionId();
      const parsedCallArgs = z.json().safeParse(call.args);
      const callArgs = parsedCallArgs.success ? parsedCallArgs.data : null;
      actionIdByCallId.set(callId, actionId);
      appendActionEvent({
        actionId,
        durationMs: null,
        eventId: `${actionId}:requested`,
        input: callArgs,
        kind: "requested",
        name: call.name,
        outcome: null,
        result: null,
        sourceRecords: sourceRecordsFromValue(callArgs),
        toolCallId: callId,
      });
    }
  };

  const observeInvalidToolCalls = (message: AIMessage): void => {
    for (const call of message.invalid_tool_calls ?? []) {
      const invalidCallKey =
        call.id ??
        JSON.stringify({ args: call.args, error: call.error, name: call.name });

      if (observedInvalidToolCallIds.has(invalidCallKey)) {
        continue;
      }

      observedInvalidToolCallIds.add(invalidCallKey);
      const actionId = nextActionId();
      const parsedArguments = z.json().safeParse(call.args);
      const input = parsedArguments.success ? parsedArguments.data : null;

      appendActionEvent({
        actionId,
        durationMs: null,
        eventId: `${actionId}:schema_rejected`,
        input,
        kind: "schema_rejected",
        name: call.name ?? "unknown",
        outcome: "schema_rejected",
        result: call.error ?? "The model returned invalid tool arguments.",
        sourceRecords: sourceRecordsFromValue(input),
        toolCallId: call.id ?? null,
      });
    }
  };

  const observeToolMessage = (message: ToolMessage): void => {
    if (observedToolResultIds.has(message.tool_call_id)) {
      return;
    }

    observedToolResultIds.add(message.tool_call_id);

    const actionId =
      actionIdByCallId.get(message.tool_call_id) ?? nextActionId();

    actionIdByCallId.set(message.tool_call_id, actionId);

    if (message.status === "error") {
      appendActionEvent({
        actionId,
        durationMs: null,
        eventId: `${actionId}:blocked`,
        input: null,
        kind: "blocked",
        name: message.name ?? "unknown",
        outcome: "guard_blocked",
        result: contentString(message.content),
        sourceRecords: [],
        toolCallId: message.tool_call_id,
      });
    }
  };

  const observeState = (state: { messages: BaseMessage[] }): void => {
    for (const message of state.messages) {
      if (message instanceof AIMessage) {
        observeRequestedToolCalls(message);
        observeInvalidToolCalls(message);
      } else if (message instanceof ToolMessage) {
        observeToolMessage(message);
      }
    }
  };

  const callbacks: CallbackHandlerMethods = {
    handleChatModelStart: (_model, batches, modelRunId) => {
      for (const messages of batches) {
        recordDeliveredEvidence(messages, modelRunId);
      }
    },
    handleToolEnd: (output, toolRunId) => {
      const actionInfo = actionByRunId.get(toolRunId);

      const attempted =
        actionInfo === undefined
          ? undefined
          : actionEvents[actionInfo.eventIndex];

      if (attempted === undefined || actionInfo === undefined) {
        return;
      }

      const directText = z.string().safeParse(output);

      const messageText = z
        .looseObject({ content: z.string() })
        .safeParse(output);

      const result = directText.success
        ? directText.data
        : (messageText.data?.content ?? "[unserializable tool output]");

      const outputData =
        directText.success || messageText.success ? parsedResult(result) : null;

      const outputRecords = sourceRecordsFromValue(outputData);

      const sourceRecords =
        outputRecords.length > 0 ? outputRecords : attempted.sourceRecords;

      appendActionEvent({
        actionId: attempted.actionId,
        durationMs: Date.now() - actionInfo.startedAt,
        eventId: `${attempted.actionId}:returned`,
        input: attempted.input,
        kind: "returned",
        name: attempted.name,
        outcome: outcomeFromResult(outputData) ?? "returned",
        result,
        sourceRecords,
        toolCallId: attempted.toolCallId,
        turnId: attempted.turnId,
      });
    },
    handleToolError: (error, toolRunId) => {
      const actionInfo = actionByRunId.get(toolRunId);

      const attempted =
        actionInfo === undefined
          ? undefined
          : actionEvents[actionInfo.eventIndex];

      if (attempted === undefined || actionInfo === undefined) {
        return;
      }

      const parsedError = z
        .object({ message: z.string().optional(), name: z.string().optional() })
        .safeParse(error);

      const errorName = parsedError.success
        ? (parsedError.data.name ?? "UnknownError")
        : "UnknownError";

      const errorMessage = parsedError.success
        ? (parsedError.data.message ?? "unknown")
        : "unknown";

      const schemaFailure = /schema|parse|validation/iu.test(
        `${errorName}:${errorMessage}`
      );

      appendActionEvent({
        actionId: attempted.actionId,
        durationMs: Date.now() - actionInfo.startedAt,
        eventId: `${attempted.actionId}:${schemaFailure ? "schema_rejected" : "failed"}`,
        input: attempted.input,
        kind: schemaFailure ? "schema_rejected" : "failed",
        name: attempted.name,
        outcome: errorName,
        result: errorMessage,
        sourceRecords: attempted.sourceRecords,
        toolCallId: attempted.toolCallId,
        turnId: attempted.turnId,
      });
    },
    handleToolStart: (
      serialized,
      input,
      toolRunId,
      _parentRunId,
      _tags,
      _metadata,
      runName,
      toolCallId
    ) => {
      const parsedSerialized = z
        .object({
          id: z.array(z.string()).default([]),
          kwargs: z.object({ name: z.string().optional() }).optional(),
          name: z.string().optional(),
        })
        .safeParse(serialized);

      const serializedName = parsedSerialized.success
        ? (parsedSerialized.data.name ??
          parsedSerialized.data.kwargs?.name ??
          parsedSerialized.data.id.at(-1))
        : undefined;

      const name = runName ?? serializedName ?? "unknown";

      const actionId = nextActionId();
      const parsedInput = parsedResult(input);
      const inputRecords = sourceRecordsFromValue(parsedInput);

      if (toolCallId !== undefined) {
        actionIdByCallId.set(toolCallId, actionId);
      }

      const eventIndex = actionEvents.length;
      actionByRunId.set(toolRunId, {
        eventIndex,
        startedAt: Date.now(),
      });
      appendActionEvent({
        actionId,
        durationMs: null,
        eventId: `${actionId}:attempted`,
        input: parsedInput,
        kind: "attempted",
        name,
        outcome: null,
        result: null,
        sourceRecords: inputRecords,
        toolCallId: toolCallId ?? null,
      });
    },
  };

  const recordClarificationKind = (turnId: string, kind: string): void => {
    const kinds = clarificationKindsByTurn.get(turnId) ?? [];
    kinds.push(kind);
    clarificationKindsByTurn.set(turnId, kinds);
  };

  const recordIdentityLookupAttempt = (lookupName: string): string => {
    identityLookupIndex += 1;
    const eventId = `${request.trialId}:${activeTurnId}:identity-${identityLookupIndex}`;

    identityLookupEvents.push({
      candidates: [],
      caseId: request.caseId,
      durationMs: null,
      error: null,
      eventId: `${eventId}:attempted`,
      kind: "attempted",
      lookupName,
      outcome: null,
      runId: request.runId,
      selectedCandidateId: null,
      trialId: request.trialId,
      turnId: activeTurnId,
    });

    return eventId;
  };

  const recordIdentityLookupResult = (
    eventId: string,
    lookupName: string,
    result: ReferenceLookupResult,
    durationMs: number
  ): void => {
    identityLookupEvents.push({
      candidates: result.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        canonicalIdentityId: candidate.canonicalIdentityId,
        records: candidate.records.map(
          ({ competition, provider, season, sourceId }) => ({
            competition,
            provider,
            season,
            sourceId,
          })
        ),
      })),
      caseId: request.caseId,
      durationMs,
      error: null,
      eventId: `${eventId}:returned`,
      kind: "returned",
      lookupName,
      outcome: result.status,
      runId: request.runId,
      selectedCandidateId: result.selectedCandidateId,
      trialId: request.trialId,
      turnId: activeTurnId,
    });
  };

  const recordIdentityLookupFailure = (
    eventId: string,
    lookupName: string,
    error: string,
    durationMs: number
  ): void => {
    identityLookupEvents.push({
      candidates: [],
      caseId: request.caseId,
      durationMs,
      error,
      eventId: `${eventId}:failed`,
      kind: "failed",
      lookupName,
      outcome: null,
      runId: request.runId,
      selectedCandidateId: null,
      trialId: request.trialId,
      turnId: activeTurnId,
    });
  };

  const recordClarificationAnswer = (
    turnId: string,
    kind: string,
    value: string
  ): void => {
    const answers = clarificationAnswersByTurn.get(turnId) ?? [];
    answers.push({ kind, value });
    clarificationAnswersByTurn.set(turnId, answers);
  };

  const recordTurn: EvaluationObserver["recordTurn"] = (
    turn,
    state,
    players
  ) => {
    const userMessageIndex = state.messages.findIndex(
      (message) =>
        message instanceof HumanMessage &&
        contentString(message.content) === turn.userMessage
    );

    const relevantMessages =
      userMessageIndex === -1
        ? state.messages
        : state.messages.slice(userMessageIndex + 1);

    const assistantMessages = relevantMessages.flatMap((message) =>
      message instanceof AIMessage ? [contentString(message.content)] : []
    );

    const deliveredEvidenceIds = [
      ...(deliveredByTurn.get(turn.turnId) ?? new Set()),
    ];

    turnObservations.push({
      assistantMessages,
      availableResultKinds: availableResultKindsForState(state),
      clarificationAnswers: clarificationAnswersByTurn.get(turn.turnId) ?? [],
      clarificationKinds: clarificationKindsByTurn.get(turn.turnId) ?? [],
      deliveredEvidenceIds,
      effectiveConditions: effectiveConditionsForState(state),
      effectiveConstraints: state.request.constraints,
      outcomeKind: state.outcome?.kind ?? null,
      outcomeStatus: state.outcome?.status ?? null,
      players,
      requestKind: state.request.kind,
      reuse:
        state.outcome?.status === "lookup_follow_up"
          ? { evidenceIds: deliveredEvidenceIds, kind: "saved_lookup_result" }
          : null,
      turnId: turn.turnId,
      userMessage: turn.userMessage,
    });
  };

  const setActiveTurn = (turnId: string): void => {
    activeTurnId = turnId;
  };

  const setDriverIssue = (issue: string): void => {
    driverIssue = issue;
  };

  const getDriverIssue = (): string | null => driverIssue;

  return {
    actionEvents,
    allocateActionId: nextActionId,
    callbacks,
    deliveredEvidence,
    getDriverIssue,
    identityLookupEvents,
    observeState,
    recordActionEvent,
    recordClarificationAnswer,
    recordClarificationKind,
    recordIdentityLookupAttempt,
    recordIdentityLookupFailure,
    recordIdentityLookupResult,
    recordTurn,
    setActiveTurn,
    setDriverIssue,
    turnObservations,
  };
};

export { createEvaluationObserver };

export type { EvaluationObserver };
