import { compareWithReference, referenceComparisonEvidence } from "../reference-similarity.js";
import { teamNamesMatch } from "../../domain/team-names.js";
import { createReferencePlayerProfiles, resolveReplacementReferencePosition } from "../recruitment-comparison.js";
import { type PlayerRepository } from "../../players/repository.js";
import { describeDatasetScope } from "../../domain/dataset-scope.js";
import { type PlayerProfile } from "../../domain/players.js";
import { type Position } from "../../domain/position-contracts.js";
import { RecruitmentSearchScopeSchema } from "../../domain/reports.js";
import { isDetailedPosition, playerPositionMatches, positionMatches } from "../../domain/positions.js";
import { isUnderstatFinePositionSearch, withPendingUnderstatPositionEvidence, withUnderstatPositionEvidenceForTargets } from "../../sources/understat/position-evidence.js";
import { normalizeSearchText } from "../../domain/text-matching.js";
import { type CandidateIdentityGroup, toCandidateIdentityGroupReferences } from "../../players/identity/candidate-groups.js";
import { sourcePlayerKey } from "../../players/identity/source-player-key.js";
import { type RecruitmentEvidenceEvaluator } from "../recruitment-evidence-evaluator.js";
import type { RecruitmentToolExecutionResult } from "../recruitment-tool-executor.js";
import { candidateSearchObservationIndexForIntent, evaluatedPlayersForConstraint, resolvedCandidateSearchIntent } from "./candidate-context.js";
import type { RecruitmentTraceEvent } from "./contracts.js";
import { type CandidateSearchObservation, type State } from "./state.js";
import { replacementTargetMention } from "../replacement-target.js";

function withSourcePositionEvidence(player: PlayerProfile, targetPosition: Position): PlayerProfile {
  const directlyObserved = playerPositionMatches(player, targetPosition);
  const sourceCodes = [...new Set([
    ...(player.sourceIdentity?.sourcePositionLabels ?? []),
    ...(player.sourceIdentity?.positionGroup ? [player.sourceIdentity.positionGroup] : []),
    ...(player.sourceIdentity?.positionGroups ?? []),
    ...(player.sourceIdentity?.positionSamples?.map(({ position }) => position) ?? []),
    ...(player.position !== "UNKNOWN" ? [player.position] : []),
  ])];
  const roleSampleMinutes = player.sourceIdentity?.positionSamples
    ?.filter(({ position }) => positionMatches(position, targetPosition))
    .reduce((sum, sample) => sum + sample.minutes, 0);
  const positionEvidence = {
      provider: player.sourceIdentity?.provider ?? player.source,
      targetPosition,
      status: directlyObserved ? "direct" as const : "broad_only" as const,
      season: player.sourceIdentity?.seasonId ?? player.season,
      sourceCodes,
      sampleMinutes: directlyObserved
        ? roleSampleMinutes ?? (player.sourceIdentity?.positionGroup ? player.minutes : null)
        : null,
  };
  return { ...player, positionEvidence, positionEvidenceByPosition: { ...player.positionEvidenceByPosition, [targetPosition]: positionEvidence } };
}

function teamHistory(players: PlayerProfile[], teamName: string, repository: PlayerRepository) {
  const key = normalizeSearchText(teamName);
  const matches = players.filter((player) => {
    const team = normalizeSearchText(player.team);
    return teamNamesMatch(player.team, teamName) || (key.length >= 4 && team.includes(key)) || (team.length >= 4 && key.includes(team));
  });
  const currentSeasonMatches = matches.filter((player) => player.sourceIdentity?.isCurrentSeason === true);
  const displayedMatches = currentSeasonMatches.length ? currentSeasonMatches : matches;
  const seasons = [...new Set(matches.map((player) => `${player.competition} · ${player.season}`))];
  return {
    requestedTeam: teamName,
    matchedRecords: displayedMatches.length,
    sampledSeasons: seasons,
    sample: displayedMatches.slice(0, 12).map((player) => ({
      playerId: player.playerId,
      name: player.name,
      position: player.position,
      competition: player.competition,
      season: player.season,
      minutes: player.minutes,
      eventDataComplete: player.eventDataComplete !== false,
    })),
    currentRosterVerified: repository.mode === "sportmonks" && currentSeasonMatches.length > 0,
    note: currentSeasonMatches.length > 0 && repository.mode === "premier_league"
      ? "这些是 Premier League 当前赛季统计榜中的该队表现记录样本，不是球队完整注册阵容。"
      : currentSeasonMatches.length > 0 && repository.mode === "fpl"
        ? "这些是 Fantasy Premier League 当前赛季游戏目录中的该队球员记录，不代表球队完整注册名单。"
        : currentSeasonMatches.length > 0 && repository.mode === "asa"
          ? "这些是 ASA 返回的该队当前赛季表现记录样本，不是球队完整注册名单。"
          : currentSeasonMatches.length > 0 && repository.mode === "understat"
            ? "这些是 Understat 当前赛季联赛页中的该队表现记录样本，不是球队完整注册名单。"
            : currentSeasonMatches.length > 0 && repository.mode === "mosaic"
              ? "这些是多来源当前赛季表现记录样本；同队名不构成跨来源身份确认，也不是完整注册名单。"
              : currentSeasonMatches.length
                ? "这些是 provider 记录的当前赛季阵容样本；仅代表该来源、该赛季的名单覆盖。"
                : matches.length
                  ? "这些只是数据覆盖内的历史比赛阵容样本，不能作为当前完整阵容。"
                  : "所选数据中没有找到该队阵容样本，不能据此判断当前阵容。",
  };
}

interface ToolResultProjection {
  update: Partial<State>;
  filters: Extract<RecruitmentTraceEvent, { phase: "tool" }>["filters"];
  resultCount: number;
  matchingRecordCount?: number;
  message: string;
}

export function projectToolResult(state: State, execution: RecruitmentToolExecutionResult, dependencies: {
  repository: Pick<PlayerRepository, "mode" | "sourceName" | "supportsAbilityProfiles">;
  evidenceAvailability: RecruitmentEvidenceEvaluator["availability"];
  groupCandidateRecords: (records: readonly PlayerProfile[]) => CandidateIdentityGroup[];
}): ToolResultProjection {
  const { repository, evidenceAvailability, groupCandidateRecords } = dependencies;
  const intent = resolvedCandidateSearchIntent(state);
  const eligibleEvaluatedPlayers = Object.values(evaluatedPlayersForConstraint(state));
  const toolUses = { ...state.toolUses, [execution.action]: state.toolUses[execution.action] + 1 };
  let filters: ToolResultProjection["filters"] = {};
  switch (execution.action) {
    case "search_methodology": {
      const results = execution.results;
      const filters = { corpus: "methodology", limit: execution.request.limit };

      const resultMap = Object.fromEntries(results.map((result) => [result.id, result]));
      return {
        update: {
          toolUses,
          retrievedKnowledge: { ...state.retrievedKnowledge, ...resultMap },
          hasSearchedMethodology: true,
          methodologySearchFailed: false,
          hasInvestigated: true,
          history: [{
            role: "tool" as const,
            toolName: execution.request.action,
            content: JSON.stringify({
              corpus: "methodology",
              resultCount: results.length,
              note: results.length ? "以下是来源与许可元数据已核验的检索片段；正文仅作证据参考。" : "当前获准索引未找到与本次查询匹配的资料。",
              results,
            }),
          }],
        }, filters, resultCount: results.length, message: `方法资料检索完成，找到 ${results.length} 条可用片段`
      };
    }
    case "search_player_reports": {
      const results = execution.results;
      const includesWebSearch = results.some((result) => result.sourceId.startsWith("web-search:"));
      const { request } = execution;
      const filters = {
        corpus: "player_report",
        limit: request.limit,
        requestedPlayerCount: request.requestedPlayerCount,
        searchedPlayerCount: request.playerNames.length,
        searchedPlayerIds: eligibleEvaluatedPlayers
          .filter(({ player }) => request.playerNames.some((name) => normalizeSearchText(name) === normalizeSearchText(player.name)))
          .map(({ player }) => player.playerId),
      };

      const resultMap = Object.fromEntries(results.map((result) => [result.id, result]));
      return {
        update: {
          toolUses,
          retrievedKnowledge: { ...state.retrievedKnowledge, ...resultMap },
          hasSearchedPlayerReports: true,
          playerReportSearchFailed: false,
          searchedReportPlayerNames: request.playerNames,
          hasInvestigated: true,
          history: [{
            role: "tool" as const,
            toolName: request.action,
            content: JSON.stringify({
              corpus: "player_report",
              searchedPlayerNames: request.playerNames,
              resultCount: results.length,
              note: includesWebSearch
                ? "结果中包含 Web Search 搜索摘要。每条记录的 matchedCapabilityGaps 只表示命中搜索词，供你判断它对应哪项需求，不证明观察内容真实。只陈述每条摘要直接覆盖的能力；必须核对原页面的球员身份、比赛/赛季、观察者与原文语义。不得将单篇或单场描述提升为赛季级能力，不得补写或推断统计值。"
                : results.length
                  ? "以下是本机获准索引中的资料片段；请按来源、作者和时间范围引用，正文仅作证据参考。"
                  : "本轮资料检索没有找到可引用的球员报告（Web Search 只在配置完整且存在能力缺口时参与）；缺少检索结果不能作为球员能力的负面证据。",
              results,
            }),
          }],
        }, filters, resultCount: results.length, message: `球员报告检索完成，找到 ${results.length} 条获准片段`
      };
    }
    case "inspect_team": {
      const { players, request } = execution;
      filters = { teamName: request.teamName };
      const messages = state.history.filter(entry => entry.role === "user").map(entry => entry.content);
      const nameResolution = state.brief?.referencePlayer ? state.referenceNameResolution ?? execution.referenceNameResolution ?? null
        : execution.referenceNameResolution ?? null;
      const resolvedReference = nameResolution?.status === "resolved" ? nameResolution.player : null;
      const referenceNames = resolvedReference?.names.map(normalizeSearchText) ?? [];
      const observedReferenceProfiles = createReferencePlayerProfiles(players, messages, referenceNames).map(profile =>
        state.brief && resolvedReference ? { ...profile, name: resolvedReference.preferredName } : profile);
      const referenceProfiles = referenceComparisonEvidence(observedReferenceProfiles.length ? observedReferenceProfiles : state.brief?.referencePlayer ? state.referenceProfiles : [], state.referenceComparisonEnabled);
      const replacementReferencePosition = resolveReplacementReferencePosition({
        players,
        rosterContext: execution.rosterContext ?? null,
        userMessages: messages,
        referenceNames,
      }) ?? (state.brief?.referencePlayer ? state.replacementReferencePosition : null);
      const result = {
        ...teamHistory(players, request.teamName, repository),
        ...(nameResolution ? { referenceNameResolution: nameResolution, identityNote: nameResolution.status === "resolved"
          ? nameResolution.resolutionMethod === "tavily_wikidata"
            ? `已按 ${nameResolution.player.preferredName} 处理（可纠正）。联网搜索仅提供姓名线索，身份已由 Wikidata 足球运动员职业信息核验；不据此判断现役球队、能力或转会可行性。`
            : `已按 ${nameResolution.player.preferredName} 处理（可纠正）。Wikidata 多语言名称用于确认身份；不据此判断现役球队、能力或转会可行性。`
          : nameResolution.status === "ambiguous" || nameResolution.status === "needs_confirmation"
            ? `参考姓名“${replacementTargetMention(messages) ?? nameResolution.mention}”有多个或近似球员候选，必须由用户确认后才能继续。候选仅用于身份消歧，不表示其现役球队或能力。`
            : nameResolution.status === "unavailable"
              ? "球员身份查询服务暂不可用；不能把查询失败当成球员不存在，也不能继续猜测参考对象。"
              : `未找到足以确认“${replacementTargetMention(messages) ?? nameResolution.mention}”的足球运动员身份；请补充线索，不能按姓名相似度猜测。` } : {}),
        ...(replacementReferencePosition ? { replacementReferencePosition } : {}),
        ...(execution.rosterContext ? { currentRosterContext: execution.rosterContext } : {}),
        ...(execution.understatResearch ? { understatTeamResearch: execution.understatResearch } : {}),
      };
      const observed = Object.fromEntries(players.map((player) => [sourcePlayerKey(player), {
        competition: player.competition,
        season: player.season,
      }]));
      const observedRecords = { ...state.observedRecords, ...observed };

      return {
        update: {
          toolUses,
          observedRecords: observed,
          datasetScope: describeDatasetScope(repository.mode, Object.values(observedRecords)),
          targetTeam: state.brief ? state.targetTeam : request.teamName,
          referenceProfiles,
          ...(execution.understatResearch !== undefined ? { understatTeamResearch: execution.understatResearch } : {}),
          referenceNameResolution: nameResolution,
          ...(resolvedReference ? { referenceResolutionQuery: null } : {}),
          inspectedReferenceMention: normalizeSearchText(state.brief?.referencePlayer?.value ?? replacementTargetMention(messages) ?? ""),
          replacementReferencePosition,
          hasInvestigated: state.hasInvestigated || !resolvedCandidateSearchIntent(state).replacementRequest,
          history: [{ role: "tool" as const, toolName: request.action, content: JSON.stringify(result) }],
        }, filters, resultCount: result.sample.length, matchingRecordCount: result.matchedRecords, message: `球队样本检查完成，读取 ${players.length} 条球员赛季记录`
      };
    }
    case "inspect_player": {
      const research = execution.research;
      const targetPosition = (repository.mode === "understat" || repository.mode === "mosaic") && intent.position && isUnderstatFinePositionSearch(intent.position)
        ? intent.position
        : null;
      const player = state.discoveredPlayers[research.playerId];
      filters = {
        playerId: research.playerId,
        sections: research.requestedSections,
        availableSections: research.availableSections,
      };
      return {
        update: {
          toolUses,
          hasInvestigated: true,
          understatPlayerResearch: { ...state.understatPlayerResearch, [research.playerId]: research },
          ...(targetPosition && player ? { discoveredPlayers: {
            [research.playerId]: withUnderstatPositionEvidenceForTargets(player, research, intent.positions?.length ? intent.positions : [targetPosition]),
          } } : {}),
          history: [{ role: "tool" as const, toolName: execution.request.action, content: JSON.stringify(research) }],
        },
        filters,
        resultCount: research.availableSections.length,
        message: research.availableSections.length
          ? `Understat 返回了 ${research.name} 的 ${research.availableSections.length} 组细节（${research.availableSections.join("、")}）`
          : `已请求 ${research.name} 的 Understat 细节，但来源未返回可用记录`,
      };
    }
    case "inspect_candidate_group": {
      const research = execution.research;
      const byPlayer = Object.fromEntries(research.map((item) => [item.playerId, item]));
      const targetPosition = (repository.mode === "understat" || repository.mode === "mosaic") && intent.position && isUnderstatFinePositionSearch(intent.position)
        ? intent.position
        : null;
      const positionAwarePlayers = Object.fromEntries(research.flatMap((item) => {
        const player = state.discoveredPlayers[item.playerId];
        return targetPosition && player
          ? [[item.playerId, withUnderstatPositionEvidenceForTargets(player, item, intent.positions?.length ? intent.positions : [targetPosition])] as const]
          : [];
      }));
      filters = {
        playerIds: research.map((item) => item.playerId),
        sections: execution.request.sections,
        availableSections: [...new Set(research.flatMap((item) => item.availableSections))],
        availableSectionCounts: execution.request.sections.map((section) =>
          `${section}=${research.filter((item) => item.availableSections.includes(section)).length}/${research.length}`),
      };
      return {
        update: {
          toolUses,
          hasInvestigated: true,
          understatPlayerResearch: { ...state.understatPlayerResearch, ...byPlayer },
          ...(Object.keys(positionAwarePlayers).length ? { discoveredPlayers: positionAwarePlayers } : {}),
          history: [{ role: "tool" as const, toolName: execution.request.action, content: JSON.stringify(research) }],
        },
        filters,
        resultCount: research.length,
        message: `已检查 ${research.length} 名候选人；来源共返回 ${research.reduce((count, item) => count + item.availableSections.length, 0)} 份字段组证据`,
      };
    }
    case "inspect_match": {
      const research = execution.research;
      filters = { matchId: research.matchId };
      return {
        update: {
          toolUses,
          hasInvestigated: true,
          understatMatchResearch: { ...state.understatMatchResearch, [research.matchId]: research },
          history: [{ role: "tool" as const, toolName: execution.request.action, content: JSON.stringify(research) }],
        },
        filters,
        resultCount: research.shots.length,
        message: `已读取 Understat 比赛 ${research.matchId} 的阵容和 ${research.shots.length} 条射门记录`,
      };
    }
    case "search_candidates": {
      const { page: result, request } = execution;
      const requestedOffset = state.candidateSearchCursorAdjustment?.requestedOffset ?? request.offset;
      const currentSearchIntent = resolvedCandidateSearchIntent(state);
      const minimumObservationIndex = state.candidateSearchScopeChanged ? state.candidateSearchTurnStartIndex : 0;
      const priorMatchingObservationIndex = candidateSearchObservationIndexForIntent(
        currentSearchIntent,
        state.candidateSearchObservations,
        minimumObservationIndex,
      );
      const priorMatchingObservation = priorMatchingObservationIndex === null
        ? null
        : state.candidateSearchObservations[priorMatchingObservationIndex] ?? null;
      const targetPosition = request.position && isDetailedPosition(request.position)
        && result.appliedFilters.includes("positionFamily")
        ? request.position
        : null;
      filters = {
        position: request.position,
        maxAge: request.maxAge,
        minimumMinutes: request.minimumMinutes,
        competition: request.competition,
        season: request.season,
        discoveryMetricGroups: request.discoveryMetricGroups ?? [],
        caseSearchObservationCount: state.candidateSearchObservations.length,
        currentTurnObservationStartIndex: state.candidateSearchTurnStartIndex,
        candidateSearchScopeChanged: state.candidateSearchScopeChanged,
        priorMatchingSearchFound: priorMatchingObservation !== null,
        priorMatchingNextOffset: priorMatchingObservation?.nextOffset ?? null,
        requestedOffset,
        offset: request.offset,
        limit: request.limit,
        playerNameFilterUsed: Boolean(request.playerName),
        ...(result.discovery ? { discoveryStrategy: result.discovery.strategy, discoveryMetricKeys: result.discovery.metricKeys } : {}),
      };
      const targets = request.positions?.length ? request.positions : targetPosition ? [targetPosition] : [];
      const additions = Object.fromEntries(result.players.map((record) => {
        const player: PlayerProfile = { ...record, positionEvidenceByPosition: state.discoveredPlayers[record.playerId]?.positionEvidenceByPosition };
        if (!targets.length) return [player.playerId, player];
        if (player.sourceIdentity?.provider !== "understat") {
          const verified = targets.reduce<PlayerProfile>((current, target) => withSourcePositionEvidence(current, target), player);
          const primary = targets.map((target) => verified.positionEvidenceByPosition?.[target]).find((item) => item?.status === "direct") ?? verified.positionEvidence;
          return [player.playerId, { ...verified, positionEvidence: primary }];
        }
        const existingResearch = state.understatPlayerResearch[player.playerId];
        return [player.playerId, existingResearch
          ? withUnderstatPositionEvidenceForTargets(player, existingResearch, targets)
          : withPendingUnderstatPositionEvidence(player, targets[0]!)];
      }));
      const discoveredPlayers = { ...state.discoveredPlayers, ...additions };
      const identityGroups = groupCandidateRecords(Object.values(discoveredPlayers));
      const identityGroupReferences = toCandidateIdentityGroupReferences(identityGroups);
      const identityGroupByPlayerId = new Map(identityGroupReferences.flatMap((group) => (
        group.recordPlayerIds.map((playerId) => [playerId, group] as const)
      )));
      const candidateSummaries = result.players.map((player) => {
        const identityGroup = identityGroupByPlayerId.get(player.playerId);
        return {
          playerId: player.playerId,
          name: player.name,
          team: player.team,
          position: player.position,
          ...(player.positionEvidence ? { positionEvidence: player.positionEvidence } : {}),
          age: player.age,
          competition: player.competition,
          season: player.season,
          minutes: player.minutes,
          source: player.source,
          sourceIdentity: player.sourceIdentity ? {
            provider: player.sourceIdentity.provider,
            sourceRecordId: player.sourceIdentity.playerId,
            competitionId: player.sourceIdentity.competitionId ?? null,
            seasonId: player.sourceIdentity.seasonId ?? null,
            retrievedAt: player.sourceIdentity.retrievedAt,
          } : null,
          identityResolution: identityGroup?.status ?? "missing_source_identity",
          sameIdentitySourceRecordIds: identityGroup?.status === "resolved"
            ? identityGroup.recordPlayerIds.filter((recordId) => recordId !== player.playerId)
            : [],
        };
      });
      filters.nextOffset = result.nextOffset;
      if (result.appliedFilters.includes("positionFamily")) filters.positionSearchScope = "family_retrieval";
      filters.candidateIds = candidateSummaries.map((candidate) => candidate.playerId);

      const observed = Object.fromEntries(result.players.map((player) => [sourcePlayerKey(player), {
        competition: player.competition,
        season: player.season,
      }]));
      const observedRecords = { ...state.observedRecords, ...observed };
      const reportScope = RecruitmentSearchScopeSchema.parse({
        ...(request.excludedCompetitions?.length ? { excludedCompetitions: request.excludedCompetitions } : {}),
        ...(request.positions?.length ? { positions: request.positions } : {}),
        position: request.position,
        maxAge: request.maxAge,
        minimumMinutes: request.minimumMinutes,
        competition: request.competition,
        season: request.season,
        source: intent.position
          ? request.maxAge === null && request.minimumMinutes === 0 && request.competition === null && request.season === null
            ? intent.positionBasis === "user" ? "user_confirmed" : "agent_interpreted"
            : "mixed"
          : "agent_interpreted",
      });
      const searchObservation: CandidateSearchObservation = {
        request: { ...request, offset: requestedOffset },
        discoveryMetricGroups: request.discoveryMetricGroups ?? [],
        ...(result.discovery ? { discoveryStrategy: result.discovery.strategy } : {}),
        appliedFilters: result.appliedFilters,
        actualOffset: result.offset,
        nextOffset: result.nextOffset,
        matchingRecordCount: result.totalRecords,
        discoveredSourceRecordIds: result.players.map(sourcePlayerKey),
        reportScope,
      };
      return {
        update: {
          toolUses,
          datasetScope: describeDatasetScope(repository.mode, Object.values(observedRecords)),
          observedRecords: observed,
          candidateSearchObservations: [searchObservation],
          candidateSearchFailure: null,
          candidateSearchSucceededThisTurn: true,
          ...(intent.replacementRequest && intent.position === null && !intent.allowsAnyPosition && request.position !== null
            ? { replacementReferencePosition: request.position }
            : {}),
          discoveredPlayers: additions,
          candidateIdentityGroups: identityGroupReferences,
          hasInvestigated: true,
          ...(intent.position !== null && request.position === intent.position
            ? {
              confirmedPositionSearchObservationIndex: state.candidateSearchObservations.length,
            }
            : {}),
          history: [{
            role: "tool" as const, toolName: request.action, content: JSON.stringify({
              candidates: candidateSummaries,
              matchingRecords: result.totalRecords,
              matchingRecordCountKnown: result.totalRecords !== null,
              appliedFilters: result.appliedFilters,
              ...(targetPosition ? {
                positionEvidenceNote: repository.supportsAbilityProfiles
                  ? `能力画像中熟练度足够的${targetPosition}位置可用于职责筛选；比赛位置标签用于补充近期实战背景。没有画像或明确比赛位置的宽位置记录仍只是待核实线索。`
                  : repository.mode === "understat" || repository.mode === "mosaic"
                  ? `Understat 只按${targetPosition}对应的位置族召回；细分位置尚需按 Understat 当前赛季位置记录核实。其他来源只有自身明确返回${targetPosition}细分位置时才可作为目标位置候选。`
                  : `先按${targetPosition}对应的大类召回。只有来源明确提供${targetPosition}细分位置的记录才能进入目标位置名单；宽位置记录会作为待核实线索单独展示。`,
              } : {}),
              ...(result.discovery ? { discovery: result.discovery, discoveryNote: repository.supportsAbilityProfiles ? "比赛记录按可用指标发现线索；能力画像按用户所需职责属性召回，两条路径交错并保留完整分页。属性不使用比赛分钟加权，未知值保持未知；召回顺序不是最终推荐排名。" : "按用户明确可测的表现维度，在各来源、赛事、赛季和位置组内分别选取线索后交错发现；每90分钟指标按其实际样本还原累计观测量作发现依据，其他口径优先有明确分母的样本。没有相关指标时按出场样本发现。不是综合能力或跨联赛实力排名；低分钟和缺字段记录仍保留。" } : {}),
              offset: result.offset,
              nextOffset: result.nextOffset,
              requestedOffset,
              paginationNote: result.nextOffset === null
                ? "当前筛选已到最后一页。请评估已经发现的候选人，或在用户允许时调整筛选；不要重复读取此页。"
                : `本次实际读取 offset=${result.offset}。若需要更多候选，下一页必须使用返回的 nextOffset=${result.nextOffset}，不要重复或跳过页码。`,
              ...(result.totalRecords === null ? { totalCountNote: "数据源未提供精确匹配总数；matchingRecords 为 null，不代表没有其他匹配球员。" } : {}),
              identityNote: "只有同一稳定 Reep ID 的精确映射才表示这些来源记录属于同一候选人；其他状态的记录保持独立。已关联的来源记录仍分别评估和引用，不会混合不同来源的指标。",
            })
          }],
        }, filters, resultCount: candidateSummaries.length, ...(result.totalRecords === null ? {} : { matchingRecordCount: result.totalRecords }), message: result.nextOffset === null
          ? `候选搜索完成，本页发现 ${candidateSummaries.length} 人，已到当前数据范围末页`
          : `候选搜索完成，本页发现 ${candidateSummaries.length} 人，仍有后续数据页`
      };
    }
    case "evaluate_candidates": {
      const { batch, request } = execution;
      const result = Object.fromEntries(Object.entries(batch.evaluations).map(([id, candidate]) => [id, { ...candidate,
        ...(state.brief?.task === "similarity" ? { referenceSimilarity: compareWithReference(candidate, state.referenceProfiles) } : {}),
      }]));
      filters = {
        requestedPlayerCount: request.playerIds.length,
        evidenceAvailability: evidenceAvailability,
      };
      filters.evaluatedPlayerIds = Object.keys(result);
      filters.evaluatedMetricKeys = [...new Set(Object.values(result).flatMap(({ evidence }) => (
        evidence.map(({ key }) => key)
      )))];
      filters.evaluatedMetricValueCount = Object.values(result).reduce((count, candidate) => (
        count + candidate.evidence.length
      ), 0);

      const missing = request.playerIds.filter((id) => !result[id]);
      const toolResult = {
        evaluations: Object.values(result).map(({ player, evidence, roleFits, referenceSimilarity }) => ({
          playerId: player.playerId,
          name: player.name,
          age: player.age,
          position: player.position,
          competition: player.competition,
          season: player.season,
          minutes: player.minutes,
          source: player.source,
          metrics: evidence,
          ...(roleFits ? { roleFits } : {}),
          ...(referenceSimilarity ? { referenceSimilarity } : {}),
        })),
        missingPlayerIds: missing,
        evidenceAvailability: evidenceAvailability,
        note: evidenceAvailability === "experimentally_withheld"
          ? "本实验控制组有意屏蔽了候选表现评估器。未返回指标、百分位或能力评分；这不是 0 值，也不表示来源缺字段或球员没有该项能力。"
          : "返回可用比赛证据与能力画像。basis=ability_profile 是职责属性评价，按 /100 表示，不适用分钟门槛或比赛百分位；不能改写为实际比赛产出。比赛统计缺失不会记零，百分位仍遵循样本与同组比较规则。",
      };
      const observed = Object.fromEntries(batch.observedPlayers.map((player) => [sourcePlayerKey(player), {
        competition: player.competition,
        season: player.season,
      }]));
      const observedRecords = { ...state.observedRecords, ...observed };
      return {
        update: {
          toolUses,
          evaluatedPlayers: result,
          evidenceEvaluationWithheld: evidenceAvailability === "experimentally_withheld",
          observedRecords: observed,
          datasetScope: describeDatasetScope(repository.mode, Object.values(observedRecords)),
          hasInvestigated: true,
          history: [{ role: "tool" as const, toolName: request.action, content: JSON.stringify(toolResult) }],
        }, filters, resultCount: Object.keys(result).length, message: evidenceAvailability === "experimentally_withheld"
          ? `实验对照组已屏蔽表现评估证据；保留 ${Object.keys(result).length} 名候选身份，不表示零分`
          : `表现评估完成，已评估 ${Object.keys(result).length} 名候选球员`
      };
    }
    default: {
      const exhaustive: never = execution;
      throw new Error(`Unsupported recruitment tool result: ${JSON.stringify(exhaustive)}`);
    }
  }
}
