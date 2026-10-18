import { type CapabilityMetricKey, type RequestedCapabilityCoverage } from "../domain/capabilities.js";
import { AbilityMetricDefinitions } from "../domain/player-abilities.js";

export interface ConversationHistoryEntry {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
}

/** Embed structured tool results directly instead of escaping JSON inside JSON. */
export function structuredPlannerHistory(history: readonly ConversationHistoryEntry[]) {
  return history.map((entry) => {
    if (entry.role === "user") return entry;
    try {
      const content: unknown = JSON.parse(entry.content);
      if (content !== null && typeof content === "object") return { ...entry, content };
    } catch {
      // Policy notices and incomplete payloads remain verbatim.
    }
    return entry;
  });
}

/**
 * Expansion constraints already carry the current evidence coverage, eligible
 * player IDs, filters, and exact next page offset. Other tool results do not
 * guide this decision. A blocked-question recovery can opt into the latest
 * policy feedback so the Planner understands why its previous question was
 * rejected, without restoring bulky candidate or metric payloads.
 */
export function compactExpansionHistory(
  history: ConversationHistoryEntry[],
  options: { includeLatestPolicyFeedback?: boolean } = {},
): ConversationHistoryEntry[] {
  const latestPolicyFeedbackIndex = options.includeLatestPolicyFeedback
    ? history.reduce((latest, entry, index) => entry.role === "tool" && entry.toolName === "investigation_policy" ? index : latest, -1)
    : -1;
  return history.filter((entry, index) => {
    if (entry.role === "user") return true;
    if (entry.role === "tool") return index === latestPolicyFeedbackIndex;
    if (entry.role !== "assistant") return false;
    try {
      const action = JSON.parse(entry.content) as { action?: unknown };
      return action.action === "ask_user";
    } catch {
      return false;
    }
  });
}

export function compactConclusionHistory(
  history: ConversationHistoryEntry[],
  requestedCapabilityCoverage?: readonly Pick<RequestedCapabilityCoverage, "requestedMetricKeys">[],
  options: { preserveAllMethodology?: boolean } = {},
): ConversationHistoryEntry[] {
  const hasRequestedCapabilities = (requestedCapabilityCoverage?.length ?? 0) > 0;
  const requestedMetricKeys = new Set(requestedCapabilityCoverage?.flatMap(({ requestedMetricKeys: keys }) => keys) ?? []);
  const evaluatedPlayerIds = new Set<string>();
  let hasAbilityEvidence = false;
  for (const entry of history) {
    if (entry.role !== "tool" || entry.toolName !== "evaluate_candidates") continue;
    try {
      const result = JSON.parse(entry.content) as { evaluations?: Array<{ playerId?: unknown; metrics?: Array<{ basis?: unknown }> }> };
      for (const evaluation of result.evaluations ?? []) {
        if (typeof evaluation.playerId === "string") evaluatedPlayerIds.add(evaluation.playerId);
        if (evaluation.metrics?.some((metric) => metric.basis === "ability_profile")) hasAbilityEvidence = true;
      }
    } catch {
      // Ignore malformed internal tool summaries; they do not affect candidate eligibility.
    }
  }

  const latestToolEntryIndex = (toolName: string) => {
    let latest = -1;
    history.forEach((entry, index) => {
      if (entry.role === "tool" && entry.toolName === toolName) latest = index;
    });
    return latest;
  };
  const conclusionHistory = history.flatMap((entry, index) => {
    if (entry.role === "user") return [entry];
    if (entry.role === "assistant") {
      try {
        const action = JSON.parse(entry.content) as { action?: unknown };
        return action.action === "ask_user" ? [entry] : [];
      } catch {
        return [];
      }
    }
    if (entry.toolName === "search_candidates") {
      try {
        const result = JSON.parse(entry.content) as {
          candidates?: Array<Record<string, unknown>>;
          [key: string]: unknown;
        };
        const candidates = (result.candidates ?? []).flatMap((candidate) => {
          if (typeof candidate.playerId !== "string" || !evaluatedPlayerIds.has(candidate.playerId)) return [];
          return [Object.fromEntries(
            ["playerId", "name", "position", "age", "competition", "season", "minutes"]
              .flatMap((key) => candidate[key] === undefined ? [] : [[key, candidate[key]]]),
          )];
        });
        return [{
          ...entry,
          content: JSON.stringify({
            ...result,
            candidates: hasAbilityEvidence ? [] : candidates,
            discoveredCandidateCount: result.candidates?.length ?? 0,
            note: hasAbilityEvidence ? "候选姓名与指标统一见 evaluate_candidates；此处只保留分页事实。" : "仅列出本页中已评估的候选人；其余候选尚未评估，不可推荐。",
          }),
        }];
      } catch {
        return [{ ...entry, content: "候选搜索页已读取；该页结果无法解析，不能据此增加候选推荐。" }];
      }
    }
    if (entry.toolName === "search_methodology" && !options.preserveAllMethodology
      && index !== latestToolEntryIndex("search_methodology")) return [];
    if (entry.toolName === "inspect_team" && index !== latestToolEntryIndex("inspect_team")) return [];
    if (entry.toolName === "investigation_policy" && index !== latestToolEntryIndex("investigation_policy")) return [];
    if (entry.toolName === "evaluate_candidates") {
      try {
        const result = JSON.parse(entry.content) as {
          evaluations?: Array<Record<string, unknown> & { metrics?: Array<Record<string, unknown>> }>;
          missingPlayerIds?: string[];
          note?: string;
        };
        return [{
          ...entry,
          content: JSON.stringify({
            ...result,
            evaluations: (result.evaluations ?? []).map((evaluation) => {
              const { metrics = [], roleFits, ...player } = evaluation;
              const requestedRoles = new Set(AbilityMetricDefinitions.filter((definition) => requestedMetricKeys.has(definition.key)).map((definition) => definition.role));
              const abilityOnly = metrics.length > 0 && metrics.every((metric) => metric.basis === "ability_profile");
              return {
                ...(abilityOnly ? Object.fromEntries(["playerId", "name", "position", "age", "referenceSimilarity"].filter(key => player[key] !== undefined).map((key) => [key, player[key]])) : player),
                ...(Array.isArray(roleFits) ? { roleFits: roleFits.filter((role) => role.performanceFit !== null && (!hasRequestedCapabilities || requestedRoles.has(role.role))) } : {}),
                metrics: metrics
                  .filter((metric) => !hasRequestedCapabilities || requestedMetricKeys.has(metric.key as CapabilityMetricKey))
                  .map((metric) => metric.basis === "ability_profile"
                    ? Object.fromEntries(["key", "value", "unit", "basis"].map((key) => [key, metric[key]]))
                    : Object.fromEntries(Object.entries(metric).filter(([key, value]) => (
                    !["competition", "season", "minutes"].includes(key)
                    && !(key === "source" && value === player.source)
                  )))),
              };
            }),
            note: `${result.note ?? ""} 同一球员的赛事、赛季和样本分钟在球员字段中统一提供。${hasAbilityEvidence ? " basis=ability_profile 为 /100 职责属性评价，无比赛分钟或百分位；不能改写为实战表现。" : ""}`,
          }),
        }];
      } catch {
        return [{ ...entry, content: "候选比赛表现评估已完成；请依据本轮已验证的能力指标和样本信息完成结论。" }];
      }
    }
    if (["search_methodology", "search_player_reports"].includes(entry.toolName ?? "")) {
      try {
        const result = JSON.parse(entry.content) as { results?: Array<Record<string, unknown>> };
        return [{
          ...entry,
          content: JSON.stringify({
            ...result,
            results: (result.results ?? []).map((document) => ({
              ...document,
              text: typeof document.text === "string" ? document.text.slice(0, 900) : "",
            })),
          }),
        }];
      } catch {
        return [{ ...entry, content: "资料检索完成；请依据已验证的来源元数据和评估证据完成结论。" }];
      }
    }
    return [entry];
  });
  return conclusionHistory;
}
