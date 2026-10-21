import type { TeamRosterEnrichmentProvider } from "../sources/thesportsdb/roster.js";
import { type CapabilityMetricKey } from "../domain/capabilities.js";
import { randomUUID } from "node:crypto";
import { type TeamRosterContext } from "../domain/conversation.js";
import { type PlayerProfile } from "../domain/players.js";
import type { RecruitmentEvaluationBatch, RecruitmentEvidenceEvaluator } from "./recruitment-evidence-evaluator.js";
import type { KnowledgeRepository } from "../knowledge/index.js";
import type { KnowledgePlayerContext, KnowledgeSearchResult } from "../knowledge/schemas.js";
import type { KnowledgeEvidence } from "../knowledge/evidence.js";
import type { EvidenceAccessContext, EvidenceSubjectCoverage, KnowledgeEvidenceBundle } from "../knowledge/evidence-schemas.js";
import { inspectTeamPlayers, searchPlayerPage, type PlayerRepository, type PlayerSearchPage } from "../players/repository.js";
import type { ParsedRecruitmentAction, ToolActionName } from "./recruitment-actions.js";
import { throwIfAborted } from "../domain/abort.js";
import type { PlayerIdentityCandidate, PlayerNameResolution, PlayerNameResolver } from "../players/identity/name-resolver.js";
import type { UnderstatMatchInsight, UnderstatPlayerInsight, UnderstatTeamInsight } from "../sources/understat/research.js";
import { knowledgeSearchResultsFromEvidence } from "../knowledge/evidence-adapter.js";

type ToolAction<Action extends ToolActionName> = Extract<ParsedRecruitmentAction, { action: Action }>;

export type KnowledgeSearchOutcome = Pick<KnowledgeEvidenceBundle, "status" | "failureCode" | "traceId" | "rankingMode" | "subjectCoverage" | "generationId" | "rankingDurationMs" | "rankingInputTokens" | "rankingOutputTokens" | "candidateCount" | "budgetMsUsed" | "budgetMsRemaining"> & { coverageNote?: string };

function knowledgeSearchOutcome(result: KnowledgeEvidenceBundle): KnowledgeSearchOutcome {
  return {
    status: result.status,
    failureCode: result.failureCode,
    traceId: result.traceId,
    rankingMode: result.rankingMode,
    subjectCoverage: result.subjectCoverage,
    generationId: result.generationId,
    rankingDurationMs: result.rankingDurationMs,
    rankingInputTokens: result.rankingInputTokens,
    rankingOutputTokens: result.rankingOutputTokens,
    candidateCount: result.candidateCount,
    budgetMsUsed: result.budgetMsUsed,
    budgetMsRemaining: result.budgetMsRemaining,
  };
}

function localOutcome(results: KnowledgeSearchResult[]): KnowledgeSearchOutcome {
  return {
    status: results.length ? "found" : "no_relevant_evidence",
    failureCode: null,
    traceId: randomUUID(),
    rankingMode: results.length ? "hybrid" : null,
    subjectCoverage: [],
    generationId: null,
    rankingDurationMs: null,
    rankingInputTokens: null,
    rankingOutputTokens: null,
    candidateCount: results.length,
    budgetMsUsed: 0,
    budgetMsRemaining: 15_000,
  };
}

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
    sampleFrom?: string;
    sampleTo?: string;
    sampleSeasons?: string[];
    sampleScopeUnavailable?: boolean;
  })
  | (ToolAction<"inspect_team"> & { referenceMention?: string; referenceResolutionOverride?: PlayerIdentityCandidate })
  | ToolAction<"inspect_player">
  | ToolAction<"inspect_candidate_group">
  | ToolAction<"inspect_match">
  | (ToolAction<"search_candidates"> & { discoveryMetricGroups?: CapabilityMetricKey[][]; referenceRoles?: import("../players/search.js").PlayerSearchQuery["referenceRoles"]; excludedCompetitions?: readonly string[] })
  | (ToolAction<"evaluate_candidates"> & {
    eligiblePlayers: PlayerProfile[];
    understatResearch?: Readonly<Record<string, UnderstatPlayerInsight>>;
  });

export type RecruitmentToolExecutionResult =
  | { action: "search_methodology"; request: ToolAction<"search_methodology">; results: KnowledgeSearchResult[]; outcome: KnowledgeSearchOutcome }
  | {
    action: "search_player_reports";
    request: Omit<ToolAction<"search_player_reports">, "playerNames"> & {
      playerNames: string[];
      requestedPlayerCount: number;
    };
    results: KnowledgeSearchResult[];
    outcome: KnowledgeSearchOutcome;
  }
  | { action: "inspect_team"; request: ToolAction<"inspect_team">; players: PlayerProfile[]; rosterContext?: TeamRosterContext; referenceNameResolution?: PlayerNameResolution | null; understatResearch?: UnderstatTeamInsight | null }
  | { action: "inspect_player"; request: ToolAction<"inspect_player">; research: UnderstatPlayerInsight }
  | { action: "inspect_candidate_group"; request: ToolAction<"inspect_candidate_group">; research: UnderstatPlayerInsight[] }
  | { action: "inspect_match"; request: ToolAction<"inspect_match">; research: UnderstatMatchInsight }
  | { action: "search_candidates"; request: Extract<RecruitmentToolExecutionRequest, { action: "search_candidates" }>; page: PlayerSearchPage }
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
    knowledgeEvidence?: KnowledgeEvidence;
    knowledgeEvidenceContext?: EvidenceAccessContext;
    identityResolutionScopeId?: string;
    evaluator: RecruitmentEvidenceEvaluator;
    signal?: AbortSignal;
  },
): Promise<RecruitmentToolExecutionResult> {
  const { signal } = dependencies;
  throwIfAborted(signal);
  switch (request.action) {
    case "search_methodology": {
      if (dependencies.knowledgeEvidence && dependencies.knowledgeEvidenceContext) {
        const result = await observeCancellation(signal, () => dependencies.knowledgeEvidence!.reader.retrieve({
          kind: "methodology",
          query: request.query,
          limit: request.limit,
        }, dependencies.knowledgeEvidenceContext!, signal));
        return { action: "search_methodology", request, results: knowledgeSearchResultsFromEvidence(result), outcome: knowledgeSearchOutcome(result) };
      }
      const results = await observeCancellation(signal, () => dependencies.knowledgeBase.search({
        corpus: "methodology",
        query: request.query,
        playerNames: [],
        limit: request.limit,
      }, { signal }));
      return {
        action: "search_methodology",
        request,
        results,
        outcome: localOutcome(results),
      };
    }
    case "search_player_reports": {
      if (dependencies.knowledgeEvidence && dependencies.knowledgeEvidenceContext) {
        if (request.sampleScopeUnavailable) {
          return {
            action: "search_player_reports",
            request,
            results: [],
            outcome: {
              status: "unavailable", failureCode: "sample_scope_unavailable", traceId: randomUUID(), rankingMode: null,
              subjectCoverage: [], generationId: null, rankingDurationMs: null, rankingInputTokens: null,
              rankingOutputTokens: null, candidateCount: 0, budgetMsUsed: 0, budgetMsRemaining: 15_000,
              coverageNote: "用户指定了时间范围，但系统无法将其编译为可验证的日期或赛季过滤；未查询资料。",
            },
          };
        }
        const verifiedRecordSubjects = (request.playerContexts ?? []).flatMap((context) => (context.verifiedSubjectIds ?? []).map((subjectId) => ({
          subjectId,
          displayName: context.playerName,
          aliases: [],
        })));
        const unverifiedSubjectNames = new Set<string>();
        let identityResolverUnavailable = false;
        const resolvedSubjects = dependencies.referenceNameResolver
          ? await Promise.all(request.playerNames.slice(0, 10).map(async (displayName) => {
            try {
              const resolution = await observeCancellation(signal, () => dependencies.referenceNameResolver!(displayName, signal, {
                ...(dependencies.identityResolutionScopeId ? { scopeId: dependencies.identityResolutionScopeId } : {}),
              }));
              if (resolution.status === "unavailable") {
                identityResolverUnavailable = true;
                return [];
              }
              if (resolution.status !== "resolved" || !/^Q\d+$/.test(resolution.player.entityId)) {
                unverifiedSubjectNames.add(displayName);
                return [];
              }
              return [{
                subjectId: resolution.player.entityId,
                displayName: resolution.player.preferredName,
                aliases: resolution.player.names,
              }];
            } catch (error) {
              if (signal?.aborted) throw error;
              identityResolverUnavailable = true;
              return [];
            }
          })).then((groups) => groups.flat())
          : [];
        const uniqueSubjects = [...new Map([...verifiedRecordSubjects, ...resolvedSubjects].map((subject) => [subject.subjectId, subject])).values()];
        if (identityResolverUnavailable) {
          return {
            action: "search_player_reports",
            request,
            results: [],
            outcome: {
              status: "unavailable", failureCode: "identity_unavailable", traceId: randomUUID(), rankingMode: null,
              subjectCoverage: [], generationId: null, rankingDurationMs: null, rankingInputTokens: null,
              rankingOutputTokens: null, candidateCount: 0, budgetMsUsed: 0, budgetMsRemaining: 15_000,
            },
          };
        }
        if (!uniqueSubjects.length) {
          return {
            action: "search_player_reports",
            request,
            results: [],
            outcome: {
              status: "not_covered", failureCode: null, traceId: randomUUID(), rankingMode: null, subjectCoverage: [],
              generationId: null, rankingDurationMs: null, candidateCount: 0, budgetMsUsed: 0, budgetMsRemaining: 15_000,
              rankingInputTokens: null, rankingOutputTokens: null,
              coverageNote: unverifiedSubjectNames.size
                ? `这些主体的身份尚未核验，未查询其资料：${[...unverifiedSubjectNames].join("、")}。`
                : "没有取得可将候选记录与球员资料绑定的已核验主体标识；未查询语料。",
            },
          };
        }
        const result = await observeCancellation(signal, () => dependencies.knowledgeEvidence!.reader.retrieve({
          kind: "player_report",
          query: request.query,
          subjects: uniqueSubjects,
          ...(request.sampleFrom ? { sampleFrom: request.sampleFrom } : {}),
          ...(request.sampleTo ? { sampleTo: request.sampleTo } : {}),
          ...(request.sampleSeasons?.length ? { sampleSeasons: request.sampleSeasons } : {}),
          limit: request.limit,
          perSubjectLimit: Math.min(2, request.limit),
        }, dependencies.knowledgeEvidenceContext!, signal));
        return {
          action: "search_player_reports",
          request,
          results: knowledgeSearchResultsFromEvidence(result),
          outcome: {
            ...knowledgeSearchOutcome(result),
            ...(unverifiedSubjectNames.size ? { coverageNote: `这些候选身份没有完成核验，因此没有查询：${[...unverifiedSubjectNames].join("、")}。` } : {}),
          },
        };
      }
      const hasVerifiedPlayerIdentity = request.playerContexts?.some((context) => context.verifiedSubjectIds?.length) ?? false;
      return {
        action: "search_player_reports",
        request,
        results: [],
        outcome: hasVerifiedPlayerIdentity ? {
          status: "unavailable",
          failureCode: "index_unavailable",
          traceId: randomUUID(),
          rankingMode: null,
          subjectCoverage: [],
          generationId: null,
          rankingDurationMs: null,
          rankingInputTokens: null,
          rankingOutputTokens: null,
          candidateCount: 0,
          budgetMsUsed: 0,
          budgetMsRemaining: 15_000,
          coverageNote: "新知识证据模块或本回合访问上下文未连接；没有按姓名查询旧索引。",
        } : {
          status: "not_covered",
          failureCode: null,
          traceId: randomUUID(),
          rankingMode: null,
          subjectCoverage: [],
          generationId: null,
          rankingDurationMs: null,
          rankingInputTokens: null,
          rankingOutputTokens: null,
          candidateCount: 0,
          budgetMsUsed: 0,
          budgetMsRemaining: 15_000,
          coverageNote: "这些球员尚无可用于绑定资料的已核验主体 ID；没有按姓名查询旧索引。",
        },
      };
    }
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
      if (resolvedReference?.status === "resolved" && dependencies.repository.findPlayersByNames) {
        const references = await dependencies.repository.findPlayersByNames(resolvedReference.player.names, signal);
        const existing = new Set(players.map((player) => player.playerId));
        players.push(...references.filter((player) => !existing.has(player.playerId)));
      }
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
          ...(request.targetTeam !== undefined ? { targetTeam: request.targetTeam } : {}),
          ...(request.referenceRoles ? { referenceRoles: request.referenceRoles } : {}),
          ...(request.excludedCompetitions?.length ? { excludedCompetitions: request.excludedCompetitions } : {}),
          playerName: request.playerName,
          position: request.position,
          ...(request.positions?.length ? { positions: request.positions } : {}),
          maxAge: request.maxAge,
          ...(request.minAge == null ? {} : { minAge: request.minAge }),
          ...(request.agePreference ? { agePreference: request.agePreference } : {}),
          minimumMinutes: request.minimumMinutes,
          ...(request.fmCriteria?.length ? { fmCriteria: request.fmCriteria } : {}),
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
