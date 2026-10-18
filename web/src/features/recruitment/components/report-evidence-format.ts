import type { CapabilityEvidence } from "../../../../../src/domain/capabilities.js";
import type { PlayerEloSignal } from "../../../../../src/domain/external-evidence.js";
import { getPeerPercentileUnavailableReason, minimumMinutesForPercentileComparison } from "../../../../../src/domain/evidence-comparison.js";

export function formatMetric(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  const formatted = Math.abs(value) < 0.1 ? value.toFixed(4) : value.toFixed(2);
  return formatted.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, ".00");
}

export function peerComparisonLabel(evidence: CapabilityEvidence | undefined): string {
  if (!evidence) return "无数据";
  if (evidence.basis === "ability_profile") return "职责属性评估";
  const unavailableReason = getPeerPercentileUnavailableReason({
    minutes: evidence.minutes,
    recordedReason: evidence.peerPercentileUnavailableReason,
  });
  if (unavailableReason === "candidate_sample_unknown") return "指标样本分钟未知，未显示百分位";
  if (unavailableReason === "candidate_low_sample") {
    return evidence.minutes === null
      ? "指标样本分钟未知，未显示百分位"
      : `候选样本 ${Math.round(evidence.minutes)} 分钟，低于 ${minimumMinutesForPercentileComparison} 分钟比较门槛`;
  }
  if (unavailableReason === "insufficient_peer_group") return `达标同组 ${evidence.peerGroupSize} 人，不足 5 人`;
  if (unavailableReason === "competition_scope_unreported") return "来源未提供赛事范围，不做同赛事或候选间比较";
  return evidence.peerPercentile === null
    ? `同组 ${evidence.peerGroupSize} 人，未显示百分位`
    : `同组第 ${evidence.peerPercentile} 百分位 · ${evidence.peerGroupSize} 人`;
}

export function sourceSampleLabel(evidence: CapabilityEvidence): string {
  if (evidence.basis === "ability_profile") return "能力画像";
  if (evidence.sampleMatches === undefined && evidence.sourceScope !== "season_position_aggregate") {
    return evidence.minutes === null ? "样本分钟未知" : "—";
  }
  const parts = [
    evidence.sampleMatches === undefined ? null : `${evidence.sampleMatches} 场`,
    evidence.minutes === null ? "分钟未知" : `${Math.round(evidence.minutes)} 分钟`,
    evidence.sourceScope === "season_position_aggregate" ? "赛季位置汇总，赛事未拆分" : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(" · ") : "样本未知";
}

export function playerEloIdentityText(signal: PlayerEloSignal): string {
  const crosswalk = signal.identityCrosswalk;
  if (signal.identityMatch === "reep_crosswalk" && !crosswalk) {
    return "身份映射出处不完整，无法说明该 PlayerElo 数据对应的来源球员。";
  }
  if (signal.identityMatch === "reep_crosswalk" && crosswalk) {
    const rungDetails = [
      crosswalk.sourceRungs.length ? `来源 rung：${crosswalk.sourceRungs.join("、")}` : null,
      crosswalk.apiFootballRungs.length ? `API-Football rung：${crosswalk.apiFootballRungs.join("、")}` : null,
    ].filter(Boolean).join("；");
    return `经 Reep ${crosswalk.releaseStamp} 桥接：${signal.identitySourceProvider} ID ${signal.identitySourcePlayerId} → ${crosswalk.canonicalId} → API-Football / PlayerElo ID ${signal.providerPlayerId}${rungDetails ? `（${rungDetails}）` : ""}。`;
  }
  return `来源 ${signal.identitySourceProvider} ID ${signal.identitySourcePlayerId} 与 PlayerElo ID ${signal.providerPlayerId} 完全一致。`;
}
