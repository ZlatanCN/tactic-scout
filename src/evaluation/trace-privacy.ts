import type { RecruitmentTraceEvent } from "../recruitment/conversation.js";

/** Removes raw player, club, and search text before a trace leaves the evaluator. */
export function privacySafeTraceEvent(event: RecruitmentTraceEvent): Record<string, unknown> {
  const redactedKeys = ["targetTeam", "teamName", "query", "playerName", "playerNames", "searchedPlayerNames"] as const;
  if (event.phase === "decision") {
    const { targetTeam, ...safeEvent } = event;
    return { ...safeEvent, ...(targetTeam !== undefined ? { targetTeamProvided: Boolean(targetTeam) } : {}) };
  }
  if (event.phase === "review") return event;
  if (event.phase === "model_usage") return { ...event };
  if (event.phase === "brief_usage") return { ...event };
  if (event.phase === "identity_usage") return { ...event };
  if (event.phase === "brief_failure") return { ...event };
  if (event.phase === "tool_reuse") return { ...event };

  const filters = { ...event.filters };
  for (const key of redactedKeys) {
    if (key in filters) {
      const value = filters[key];
      delete filters[key];
      filters[`${key}Provided`] = Array.isArray(value) ? value.length > 0 : Boolean(value);
    }
  }
  return { ...event, filters };
}
