import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver, NodeError } from "@langchain/langgraph";
import {
  Command,
  END,
  isNodeTimeoutError,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod/v4";
import "dotenv/config";

import {
  createNodeRetryPolicy,
  externalFaultFrom,
  faultCategory,
  faultMessage,
  logFaultEvent,
  modelTimeoutMs,
  apiTimeoutMs,
} from "./fault-tolerance.js";
import {
  createAnswerNode,
  createFaultAnswerNode,
  createLookupPlayerNode,
} from "./nodes/assistant.js";
import { createCommitLookupResultsNode } from "./nodes/commit-lookup.js";
import { createComparePlayersNode } from "./nodes/compare-players.js";
import { createEntityResolutionNode } from "./nodes/entity-resolution.js";
import { createExecuteLookupToolsNode } from "./nodes/execute-lookup-tools.js";
import { createFetchTeamRosterNode } from "./nodes/fetch-team-roster.js";
import { createGuardLookupSearchNode } from "./nodes/guard-lookup-search.js";
import { createClarifyNode } from "./nodes/identity-clarification.js";
import { createRecommendPlayersForTeamNode } from "./nodes/recommend-players-for-team.js";
import { createRecommendPlayersNode } from "./nodes/recommend-players.js";
import {
  createRequestUnderstandingNode,
  routeAfterRequestUnderstanding,
} from "./nodes/request-understanding.js";
import { createResolveTeamRosterNode } from "./nodes/resolve-team-roster.js";
import { createResolveTeamNode } from "./nodes/resolve-team.js";
import { createUnavailableTaskNode } from "./nodes/unavailable-task.js";
import { createWaitForApiRateLimitNode } from "./nodes/wait-api-rate-limit.js";
import { resolvePlayerReference } from "./player-data/resolve-reference.js";
import type { ReferenceIdentityLookup } from "./player-data/resolve-reference.js";
import type { RequestUnderstandingExtractor } from "./request-extraction.js";
import { createRequestUnderstandingExtractor } from "./request-extraction.js";
import type {
  FaultToleranceState,
  AgentStateType,
  RequestState,
} from "./state.js";
import { AgentState, createInitialFaultToleranceState } from "./state.js";
import {
  getApiFootballSquad,
  searchApiFootballTeams,
} from "./team-data/api-football.js";
import type { ApiFootballClient } from "./team-data/api-football.js";
import { resolveTeamRosterIdentity } from "./team-data/roster-identity.js";
import type { TeamRosterIdentityLookup } from "./team-data/roster-identity.js";
import { createTools } from "./tools/search-player-records.js";

type CreateAgentOptions = {
  model?: BaseChatModel;
  tools?: StructuredToolInterface[];
  requestUnderstandingExtractor?: RequestUnderstandingExtractor;
  playerIdentityLookup?: ReferenceIdentityLookup;
  teamDirectory?: Pick<ApiFootballClient, "getSquad" | "searchTeams">;
  teamRosterIdentityLookup?: TeamRosterIdentityLookup;
  checkpointer?: BaseCheckpointSaver;
};

type ErrorHandlerConfig = {
  configurable?: { thread_id?: unknown };
  executionInfo?: { nodeAttempt?: number };
  runId?: string;
};

type FaultFailureNode = NonNullable<FaultToleranceState["failure"]>["node"];

const apiOperationByFailureNode: Partial<
  Record<FaultFailureNode, "team_search" | "team_roster">
> = {
  fetch_team_roster: "team_roster",
  resolve_team: "team_search",
};

const nodeTimeoutAttempt = (
  node: FaultFailureNode,
  state: AgentStateType,
  error: Error,
  config: ErrorHandlerConfig | undefined
): number | "unavailable" | null => {
  if (!isNodeTimeoutError(error)) {
    return null;
  }

  const operation = apiOperationByFailureNode[node];

  if (
    operation === undefined ||
    state.faultTolerance.apiOperation !== operation
  ) {
    return "unavailable";
  }

  return (
    state.faultTolerance.apiRequestsUsed +
    (config?.executionInfo?.nodeAttempt ?? 1)
  );
};

const logTerminalFailure = (
  node: FaultFailureNode,
  state: AgentStateType,
  error: NodeError,
  config: ErrorHandlerConfig | undefined
): void => {
  const threadId = config?.configurable?.thread_id;
  const parsedThreadId = z.string().safeParse(threadId);
  const fault = externalFaultFrom(error.error);
  const timeout = isNodeTimeoutError(error.error) ? error.error : null;

  const attempt =
    fault?.requestsUsed ??
    nodeTimeoutAttempt(node, state, error.error, config) ??
    config?.executionInfo?.nodeAttempt;

  logFaultEvent({
    attempt,
    category: faultCategory(error.error),
    durationMs: fault?.durationMs ?? timeout?.elapsed,
    event: "exhausted",
    node,
    runId: config?.runId,
    threadId: parsedThreadId.success ? parsedThreadId.data : undefined,
  });
};

const faultToleranceAfterNodeFailure = (
  node: FaultFailureNode,
  state: AgentStateType,
  error: NodeError,
  config: ErrorHandlerConfig | undefined
): FaultToleranceState => {
  const fault = externalFaultFrom(error.error);

  if (fault === null && !isNodeTimeoutError(error.error)) {
    throw error.error;
  }

  logTerminalFailure(node, state, error, config);

  return {
    ...(state.faultTolerance ?? createInitialFaultToleranceState()),
    failure: { category: faultCategory(error.error), node },
  };
};

const modelFailureHandler =
  (node: FaultFailureNode) =>
  (state: AgentStateType, error: NodeError, config?: ErrorHandlerConfig) =>
    new Command({
      goto: "answer_failure",
      update: {
        faultTolerance: faultToleranceAfterNodeFailure(
          node,
          state,
          error,
          config
        ),
      },
    });

const teamProviderFailureHandler =
  (node: FaultFailureNode) =>
  (state: AgentStateType, error: NodeError, config?: ErrorHandlerConfig) =>
    new Command({
      goto: "answer",
      update: {
        faultTolerance: faultToleranceAfterNodeFailure(
          node,
          state,
          error,
          config
        ),
        outcome: {
          kind: "team_recommendation" as const,
          resultJson: JSON.stringify({
            message: faultMessage(error.error),
            status: "error",
          }),
          status: "team_provider_error" as const,
        },
      },
    });

const configuredModel = (): ChatOpenAI => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const modelName = process.env.OPENAI_MODEL?.trim();

  if (
    apiKey === undefined ||
    apiKey.length === 0 ||
    modelName === undefined ||
    modelName.length === 0
  ) {
    throw new Error("请在 .env 中配置 OPENAI_API_KEY 和 OPENAI_MODEL。");
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim();

  if (baseURL !== undefined && baseURL.length > 0) {
    return new ChatOpenAI({
      apiKey,
      configuration: { baseURL },
      maxRetries: 0,
      model: modelName,
      temperature: 0,
    });
  }

  return new ChatOpenAI({
    apiKey,
    maxRetries: 0,
    model: modelName,
    temperature: 0,
  });
};

const playersAreResolved = (request: RequestState): boolean =>
  request.players.length > 0 &&
  request.players.every((player) => player.resolution?.status === "resolved");

const identityResolutionExhausted = (request: RequestState): boolean =>
  request.players.some(
    (player) => player.attempts >= 1 && player.resolution?.status !== "resolved"
  );

const recommendationIsReady = (request: RequestState): boolean => {
  if (request.kind !== "player_recommendation") {
    return false;
  }

  const hasReference = request.players.some(
    (player) => player.recommendationRole === "reference"
  );

  const rolesAreClear = request.players.every(
    (player) => player.recommendationRole !== "ambiguous"
  );

  return (
    hasReference &&
    rolesAreClear &&
    !request.recommendation.needsAgeClarification &&
    playersAreResolved(request)
  );
};

const routeTeamRecommendation = (state: AgentStateType): string => {
  const { request } = state;

  if (request.kind !== "team_recommendation") {
    return "answer";
  }

  const recommendation = request.teamRecommendation;

  if (recommendation.team === null || recommendation.position === null) {
    return "resolve_team";
  }

  if (recommendation.roster === null) {
    return "fetch_team_roster";
  }

  if (
    recommendation.roster.members.some(
      (member) => member.mappingStatus !== "resolved" || member.fmId === null
    )
  ) {
    return "resolve_team_roster";
  }

  if (
    recommendation.referenceMode === "named" &&
    (!playersAreResolved(request) || request.players.length === 0)
  ) {
    return request.players.some((player) => player.attempts > 0)
      ? "answer"
      : "resolve_entities";
  }

  return "recommend_players_for_team";
};

const routeResolvedRequest = (state: AgentStateType): string => {
  const { request } = state;

  if (
    state.outcome?.kind === "player_lookup" &&
    state.outcome.status === "lookup_follow_up"
  ) {
    return "answer";
  }

  if (state.outcome?.status === "identity_data_unavailable") {
    return "answer";
  }

  if (
    identityResolutionExhausted(request) &&
    (request.kind !== "team_recommendation" ||
      request.teamRecommendation.referenceMode === "named")
  ) {
    return "answer";
  }

  if (state.pendingClarification !== null) {
    return "clarify";
  }

  if (request.kind === "player_lookup") {
    return request.players.length > 0 && playersAreResolved(request)
      ? "lookup_player"
      : "answer";
  }

  if (request.kind === "player_comparison") {
    return request.players.length >= 2 && playersAreResolved(request)
      ? "compare_players"
      : "answer";
  }

  if (request.kind === "player_recommendation") {
    return recommendationIsReady(request) ? "recommend_players" : "answer";
  }

  if (request.kind === "team_recommendation") {
    return routeTeamRecommendation(state);
  }

  return "answer";
};

const routeAfterClarification = (state: AgentStateType): string => {
  const { request } = state;

  if (
    identityResolutionExhausted(request) &&
    (request.kind !== "team_recommendation" ||
      request.teamRecommendation.referenceMode === "named")
  ) {
    return "answer";
  }

  if (request.kind === "player_lookup") {
    return playersAreResolved(request) ? "lookup_player" : "resolve_entities";
  }

  if (request.kind === "player_comparison") {
    return playersAreResolved(request) ? "compare_players" : "resolve_entities";
  }

  if (request.kind === "player_recommendation") {
    return recommendationIsReady(request)
      ? "recommend_players"
      : "resolve_entities";
  }

  if (request.kind === "team_recommendation") {
    return routeTeamRecommendation(state);
  }

  return "answer";
};

const routeLookupResponse = (state: AgentStateType): string => {
  const lastMessage = state.messages.at(-1);

  return lastMessage instanceof AIMessage &&
    (lastMessage.tool_calls ?? []).length > 0
    ? "lookup_tools_guard"
    : "answer";
};

const routeAfterApiRateLimitWait = (state: AgentStateType): string =>
  state.faultTolerance.apiOperation === "team_search"
    ? "resolve_team"
    : "fetch_team_roster";

const apiRateLimitWaitIsPending = (state: AgentStateType): boolean =>
  state.faultTolerance.apiRetryAfterMs !== null;

const routeAfterTeamResolution = (state: AgentStateType): string => {
  if (apiRateLimitWaitIsPending(state)) {
    return "wait_api_rate_limit";
  }

  if (state.pendingClarification !== null) {
    return "clarify";
  }

  if (state.outcome !== null) {
    return "answer";
  }

  return "fetch_team_roster";
};

const routeAfterTeamRosterFetch = (state: AgentStateType): string => {
  if (apiRateLimitWaitIsPending(state)) {
    return "wait_api_rate_limit";
  }

  return state.outcome === null ? "resolve_team_roster" : "answer";
};

const routeAfterTeamRosterResolution = (state: AgentStateType): string => {
  if (state.pendingClarification !== null) {
    return "clarify";
  }

  if (state.outcome !== null) {
    return "answer";
  }

  return "recommend_players_for_team";
};

const createAgent = (options: CreateAgentOptions = {}) => {
  const tools = options.tools ?? createTools();
  const model = options.model ?? configuredModel();

  const lookupTool = tools.find(
    (item) => item.name === "search_player_records"
  );

  const comparisonTool = tools.find(
    (item) => item.name === "compare_player_records"
  );

  const recommendationTool = tools.find(
    (item) => item.name === "recommend_player_candidates"
  );

  const teamRecommendationTool = tools.find(
    (item) => item.name === "recommend_team_player_candidates"
  );

  const modelWithLookupTool = model.bindTools?.(
    lookupTool === undefined ? [] : [lookupTool]
  );

  if (modelWithLookupTool === undefined) {
    throw new Error("配置的聊天模型不支持工具调用。");
  }

  const understandRequest = createRequestUnderstandingNode(
    options.requestUnderstandingExtractor ??
      createRequestUnderstandingExtractor(model)
  );

  const resolveEntities = createEntityResolutionNode(
    options.playerIdentityLookup ?? resolvePlayerReference
  );

  const teamDirectory = options.teamDirectory ?? {
    getSquad: getApiFootballSquad,
    searchTeams: searchApiFootballTeams,
  };

  const resolveTeam = createResolveTeamNode(teamDirectory.searchTeams);

  const fetchTeamRoster = createFetchTeamRosterNode(teamDirectory.getSquad);

  const resolveTeamRoster = createResolveTeamRosterNode({
    resolvePlayer:
      options.teamRosterIdentityLookup ?? resolveTeamRosterIdentity,
  });

  const comparePlayers = comparisonTool
    ? createComparePlayersNode(comparisonTool)
    : createUnavailableTaskNode("player_comparison");

  const recommendPlayers = recommendationTool
    ? createRecommendPlayersNode(recommendationTool)
    : createUnavailableTaskNode("player_recommendation");

  const recommendPlayersForTeam = teamRecommendationTool
    ? createRecommendPlayersForTeamNode(teamRecommendationTool)
    : createUnavailableTaskNode("team_recommendation");

  const boundedLookupTools = createExecuteLookupToolsNode(lookupTool);

  const graph = new StateGraph(AgentState)
    .addNode("understand_request", understandRequest, {
      errorHandler: modelFailureHandler("understand_request"),
      retryPolicy: createNodeRetryPolicy("understand_request", {
        retryNodeTimeout: false,
      }),
      timeout: modelTimeoutMs,
    })
    .addNode("resolve_entities", resolveEntities)
    .addNode("clarify", createClarifyNode())
    .addNode(
      "lookup_player",
      createLookupPlayerNode(modelWithLookupTool, lookupTool !== undefined),
      {
        errorHandler: modelFailureHandler("lookup_player"),
        retryPolicy: createNodeRetryPolicy("lookup_player", {
          retryNodeTimeout: false,
        }),
        timeout: modelTimeoutMs,
      }
    )
    .addNode("lookup_tools_guard", createGuardLookupSearchNode())
    .addNode("lookup_tools", boundedLookupTools)
    .addNode("commit_lookup", createCommitLookupResultsNode())
    .addNode("compare_players", comparePlayers)
    .addNode("recommend_players", recommendPlayers)
    .addNode("resolve_team", resolveTeam, {
      errorHandler: teamProviderFailureHandler("resolve_team"),
      retryPolicy: createNodeRetryPolicy("resolve_team"),
      timeout: apiTimeoutMs,
    })
    .addNode("fetch_team_roster", fetchTeamRoster, {
      errorHandler: teamProviderFailureHandler("fetch_team_roster"),
      retryPolicy: createNodeRetryPolicy("fetch_team_roster"),
      timeout: apiTimeoutMs,
    })
    .addNode("resolve_team_roster", resolveTeamRoster)
    .addNode("recommend_players_for_team", recommendPlayersForTeam)
    .addNode("wait_api_rate_limit", createWaitForApiRateLimitNode())
    .addNode("answer", createAnswerNode(model), {
      errorHandler: modelFailureHandler("answer"),
      retryPolicy: createNodeRetryPolicy("answer", {
        retryNodeTimeout: false,
      }),
      timeout: modelTimeoutMs,
    })
    .addNode("answer_failure", createFaultAnswerNode())
    .addEdge(START, "understand_request")
    .addConditionalEdges("understand_request", routeAfterRequestUnderstanding, [
      "clarify",
      "answer",
      "resolve_entities",
    ])
    .addConditionalEdges(
      "resolve_entities",
      (state) => routeResolvedRequest(state),
      [
        "clarify",
        "lookup_player",
        "compare_players",
        "recommend_players",
        "resolve_team",
        "fetch_team_roster",
        "resolve_team_roster",
        "recommend_players_for_team",
        "answer",
      ]
    )
    .addConditionalEdges(
      "clarify",
      (state) => {
        if (state.pendingClarification?.kind === "identity") {
          return state.pendingClarification.answer === null
            ? "clarify"
            : "resolve_entities";
        }

        if (
          state.pendingClarification === null &&
          routeAfterRequestUnderstanding(state) === "answer"
        ) {
          return "answer";
        }

        return state.pendingClarification === null
          ? routeAfterClarification(state)
          : "clarify";
      },
      [
        "clarify",
        "resolve_entities",
        "lookup_player",
        "compare_players",
        "recommend_players",
        "resolve_team",
        "fetch_team_roster",
        "resolve_team_roster",
        "recommend_players_for_team",
        "answer",
      ]
    )
    .addConditionalEdges("lookup_player", routeLookupResponse, [
      "lookup_tools_guard",
      "answer",
    ])
    .addEdge("lookup_tools_guard", "lookup_tools")
    .addEdge("lookup_tools", "commit_lookup")
    .addConditionalEdges(
      "commit_lookup",
      (state) =>
        state.outcome?.status === "data_unavailable"
          ? "answer"
          : "lookup_player",
      ["answer", "lookup_player"]
    )
    .addConditionalEdges(
      "compare_players",
      (state) =>
        state.pendingClarification?.kind === "season" ? "clarify" : "answer",
      ["clarify", "answer"]
    )
    .addConditionalEdges(
      "recommend_players",
      (state) =>
        state.pendingClarification?.kind === "position" ||
        state.pendingClarification?.kind === "fm_profile"
          ? "clarify"
          : "answer",
      ["clarify", "answer"]
    )
    .addConditionalEdges(
      "resolve_team",
      (state) => routeAfterTeamResolution(state),
      ["clarify", "fetch_team_roster", "wait_api_rate_limit", "answer"]
    )
    .addConditionalEdges("fetch_team_roster", routeAfterTeamRosterFetch, [
      "resolve_team_roster",
      "wait_api_rate_limit",
      "answer",
    ])
    .addConditionalEdges(
      "resolve_team_roster",
      (state) => routeAfterTeamRosterResolution(state),
      ["clarify", "recommend_players_for_team", "answer"]
    )
    .addConditionalEdges("wait_api_rate_limit", routeAfterApiRateLimitWait, [
      "resolve_team",
      "fetch_team_roster",
    ])
    .addConditionalEdges(
      "recommend_players_for_team",
      (state) => (state.pendingClarification === null ? "answer" : "clarify"),
      ["clarify", "answer"]
    )
    .addEdge("answer", END);

  return graph.compile({
    checkpointer: options.checkpointer ?? new MemorySaver(),
  });
};

const agent = createAgent();

export { agent, createAgent };

export type { CreateAgentOptions };
