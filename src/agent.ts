import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import "dotenv/config";

import { createAnswerNode, createLookupPlayerNode } from "./nodes/assistant.js";
import { createComparePlayersNode } from "./nodes/compare-players.js";
import { createEntityResolutionNode } from "./nodes/entity-resolution.js";
import { createClarifyNode } from "./nodes/identity-clarification.js";
import { createRecommendPlayersForTeamNode } from "./nodes/recommend-players-for-team.js";
import { createRecommendPlayersNode } from "./nodes/recommend-players.js";
import { createRequestUnderstandingNode } from "./nodes/request-understanding.js";
import { createResolveTeamRosterNode } from "./nodes/resolve-team-roster.js";
import { createResolveTeamNode } from "./nodes/resolve-team.js";
import { resolvePlayerReference } from "./player-data/resolve-reference.js";
import type { ReferenceIdentityLookup } from "./player-data/resolve-reference.js";
import type { RequestUnderstandingExtractor } from "./request-extraction.js";
import { createRequestUnderstandingExtractor } from "./request-extraction.js";
import type { AgentStateType, RequestState } from "./state.js";
import { AgentState } from "./state.js";
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
      model: modelName,
      temperature: 0,
    });
  }

  return new ChatOpenAI({
    apiKey,
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

  if (
    recommendation.roster === null ||
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
    ? "lookup_tools"
    : "answer";
};

const routeAfterTeamResolution = (state: AgentStateType): string => {
  if (state.pendingClarification !== null) {
    return "clarify";
  }

  if (state.outcome !== null) {
    return "answer";
  }

  return "resolve_team_roster";
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

const unavailableTaskNode =
  (
    kind: "player_comparison" | "player_recommendation" | "team_recommendation"
  ) =>
  (state: { request: RequestState }) => ({
    outcome: {
      kind,
      resultJson: null,
      status: {
        player_comparison: "comparison_tool_unavailable",
        player_recommendation: "recommendation_tool_unavailable",
        team_recommendation: "team_recommendation_tool_unavailable",
      }[kind],
    },
    request: state.request,
  });

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

  const resolveTeamRoster = createResolveTeamRosterNode({
    getSquad: teamDirectory.getSquad,
    resolvePlayer:
      options.teamRosterIdentityLookup ?? resolveTeamRosterIdentity,
  });

  const comparePlayers = comparisonTool
    ? createComparePlayersNode(comparisonTool)
    : unavailableTaskNode("player_comparison");

  const recommendPlayers = recommendationTool
    ? createRecommendPlayersNode(recommendationTool)
    : unavailableTaskNode("player_recommendation");

  const recommendPlayersForTeam = teamRecommendationTool
    ? createRecommendPlayersForTeamNode(teamRecommendationTool)
    : unavailableTaskNode("team_recommendation");

  const graph = new StateGraph(AgentState)
    .addNode("understand_request", understandRequest)
    .addNode("resolve_entities", resolveEntities)
    .addNode("clarify", createClarifyNode())
    .addNode(
      "lookup_player",
      createLookupPlayerNode(modelWithLookupTool, lookupTool !== undefined)
    )
    .addNode("lookup_tools", new ToolNode(lookupTool ? [lookupTool] : []))
    .addNode("compare_players", comparePlayers)
    .addNode("recommend_players", recommendPlayers)
    .addNode("resolve_team", resolveTeam)
    .addNode("resolve_team_roster", resolveTeamRoster)
    .addNode("recommend_players_for_team", recommendPlayersForTeam)
    .addNode("answer", createAnswerNode(model))
    .addEdge(START, "understand_request")
    .addEdge("understand_request", "resolve_entities")
    .addConditionalEdges(
      "resolve_entities",
      (state) => routeResolvedRequest(state),
      [
        "clarify",
        "lookup_player",
        "compare_players",
        "recommend_players",
        "resolve_team",
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
        "resolve_team_roster",
        "recommend_players_for_team",
        "answer",
      ]
    )
    .addConditionalEdges("lookup_player", routeLookupResponse, [
      "lookup_tools",
      "answer",
    ])
    .addEdge("lookup_tools", "lookup_player")
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
      ["clarify", "resolve_team_roster", "answer"]
    )
    .addConditionalEdges(
      "resolve_team_roster",
      (state) => routeAfterTeamRosterResolution(state),
      ["clarify", "recommend_players_for_team", "answer"]
    )
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
