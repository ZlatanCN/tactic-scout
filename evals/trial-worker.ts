import { once } from "node:events";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { Command, MemorySaver } from "@langchain/langgraph";
import { z } from "zod/v4";

import { createAgent } from "../src/agent.js";
import { selectedReferenceCandidate } from "../src/player-data/contracts.js";
import { resolvePlayerReference } from "../src/player-data/resolve-reference.js";
import type { ReferenceIdentityLookup } from "../src/player-data/resolve-reference.js";
import { AgentState } from "../src/state.js";
import type { AgentStateType } from "../src/state.js";
import { createApiFootballClient } from "../src/team-data/api-football.js";
import type { ApiFootballClient } from "../src/team-data/api-football.js";
import { resolveTeamRosterIdentity } from "../src/team-data/roster-identity.js";
import type { TeamRosterIdentityResolution } from "../src/team-data/roster-identity.js";
import {
  evaluationWorkerRequestSchema,
  workerTrialResultSchema,
} from "./contracts.js";
import type {
  EvaluationActionEvent,
  EvaluationWorkerRequest,
  JsonValue,
  ObservedConversationMessage,
  WorkerTrialResult,
} from "./contracts.js";
import { createEvaluationObserver } from "./observation.js";
import type { EvaluationObserver } from "./observation.js";

const serializableContent = (content: BaseMessage["content"]): string => {
  const text = z.string().safeParse(content);

  return text.success
    ? text.data
    : (JSON.stringify(z.json().parse(content)) ?? "");
};

const workerRequestFromEnvironment = (): EvaluationWorkerRequest => {
  const requestPath = z
    .string()
    .min(1)
    .parse(process.env.TACTISCOUT_EVAL_WORKER_REQUEST);

  const requestContents = readFileSync(requestPath, "utf-8");
  let parsedRequest: unknown;

  try {
    parsedRequest = JSON.parse(requestContents);
  } catch {
    throw new Error("The evaluation worker request is invalid.");
  }

  return evaluationWorkerRequestSchema.parse(parsedRequest);
};

type EvaluationApiFootballRuntime = {
  client: ApiFootballClient;
  close?: () => Promise<void>;
};

const teamSearchOperation = "api_football.search_teams";
const teamSquadOperation = "api_football.get_squad";

const unavailableApiFootballEnvelope = {
  errors: { code: "eval_fixture_missing" },
  response: [],
};

const createEvaluationApiFootballRuntime = async (
  workerRequest: EvaluationWorkerRequest
): Promise<EvaluationApiFootballRuntime> => {
  const fixtures = workerRequest.apiFootball;

  const hasFixtures =
    fixtures.teamSearchResponses.length > 0 ||
    fixtures.squadResponses.length > 0;

  if (!hasFixtures) {
    return {
      client: createApiFootballClient({ apiKey: "" }),
    };
  }

  const server = createServer((incoming, response) => {
    const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
    let payload: JsonValue = unavailableApiFootballEnvelope;

    if (url.pathname === "/teams") {
      const query = url.searchParams.get("search");

      const fixture = fixtures.teamSearchResponses.find(
        (item) => item.query === query
      );

      payload = fixture?.payload ?? unavailableApiFootballEnvelope;
    } else if (url.pathname === "/players/squads") {
      const rawTeamId = url.searchParams.get("team");

      const teamId = z
        .string()
        .regex(/^\d+$/u)
        .transform(Number)
        .safeParse(rawTeamId);

      const fixture = teamId.success
        ? fixtures.squadResponses.find((item) => item.teamId === teamId.data)
        : undefined;

      payload = fixture?.payload ?? unavailableApiFootballEnvelope;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const parsedAddress = z
    .object({ port: z.number().int().positive() })
    .safeParse(server.address());

  if (!parsedAddress.success) {
    throw new Error(
      "The evaluation API-Football fixture server did not start."
    );
  }

  const baseUrl = `http://127.0.0.1:${parsedAddress.data.port}`;

  const fetcher: typeof fetch = async (input, init) => {
    const apiRequest = new Request(input, init);
    const originalUrl = new URL(apiRequest.url);

    const localRequest = new Request(
      new URL(`${originalUrl.pathname}${originalUrl.search}`, baseUrl),
      apiRequest
    );

    return await fetch(localRequest);
  };

  const now = () => new Date(fixtures.capturedAt ?? "2025-11-23T12:00:00.000Z");

  return {
    client: createApiFootballClient({
      apiKey: "eval-local-fixture-key",
      fetcher,
      now,
    }),
    close: async () => {
      server.closeAllConnections();
      await server[Symbol.asyncDispose]();
    },
  };
};

const recordOperationEvent = (
  observer: EvaluationObserver,
  event: Omit<EvaluationActionEvent, "caseId" | "runId" | "trialId" | "turnId">
): void => {
  observer.recordActionEvent(event);
};

const observedTeamDirectory = (
  client: ApiFootballClient,
  observer: EvaluationObserver
): ApiFootballClient => {
  const searchTeams: ApiFootballClient["searchTeams"] = async (
    query,
    options
  ) => {
    const actionId = observer.allocateActionId();
    const startedAt = Date.now();
    const input = { query };
    recordOperationEvent(observer, {
      actionId,
      durationMs: null,
      eventId: `${actionId}:attempted`,
      input,
      kind: "attempted",
      name: teamSearchOperation,
      outcome: null,
      result: null,
      sourceRecords: [],
      toolCallId: null,
    });

    try {
      const result = await client.searchTeams(query, options);

      const sourceRecords =
        result.status === "ok"
          ? result.data.map(({ id }) => ({
              provider: "api_football" as const,
              sourceId: `team:${id}`,
            }))
          : [];

      const kind: EvaluationActionEvent["kind"] =
        result.status === "ok" ? "returned" : "failed";

      recordOperationEvent(observer, {
        actionId,
        durationMs: result.durationMs ?? Date.now() - startedAt,
        eventId: `${actionId}:${kind}`,
        input,
        kind,
        name: teamSearchOperation,
        outcome: result.status === "ok" ? "ok" : result.reason,
        result: JSON.stringify(result),
        sourceRecords,
        toolCallId: null,
      });

      return result;
    } catch (error) {
      recordOperationEvent(observer, {
        actionId,
        durationMs: Date.now() - startedAt,
        eventId: `${actionId}:failed`,
        input,
        kind: "failed",
        name: teamSearchOperation,
        outcome: error instanceof Error ? error.name : "UnknownError",
        result: error instanceof Error ? error.message : "unknown",
        sourceRecords: [],
        toolCallId: null,
      });

      throw error;
    }
  };

  const getSquad: ApiFootballClient["getSquad"] = async (teamId, options) => {
    const actionId = observer.allocateActionId();
    const startedAt = Date.now();
    const input = { teamId };
    recordOperationEvent(observer, {
      actionId,
      durationMs: null,
      eventId: `${actionId}:attempted`,
      input,
      kind: "attempted",
      name: teamSquadOperation,
      outcome: null,
      result: null,
      sourceRecords: [{ provider: "api_football", sourceId: `team:${teamId}` }],
      toolCallId: null,
    });

    try {
      const result = await client.getSquad(teamId, options);

      const sourceRecords =
        result.status === "ok"
          ? [
              { provider: "api_football" as const, sourceId: `team:${teamId}` },
              ...result.data.players.map(({ id }) => ({
                provider: "api_football" as const,
                sourceId: `player:${id}`,
              })),
            ]
          : [{ provider: "api_football" as const, sourceId: `team:${teamId}` }];

      let kind: EvaluationActionEvent["kind"] = "failed";

      if (result.status === "ok") {
        kind = result.cached === true ? "cache_hit" : "returned";
      }

      recordOperationEvent(observer, {
        actionId,
        durationMs: result.durationMs ?? Date.now() - startedAt,
        eventId: `${actionId}:${kind}`,
        input,
        kind,
        name: teamSquadOperation,
        outcome: result.status === "ok" ? "ok" : result.reason,
        result: JSON.stringify(result),
        sourceRecords,
        toolCallId: null,
      });

      return result;
    } catch (error) {
      recordOperationEvent(observer, {
        actionId,
        durationMs: Date.now() - startedAt,
        eventId: `${actionId}:failed`,
        input,
        kind: "failed",
        name: teamSquadOperation,
        outcome: error instanceof Error ? error.name : "UnknownError",
        result: error instanceof Error ? error.message : "unknown",
        sourceRecords: [
          { provider: "api_football", sourceId: `team:${teamId}` },
        ],
        toolCallId: null,
      });

      throw error;
    }
  };

  return { getSquad, searchTeams };
};

const observedTeamRosterLookup =
  (
    observer: EvaluationObserver
  ): ((
    playerId: number,
    name: string
  ) => Promise<TeamRosterIdentityResolution>) =>
  async (playerId, name) => {
    const actionId = observer.allocateActionId();
    const startedAt = Date.now();
    const input = { apiFootballPlayerId: playerId, name };

    const playerRecord = {
      provider: "api_football" as const,
      sourceId: `player:${playerId}`,
    };

    recordOperationEvent(observer, {
      actionId,
      durationMs: null,
      eventId: `${actionId}:attempted`,
      input,
      kind: "attempted",
      name: "resolve_team_roster_identity",
      outcome: null,
      result: null,
      sourceRecords: [playerRecord],
      toolCallId: null,
    });

    try {
      const result: TeamRosterIdentityResolution =
        await resolveTeamRosterIdentity(playerId, name);

      let fmIds: string[] = [];

      if (result.status === "resolved") {
        fmIds = [result.candidate.fmId];
      } else if (result.status === "needs_confirmation") {
        fmIds = result.candidates.map(({ fmId }) => fmId);
      }

      const sourceRecords = [
        playerRecord,
        ...fmIds.map((sourceId) => ({ provider: "fm" as const, sourceId })),
      ];

      recordOperationEvent(observer, {
        actionId,
        durationMs: Date.now() - startedAt,
        eventId: `${actionId}:returned`,
        input,
        kind: "returned",
        name: "resolve_team_roster_identity",
        outcome: result.status,
        result: JSON.stringify(result),
        sourceRecords,
        toolCallId: null,
      });

      return result;
    } catch (error) {
      recordOperationEvent(observer, {
        actionId,
        durationMs: Date.now() - startedAt,
        eventId: `${actionId}:failed`,
        input,
        kind: "failed",
        name: "resolve_team_roster_identity",
        outcome: error instanceof Error ? error.name : "UnknownError",
        result: error instanceof Error ? error.message : "unknown",
        sourceRecords: [playerRecord],
        toolCallId: null,
      });

      throw error;
    }
  };

type ResumeResult = {
  answerIndex: number;
  issue: string | null;
  state: AgentStateType;
};

const observedPlayers = (state: AgentStateType) => {
  const requestPlayers = state.request.players.map((player) => {
    const { resolution } = player;
    const selected = selectedReferenceCandidate(resolution);

    return {
      candidates:
        resolution?.candidates.map((candidate) => ({
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
        })) ?? [],
      lookupName: player.lookupName,
      mention: player.mention,
      resolutionStatus: resolution?.status ?? "unresolved",
      selectedCandidateId: selected?.candidateId ?? null,
      selectedName: selected?.name ?? null,
    };
  });

  if (requestPlayers.length > 0) {
    return requestPlayers;
  }

  const { activeLookup } = state.conversationContext;

  if (state.outcome?.status !== "lookup_follow_up" || activeLookup === null) {
    return requestPlayers;
  }

  const { candidate } = activeLookup.player;

  return [
    {
      candidates: [
        {
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
        },
      ],
      lookupName: null,
      mention: candidate.name,
      resolutionStatus: "saved_result_reuse",
      selectedCandidateId: candidate.candidateId,
      selectedName: candidate.name,
    },
  ];
};

const resumeClarifications = async (
  app: ReturnType<typeof createAgent>,
  config: RunnableConfig,
  state: AgentStateType,
  answers: EvaluationWorkerRequest["turns"][number]["clarificationAnswers"],
  answerIndex: number,
  maximumAnswers: number,
  turnId: string,
  observer: EvaluationObserver
): Promise<ResumeResult> => {
  const pending = state.pendingClarification;

  if (pending === null) {
    return {
      answerIndex,
      issue:
        answerIndex === answers.length
          ? null
          : "The graph did not request a declared clarification.",
      state,
    };
  }

  observer.recordClarificationKind(turnId, pending.kind);

  const answer = answers[answerIndex];

  if (
    answer === undefined ||
    answer.expectedKind !== pending.kind ||
    answerIndex >= maximumAnswers
  ) {
    return {
      answerIndex,
      issue: "The scripted clarification does not match the graph.",
      state,
    };
  }

  observer.recordClarificationAnswer(turnId, pending.kind, answer.resumeValue);

  const resumed = await app.invoke(
    new Command({ resume: answer.resumeValue }),
    config
  );

  return await resumeClarifications(
    app,
    config,
    resumed,
    answers,
    answerIndex + 1,
    maximumAnswers,
    turnId,
    observer
  );
};

const clarificationScriptForTurn = (
  turn: EvaluationWorkerRequest["turns"][number],
  state: AgentStateType
): EvaluationWorkerRequest["turns"][number]["clarificationAnswers"] | null => {
  const paths = [turn.clarificationAnswers, ...turn.clarificationAlternatives];
  const pendingKind = state.pendingClarification?.kind ?? null;

  if (pendingKind === null) {
    return paths.find((answerPath) => answerPath.length === 0) ?? null;
  }

  return (
    paths.find((answerPath) => answerPath[0]?.expectedKind === pendingKind) ??
    null
  );
};

const runTurns = async (
  app: ReturnType<typeof createAgent>,
  config: RunnableConfig,
  request: EvaluationWorkerRequest,
  turnIndex: number,
  previousState: AgentStateType | null,
  observer: EvaluationObserver
): Promise<AgentStateType> => {
  const turn = request.turns[turnIndex];

  if (turn === undefined) {
    if (previousState === null) {
      throw new Error("The evaluation case has no user turns.");
    }

    return previousState;
  }

  observer.setActiveTurn(turn.turnId);

  const state = await app.invoke(
    { messages: [new HumanMessage(turn.userMessage)] },
    config
  );

  observer.observeState(state);
  const clarificationAnswers = clarificationScriptForTurn(turn, state);

  if (clarificationAnswers === null) {
    const pending = state.pendingClarification;

    if (pending !== null) {
      observer.recordClarificationKind(turn.turnId, pending.kind);
    }

    observer.setDriverIssue(
      "The scripted clarification does not match the graph."
    );
    observer.recordTurn(turn, state, observedPlayers(state));

    return state;
  }

  const resumed = await resumeClarifications(
    app,
    config,
    state,
    clarificationAnswers,
    0,
    request.maxClarificationsPerTurn,
    turn.turnId,
    observer
  );

  if (resumed.issue !== null) {
    observer.setDriverIssue(resumed.issue);
    observer.observeState(resumed.state);
    observer.recordTurn(turn, resumed.state, observedPlayers(resumed.state));

    return resumed.state;
  }

  observer.observeState(resumed.state);
  observer.recordTurn(turn, resumed.state, observedPlayers(resumed.state));

  const turnFault = request.declaredTurnFaults.find(
    (fault) => fault.turnId === turn.turnId
  );

  for (const missingSource of turnFault?.missingSources ?? []) {
    const sourcePath =
      missingSource === "fm_snapshot_missing"
        ? request.databasePaths.fm
        : request.databasePaths.understat;

    rmSync(sourcePath, { force: true });
  }

  return await runTurns(
    app,
    config,
    request,
    turnIndex + 1,
    resumed.state,
    observer
  );
};

const observedMessage = (
  message: BaseMessage
): ObservedConversationMessage | null => {
  if (message instanceof HumanMessage) {
    return {
      content: serializableContent(message.content),
      invalidToolCalls: [],
      role: "human",
      toolCalls: [],
    };
  }

  if (message instanceof AIMessage) {
    return {
      content: serializableContent(message.content),
      invalidToolCalls: (message.invalid_tool_calls ?? []).map((call) => {
        const parsedArguments = z.json().safeParse(call.args);

        return {
          arguments: parsedArguments.success ? parsedArguments.data : null,
          error: call.error ?? null,
          id: call.id ?? null,
          name: call.name ?? "unknown",
        };
      }),
      role: "assistant",
      toolCalls: (message.tool_calls ?? []).map((call) => ({
        arguments: z.json().parse(call.args),
        id: call.id ?? null,
        name: call.name,
      })),
    };
  }

  return message instanceof ToolMessage
    ? {
        content: serializableContent(message.content),
        invalidToolCalls: [],
        role: "tool",
        toolCallId: message.tool_call_id,
        toolCalls: [],
        toolName: message.name ?? null,
      }
    : null;
};

const observedMessages = (
  state: AgentStateType
): ObservedConversationMessage[] =>
  state.messages.flatMap((message) => {
    const observed = observedMessage(message);

    return observed === null ? [] : [observed];
  });

const observedToolMessages = (state: AgentStateType) =>
  state.messages.flatMap((message) =>
    message instanceof ToolMessage
      ? [
          {
            content: serializableContent(message.content),
            name: message.name ?? null,
            status: message.status ?? null,
            toolCallId: message.tool_call_id,
          },
        ]
      : []
  );

const stateAfterFailure = async (
  app: ReturnType<typeof createAgent>,
  config: RunnableConfig
): Promise<AgentStateType | null> => {
  try {
    const snapshot = await app.getState(config);
    const parsed = AgentState.safeParse(snapshot.values);

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const workerResultFromState = (
  state: AgentStateType | null,
  observer: EvaluationObserver,
  error?: string
): WorkerTrialResult => {
  if (state === null) {
    return {
      actionEvents: observer.actionEvents,
      activeLookupResult: null,
      activeResults: {
        comparison: null,
        lookup: null,
        playerRecommendation: null,
        teamRecommendation: null,
      },
      conversationContext: [],
      deliveredEvidence: observer.deliveredEvidence,
      driverIssue: observer.getDriverIssue(),
      error,
      failureCategory: null,
      identityLookupEvents: observer.identityLookupEvents,
      outcomeKind: null,
      outcomeStatus: null,
      players: [],
      requestKind: null,
      toolMessages: [],
      turns: observer.turnObservations,
    };
  }

  return {
    actionEvents: observer.actionEvents,
    activeLookupResult:
      state.conversationContext.activeLookup?.resultJson ?? null,
    activeResults: {
      comparison: JSON.stringify({
        constraints: state.conversationContext.activeComparison.constraints,
        players: state.conversationContext.activeComparison.players.map(
          ({ candidate, referenceId }) => ({
            candidateId: candidate.candidateId,
            canonicalIdentityId: candidate.canonicalIdentityId,
            name: candidate.name,
            referenceId,
            sourceRecords: candidate.records.map(({ provider, sourceId }) => ({
              provider,
              sourceId,
            })),
          })
        ),
      }),
      lookup: state.conversationContext.activeLookup?.resultJson ?? null,
      playerRecommendation:
        state.conversationContext.activeRecommendation?.resultJson ?? null,
      teamRecommendation:
        state.conversationContext.activeTeamRecommendation?.resultJson ?? null,
    },
    conversationContext: observedMessages(state),
    deliveredEvidence: observer.deliveredEvidence,
    driverIssue: observer.getDriverIssue(),
    error,
    failureCategory: state.faultTolerance.failure?.category ?? null,
    identityLookupEvents: observer.identityLookupEvents,
    outcomeKind: state.outcome?.kind ?? null,
    outcomeStatus: state.outcome?.status ?? null,
    players: observedPlayers(state),
    requestKind: state.request.kind,
    toolMessages: observedToolMessages(state),
    turns: observer.turnObservations,
  };
};

const runTrialWorker = async (): Promise<void> => {
  const request = workerRequestFromEnvironment();
  const observer = createEvaluationObserver(request);
  const teamRuntime = await createEvaluationApiFootballRuntime(request);

  const playerIdentityLookup: ReferenceIdentityLookup = (lookupName) => {
    const startedAt = Date.now();
    const eventId = observer.recordIdentityLookupAttempt(lookupName);

    try {
      const result = resolvePlayerReference(lookupName);
      observer.recordIdentityLookupResult(
        eventId,
        lookupName,
        result,
        Date.now() - startedAt
      );

      return result;
    } catch (error) {
      observer.recordIdentityLookupFailure(
        eventId,
        lookupName,
        error instanceof Error ? error.message : "UnknownError",
        Date.now() - startedAt
      );

      throw error;
    }
  };

  const app = createAgent({
    checkpointer: new MemorySaver(),
    playerIdentityLookup,
    teamDirectory: observedTeamDirectory(teamRuntime.client, observer),
    teamRosterIdentityLookup: observedTeamRosterLookup(observer),
  });

  const config: RunnableConfig = {
    callbacks: [observer.callbacks],
    configurable: { thread_id: request.threadId },
    recursionLimit: 300,
  };

  let state: AgentStateType | null = null;
  let workerError: string | undefined;

  try {
    state = await runTurns(app, config, request, 0, null, observer);
  } catch (error) {
    workerError =
      error instanceof Error
        ? `${error.name}:${error.message}`
        : "UnknownError";
    state = await stateAfterFailure(app, config);
  } finally {
    if (teamRuntime.close !== undefined) {
      await teamRuntime.close();
    }
  }

  const result = workerTrialResultSchema.parse(
    workerResultFromState(state, observer, workerError)
  );

  const { resultPath } = request;
  const temporaryResultPath = `${resultPath}.tmp`;

  writeFileSync(temporaryResultPath, JSON.stringify(result), { mode: 0o600 });
  renameSync(temporaryResultPath, resultPath);
};

if (process.env.TACTISCOUT_EVAL_WORKER_REQUEST !== undefined) {
  void runTrialWorker().catch(() => {
    process.exitCode = 1;
  });
}
