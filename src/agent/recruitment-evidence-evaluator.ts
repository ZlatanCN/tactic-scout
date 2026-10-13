import {
  CapabilityMetricDefinitions,
  SupplementaryCapabilityMetricDefinitions,
  type CapabilityEvidence,
  type CapabilityMetricKey,
  type PlayerProfile,
} from "../domain/schemas.js";
import { comparePeerPercentile, minimumMinutesForPercentileComparison } from "../domain/evidence-comparison.js";
import { loadComparisonPlayers, loadPlayersByIds, type PlayerRepository } from "../data/provider.js";
import { sourcePlayerKey } from "../identity/source-player-key.js";
import { toPer90 } from "./performance-metrics.js";
import { throwIfAborted } from "../domain/abort.js";

export interface EvaluatedCandidate {
  player: PlayerProfile;
  evidence: CapabilityEvidence[];
}

export interface RecruitmentEvaluationBatch {
  evaluations: Record<string, EvaluatedCandidate>;
  observedPlayers: PlayerProfile[];
}

export type RecruitmentEvidenceAvailability = "available" | "experimentally_withheld";

export interface RecruitmentEvidenceEvaluator {
  availability: RecruitmentEvidenceAvailability;
  evaluate(eligiblePlayers: PlayerProfile[], requestedIds: string[], signal?: AbortSignal): Promise<RecruitmentEvaluationBatch>;
  describe(evidence: CapabilityEvidence): string;
  coverage(candidate: EvaluatedCandidate): { expectedMetricCount: number; hasMissingMetrics: boolean };
}

function metricValue(player: PlayerProfile, key: CapabilityMetricKey): number | undefined {
  const supplementary = player.supplementaryMetrics?.find((metric) => metric.key === key);
  if (supplementary) return supplementary.value ?? undefined;
  if (player.eventDataComplete === false || (key === "passCompletionPct" && player.stats.passesAttempted === 0)) return undefined;
  return (toPer90(player) as unknown as Record<CapabilityMetricKey, number | null>)[key] ?? undefined;
}

function metricDefinitionsFor(player: PlayerProfile): Array<{ key: CapabilityMetricKey; label: string; unit: string }> {
  const definitions: Array<{ key: CapabilityMetricKey; label: string; unit: string }> = [...CapabilityMetricDefinitions];
  for (const definition of SupplementaryCapabilityMetricDefinitions) {
    if (player.supplementaryMetrics?.some((metric) => metric.key === definition.key)) definitions.push(definition);
  }
  return definitions;
}

function comparisonCohortKey(player: PlayerProfile): string {
  const identity = player.sourceIdentity;
  return [
    identity?.provider ?? player.source,
    identity?.competitionId ?? player.competition,
    identity?.seasonId ?? player.season,
    player.position,
  ].join("\u0000");
}

async function evaluatePlayers(
  repository: PlayerRepository,
  eligiblePlayers: PlayerProfile[],
  requestedIds: string[],
  signal?: AbortSignal,
): Promise<RecruitmentEvaluationBatch> {
  throwIfAborted(signal);
  const eligibleIds = new Set(eligiblePlayers.map((player) => player.playerId));
  const selectedIds = [...new Set(requestedIds.filter((id) => eligibleIds.has(id)))];
  const requestedPlayers = await loadPlayersByIds(repository, selectedIds, signal);
  throwIfAborted(signal);
  const selected = selectedIds.flatMap((id) => {
    const player = requestedPlayers.find((candidate) => candidate.playerId === id);
    return player ? [player] : [];
  });
  const comparisonPlayers = await loadComparisonPlayers(repository, selected, signal);
  throwIfAborted(signal);
  const peerPool = [...new Map([...selected, ...comparisonPlayers].map((player) => [sourcePlayerKey(player), player])).values()];
  const evaluations = Object.fromEntries(selected.map((player) => {
    throwIfAborted(signal);
    const cohortKey = comparisonCohortKey(player);
    const peers = peerPool.filter((candidate) => candidate.eventDataComplete !== false
      && comparisonCohortKey(candidate) === cohortKey);
    const evidence = metricDefinitionsFor(player).flatMap(({ key, label, unit }) => {
      const value = metricValue(player, key);
      if (value === undefined) return [];
      const supplementary = player.supplementaryMetrics?.find((metric) => metric.key === key);
      const minutes = supplementary ? supplementary.sampleMinutes : player.minutes;
      const peerSamples = peers.flatMap((peer) => {
        const peerValue = metricValue(peer, key);
        if (peerValue === undefined) return [];
        const peerSupplementary = peer.supplementaryMetrics?.find((metric) => metric.key === key);
        return [{ value: peerValue, minutes: peerSupplementary ? peerSupplementary.sampleMinutes : peer.minutes }];
      });
      const comparison = comparePeerPercentile(value, minutes, peerSamples);
      return [{
        key,
        label,
        value,
        unit,
        ...comparison,
        minutes,
        ...(supplementary?.sampleMatches == null ? {} : { sampleMatches: supplementary.sampleMatches }),
        ...(supplementary?.sampleAttempts == null ? {} : { sampleAttempts: supplementary.sampleAttempts }),
        ...(supplementary?.sampleAttemptsLabel === undefined ? {} : { sampleAttemptsLabel: supplementary.sampleAttemptsLabel }),
        ...(supplementary ? { definition: supplementary.definition } : {}),
        ...(supplementary ? { normalization: supplementary.normalization } : {}),
        competition: player.competition,
        season: player.season,
        source: player.source,
        ...(supplementary ? { sourceField: supplementary.sourceField } : {}),
      } satisfies CapabilityEvidence];
    });
    return [player.playerId, { player, evidence }];
  }));
  return { evaluations, observedPlayers: peerPool };
}

function trimMetricZeros(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, ".00");
}

function describeEvidence(item: CapabilityEvidence): string {
  const value = Number.isInteger(item.value)
    ? item.value.toLocaleString()
    : Math.abs(item.value) < 0.1 ? trimMetricZeros(item.value.toFixed(4)) : item.value.toFixed(2);
  const comparison = (() => {
    switch (item.peerPercentileUnavailableReason) {
      case "candidate_sample_unknown":
        return "来源没有提供该指标的样本分钟，未显示百分位";
      case "candidate_low_sample":
        return item.minutes === null
          ? "该指标样本分钟未知，未显示百分位"
          : `该指标样本 ${Math.round(item.minutes)} 分钟，低于本项目 ${minimumMinutesForPercentileComparison} 分钟比较门槛，未显示百分位`;
      case "insufficient_peer_group":
        return `达到 ${minimumMinutesForPercentileComparison} 分钟门槛的同位置/赛事/赛季同组仅 ${item.peerGroupSize} 人，不足 5 人，未显示百分位`;
      default:
        return item.peerPercentile === null
          ? `同位置/赛事/赛季样本 ${item.peerGroupSize} 人，无法显示百分位`
          : `同位置/赛事/赛季第 ${item.peerPercentile} 百分位（${item.peerGroupSize} 人）`;
    }
  })();
  const sampleMinutes = item.minutes === null ? "样本分钟未知" : `${Math.round(item.minutes)} 分钟`;
  const sample = item.sampleMatches === undefined && item.minutes === null
    ? `；${sampleMinutes}`
    : item.sampleMatches === undefined ? "" : `；样本 ${item.sampleMatches} 场、${sampleMinutes}`;
  const attempts = item.sampleAttempts === undefined ? "" : `、${item.sampleAttempts} ${item.sampleAttemptsLabel ?? "次非点球射门"}`;
  const sourceField = item.sourceField ? `；来源字段 ${item.sourceField}` : "";
  return `${item.label} ${value} ${item.unit}${sample}${attempts}${sourceField}；${comparison}。`;
}

export function createRecruitmentEvidenceEvaluator(repository: PlayerRepository): RecruitmentEvidenceEvaluator {
  return {
    availability: "available",
    evaluate: (eligiblePlayers, requestedIds, signal) => evaluatePlayers(repository, eligiblePlayers, requestedIds, signal),
    describe: describeEvidence,
    coverage: (candidate) => {
      const expectedMetricCount = metricDefinitionsFor(candidate.player).length;
      return { expectedMetricCount, hasMissingMetrics: candidate.evidence.length < expectedMetricCount };
    },
  };
}
