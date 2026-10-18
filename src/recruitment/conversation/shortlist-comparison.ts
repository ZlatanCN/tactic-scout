import { normalizeSearchText } from "../../domain/text-matching.js";
import { requestedCapabilityEvidenceAreas } from "../conclusion-policy.js";
import type { ParsedRecruitmentAction } from "../recruitment-actions.js";
import { evaluatedPlayersForConstraint, resolvedCandidateSearchIntent, userMessages } from "./candidate-context.js";
import type { State } from "./state.js";

const comparisonLanguage = /比较|对比|对照|compare|contrast|comparison/i;
const visibleGroupReference = /(?:这|these|those)(?:(?:些)|(?:两|三|四|五|几|\d+|two|three|four|five))?(?:名|位|个)?(?:候选(?:人)?|球员|人)|(?:现有|当前|上轮|上一轮)(?:的)?(?:候选|球员|名单)|\b(?:all|the|these|those)\s+(?:(?:two|three|four|five|\d+)\s+)?(?:players|candidates|shortlist)\b|\bshortlist\b/i;
const countWords: Readonly<Record<string, number>> = { 两: 2, 三: 3, 四: 4, 五: 5, two: 2, three: 3, four: 4, five: 5 };

function explicitlyComparedCandidates(state: State) {
  const latestMessage = state.userMessage;
  const visible = state.briefCandidates;
  if (!latestMessage || visible.length === 0 || !comparisonLanguage.test(latestMessage)) return [];

  const normalizedMessage = normalizeSearchText(latestMessage);
  const named = visible.filter(({ name }) => normalizedMessage.includes(normalizeSearchText(name)));
  if (named.length >= 2) return named;
  if (!visibleGroupReference.test(latestMessage)) return [];

  const countMatch = latestMessage.match(/(?:这|these|those|all)\s*(两|三|四|五|[2-9]\d*|two|three|four|five)\s*(?:名|位|个)?/i);
  const requestedCount = countMatch ? countWords[countMatch[1]!.toLocaleLowerCase()] ?? Number(countMatch[1]) : null;
  return requestedCount !== null && requestedCount !== visible.length ? [] : visible;
}

/** Rebuild an explicit comparison set from the last report, using only current, eligible direct evidence. */
export function preserveExplicitShortlistComparison(action: ParsedRecruitmentAction, state: State): {
  action: ParsedRecruitmentAction;
  preservedCandidateIds: string[];
  handled: boolean;
} {
  if (action.action !== "finish") return { action, preservedCandidateIds: [], handled: false };
  const requestedCandidates = explicitlyComparedCandidates(state);
  if (requestedCandidates.length < 2) return { action, preservedCandidateIds: [], handled: false };

  const updateSummary = (note: string) => ({
    ...action,
    needSummary: `${action.needSummary.trim()} ${note}`,
  });

  const requestedMetricKeys = new Set(requestedCapabilityEvidenceAreas(
    userMessages(state.history), resolvedCandidateSearchIntent(state).position, state.abilityProfilesEnabled,
  ).flatMap(({ metricKeys }) => metricKeys));
  if (requestedMetricKeys.size === 0) return {
    action: updateSummary(`用户要求比较上轮的 ${requestedCandidates.length} 名候选，但当前调查没有可用于本轮比较的直接指标，因此未生成能力对照。`),
    preservedCandidateIds: [], handled: true,
  };

  const eligible = evaluatedPlayersForConstraint(state);
  const comparisonSet = requestedCandidates.flatMap(({ playerId }) => {
    const candidate = eligible[playerId];
    if (!candidate) return [];
    const evidence = candidate.evidence.filter((item) => requestedMetricKeys.has(item.key));
    if (evidence.length === 0) return [];
    return [{ playerId, position: candidate.player.position, evidence }];
  });
  const excludedByCurrentRequirements = requestedCandidates.filter(({ playerId }) => !eligible[playerId]).length;
  const missingRequestedEvidence = requestedCandidates.filter(({ playerId }) => eligible[playerId]
    && !eligible[playerId]!.evidence.some((item) => requestedMetricKeys.has(item.key))).length;
  if (comparisonSet.length < 2) {
    const reasons = [
      excludedByCurrentRequirements > 0 ? `${excludedByCurrentRequirements} 名不符合本轮当前条件` : "",
      missingRequestedEvidence > 0 ? `${missingRequestedEvidence} 名缺少本轮请求指标的直接证据` : "",
    ].filter(Boolean).join("；");
    return {
      action: updateSummary(`用户要求比较上轮的 ${requestedCandidates.length} 名候选，但当前只有 ${comparisonSet.length} 名具备可核实的比较指标${reasons ? `；${reasons}` : ""}，不足以形成候选间对照。`),
      preservedCandidateIds: [], handled: true,
    };
  }

  const sharedMetricKeys = [...requestedMetricKeys].filter((key) => comparisonSet.every(({ evidence }) => evidence.some((item) => item.key === key)));
  const commonMetric = sharedMetricKeys.length === 1 ? sharedMetricKeys[0]! : null;
  const commonEvidence = commonMetric
    ? comparisonSet.map(({ evidence }) => evidence.find((item) => item.key === commonMetric)!)
    : [];
  const samePosition = comparisonSet.every(({ position }) => position === comparisonSet[0]!.position);
  const comparableScope = samePosition && commonEvidence.length > 1 && commonEvidence.every((item) =>
    item.basis === commonEvidence[0]!.basis
    && item.unit === commonEvidence[0]!.unit
    && item.source === commonEvidence[0]!.source
    && item.competition === commonEvidence[0]!.competition
    && item.season === commonEvidence[0]!.season
    && item.sourceScope === commonEvidence[0]!.sourceScope
    && item.normalization === commonEvidence[0]!.normalization,
  );
  const orderedComparisonSet = comparableScope
    ? [...comparisonSet].sort((left, right) => {
      const leftValue = left.evidence.find((item) => item.key === commonMetric)!.value;
      const rightValue = right.evidence.find((item) => item.key === commonMetric)!.value;
      return rightValue - leftValue || requestedCandidates.findIndex(({ playerId }) => playerId === left.playerId)
        - requestedCandidates.findIndex(({ playerId }) => playerId === right.playerId);
    })
    : comparisonSet;
  const recommendations = orderedComparisonSet.map(({ playerId, evidence }) => ({
    playerId,
    evidenceKeys: [...new Set(evidence.map((item) => item.key))],
  }));
  const sortedMetricLabel = comparableScope ? commonEvidence[0]!.label : null;
  const omitted = [
    excludedByCurrentRequirements > 0 ? `${excludedByCurrentRequirements} 名不符合本轮当前条件` : "",
    missingRequestedEvidence > 0 ? `${missingRequestedEvidence} 名缺少本轮请求指标的直接证据` : "",
  ].filter(Boolean).join("；");
  const note = `本轮保留 ${recommendations.length} 名仍符合当前条件、且有本次比较指标数据的上轮候选${sortedMetricLabel ? `，按${sortedMetricLabel}同口径数值降序展示` : "，按上轮名单顺序展示，不生成统一排序"}；这不是综合能力或转会适配排名${omitted ? `。另有 ${omitted}，未纳入本次比较` : ""}。`;

  return {
    action: {
      ...action,
      recommendations,
      needSummary: `${action.needSummary.trim()} ${note}`,
    },
    preservedCandidateIds: recommendations.map(({ playerId }) => playerId),
    handled: true,
  };
}
