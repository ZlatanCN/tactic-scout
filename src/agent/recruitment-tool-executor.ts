import type {
  PlayerProfile,
} from "../domain/schemas.js";
import type { RecruitmentEvaluationBatch, RecruitmentEvidenceEvaluator } from "./recruitment-evidence-evaluator.js";
import type { KnowledgeRepository } from "../knowledge/index.js";
import type { KnowledgeSearchResult } from "../knowledge/schemas.js";
import {
  inspectTeamPlayers,
  searchPlayerPage,
  type PlayerRepository,
  type PlayerSearchPage,
} from "../data/provider.js";
import type { ParsedRecruitmentAction, ToolActionName } from "./recruitment-actions.js";
import { throwIfAborted } from "../domain/abort.js";

type ToolAction<Action extends ToolActionName> = Extract<ParsedRecruitmentAction, { action: Action }>;

async function observeCancellation<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  throwIfAborted(signal);
  const result = await operation();
  throwIfAborted(signal);
  return result;
}

export type RecruitmentToolExecutionRequest =
  | ToolAction<"search_methodology">
  | (Omit<ToolAction<"search_player_reports">, "playerNames"> & {
    playerNames: string[];
    requestedPlayerCount: number;
  })
  | ToolAction<"inspect_team">
  | ToolAction<"search_candidates">
  | (ToolAction<"evaluate_candidates"> & { eligiblePlayers: PlayerProfile[] });

export type RecruitmentToolExecutionResult =
  | { action: "search_methodology"; request: ToolAction<"search_methodology">; results: KnowledgeSearchResult[] }
  | {
    action: "search_player_reports";
    request: Omit<ToolAction<"search_player_reports">, "playerNames"> & {
      playerNames: string[];
      requestedPlayerCount: number;
    };
    results: KnowledgeSearchResult[];
  }
  | { action: "inspect_team"; request: ToolAction<"inspect_team">; players: PlayerProfile[] }
  | { action: "search_candidates"; request: ToolAction<"search_candidates">; page: PlayerSearchPage }
  | {
    action: "evaluate_candidates";
    request: ToolAction<"evaluate_candidates"> & { eligiblePlayers: PlayerProfile[] };
    batch: RecruitmentEvaluationBatch;
  };

export async function executeRecruitmentToolAction(
  request: RecruitmentToolExecutionRequest,
  dependencies: {
    repository: PlayerRepository;
    knowledgeBase: KnowledgeRepository;
    evaluator: RecruitmentEvidenceEvaluator;
    signal?: AbortSignal;
  },
): Promise<RecruitmentToolExecutionResult> {
  const { signal } = dependencies;
  throwIfAborted(signal);
  switch (request.action) {
    case "search_methodology":
      return {
        action: "search_methodology",
        request,
        results: await observeCancellation(signal, () => dependencies.knowledgeBase.search({
          corpus: "methodology",
          query: request.query,
          playerNames: [],
          limit: request.limit,
        }, { signal })),
      };
    case "search_player_reports":
      return {
        action: "search_player_reports",
        request,
        results: await observeCancellation(signal, () => dependencies.knowledgeBase.search({
          corpus: "player_report",
          query: request.query,
          playerNames: request.playerNames,
          limit: request.limit,
        }, { signal })),
      };
    case "inspect_team":
      return {
        action: "inspect_team",
        request,
        players: await observeCancellation(signal, () => inspectTeamPlayers(dependencies.repository, request.teamName, signal)),
      };
    case "search_candidates":
      return {
        action: "search_candidates",
        request,
        page: await observeCancellation(signal, () => searchPlayerPage(dependencies.repository, {
          playerName: request.playerName,
          position: request.position,
          maxAge: request.maxAge,
          minimumMinutes: request.minimumMinutes,
          competition: request.competition,
          season: request.season,
          offset: request.offset,
          limit: request.limit,
        }, signal)),
      };
    case "evaluate_candidates":
      return {
        action: "evaluate_candidates",
        request,
        batch: await observeCancellation(signal, () => dependencies.evaluator.evaluate(request.eligiblePlayers, request.playerIds, signal)),
      };
    default: {
      const exhaustive: never = request;
      throw new Error(`Unsupported recruitment tool action: ${JSON.stringify(exhaustive)}`);
    }
  }
}
