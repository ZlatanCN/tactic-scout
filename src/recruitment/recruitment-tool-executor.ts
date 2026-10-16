import type { TeamRosterEnrichmentProvider } from "../sources/thesportsdb/roster.js";
import { type CapabilityMetricKey } from "../domain/capabilities.js";
import { type TeamRosterContext } from "../domain/conversation.js";
import { type PlayerProfile } from "../domain/players.js";
import type { RecruitmentEvaluationBatch, RecruitmentEvidenceEvaluator } from "./recruitment-evidence-evaluator.js";
import type { KnowledgeRepository } from "../knowledge/index.js";
import type { KnowledgePlayerContext, KnowledgeSearchResult } from "../knowledge/schemas.js";
import { inspectTeamPlayers, searchPlayerPage, type PlayerRepository, type PlayerSearchPage } from "../players/repository.js";
import type { ParsedRecruitmentAction, ToolActionName } from "./recruitment-actions.js";
import { throwIfAborted } from "../domain/abort.js";
import type { PlayerIdentityCandidate, PlayerNameResolution, PlayerNameResolver } from "../players/identity/name-resolver.js";
import type { UnderstatMatchInsight, UnderstatPlayerInsight, UnderstatTeamInsight } from "../sources/understat/research.js";

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
    capabilityGaps?: string[];
    playerContexts?: KnowledgePlayerContext[];
  })
  | (ToolAction<"inspect_team"> & { referenceMention?: string; referenceResolutionOverride?: PlayerIdentityCandidate })
  | ToolAction<"inspect_player">
  | ToolAction<"inspect_candidate_group">
  | ToolAction<"inspect_match">
  | (ToolAction<"search_candidates"> & { discoveryMetricGroups?: CapabilityMetricKey[][] })
  | (ToolAction<"evaluate_candidates"> & {
    eligiblePlayers: PlayerProfile[];
    understatResearch?: Readonly<Record<string, UnderstatPlayerInsight>>;
  });

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
  | { action: "inspect_team"; request: ToolAction<"inspect_team">; players: PlayerProfile[]; rosterContext?: TeamRosterContext; referenceNameResolution?: PlayerNameResolution | null; understatResearch?: UnderstatTeamInsight | null }
  | { action: "inspect_player"; request: ToolAction<"inspect_player">; research: UnderstatPlayerInsight }
  | { action: "inspect_candidate_group"; request: ToolAction<"inspect_candidate_group">; research: UnderstatPlayerInsight[] }
  | { action: "inspect_match"; request: ToolAction<"inspect_match">; research: UnderstatMatchInsight }
  | { action: "search_candidates"; request: ToolAction<"search_candidates"> & { discoveryMetricGroups?: CapabilityMetricKey[][] }; page: PlayerSearchPage }
  | {
    action: "evaluate_candidates";
    request: ToolAction<"evaluate_candidates"> & { eligiblePlayers: PlayerProfile[] };
    batch: RecruitmentEvaluationBatch;
  };

export async function executeRecruitmentToolAction(
  request: RecruitmentToolExecutionRequest,
  dependencies: {
    repository: PlayerRepository;
    teamRosterEnrichment?: TeamRosterEnrichmentProvider;
    referenceNameResolver?: PlayerNameResolver;
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
          ...(request.capabilityGaps ? { capabilityGaps: request.capabilityGaps } : {}),
          ...(request.playerContexts ? { playerContexts: request.playerContexts } : {}),
          limit: request.limit,
        }, { signal })),
      };
    case "inspect_team": {
      const [players, rosterContext, resolvedReference] = await Promise.all([
        observeCancellation(signal, () => inspectTeamPlayers(dependencies.repository, request.teamName, signal)),
        dependencies.teamRosterEnrichment?.lookupTeamRosterSample(request.teamName, signal),
        request.referenceResolutionOverride
          ? Promise.resolve({ status: "resolved" as const, mention: request.referenceMention ?? request.referenceResolutionOverride.preferredName,
            player: request.referenceResolutionOverride, resolutionMethod: "user_confirmed" as const })
          : request.referenceMention && dependencies.referenceNameResolver ? dependencies.referenceNameResolver(request.referenceMention, signal) : null,
      ]);
      const understatResearch = dependencies.repository.inspectTeamDetails
        ? await observeCancellation(signal, () => dependencies.repository.inspectTeamDetails!(request.teamName, signal))
        : undefined;
      throwIfAborted(signal);
      return {
        action: "inspect_team",
        request,
        players,
        ...(rosterContext ? { rosterContext } : {}),
        referenceNameResolution: resolvedReference,
        ...(understatResearch === undefined ? {} : { understatResearch }),
      };
    }
    case "inspect_player":
      if (!dependencies.repository.inspectPlayer) throw new Error("当前数据源不支持 Understat 球员细查。");
      return {
        action: "inspect_player",
        request,
        research: await observeCancellation(signal, () => dependencies.repository.inspectPlayer!(request.playerId, request.sections, signal)),
      };
    case "inspect_candidate_group":
      if (!dependencies.repository.inspectCandidateGroup) throw new Error("当前数据源不支持 Understat 候选组细查。");
      return {
        action: "inspect_candidate_group",
        request,
        research: await observeCancellation(signal, () => dependencies.repository.inspectCandidateGroup!(request.playerIds, request.sections, signal)),
      };
    case "inspect_match":
      if (!dependencies.repository.inspectMatch) throw new Error("当前数据源不支持 Understat 比赛细查。");
      return {
        action: "inspect_match",
        request,
        research: await observeCancellation(signal, () => dependencies.repository.inspectMatch!(request.matchId, signal)),
      };
    case "search_candidates":
      return {
        action: "search_candidates",
        request,
        page: await observeCancellation(signal, () => searchPlayerPage(dependencies.repository, {
          playerName: request.playerName,
          position: request.position,
          ...(request.positions?.length ? { positions: request.positions } : {}),
          maxAge: request.maxAge,
          minimumMinutes: request.minimumMinutes,
          competition: request.competition,
          season: request.season,
          offset: request.offset,
          limit: request.limit,
          ...(request.discoveryMetricGroups !== undefined ? { discoveryMetricGroups: request.discoveryMetricGroups } : {}),
        }, signal)),
      };
    case "evaluate_candidates":
      return {
        action: "evaluate_candidates",
        request,
        batch: await observeCancellation(signal, () => dependencies.evaluator.evaluate(
          request.eligiblePlayers,
          request.playerIds,
          signal,
          request.understatResearch ? { understatResearch: request.understatResearch } : undefined,
        )),
      };
    default: {
      const exhaustive: never = request;
      throw new Error(`Unsupported recruitment tool action: ${JSON.stringify(exhaustive)}`);
    }
  }
}
