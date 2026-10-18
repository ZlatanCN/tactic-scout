import { requestedCapabilityEvidenceAreas, summarizeRequestedCapabilityCoverage } from "../conclusion-policy.js";
import { evaluatedPlayersForConstraint, userMessages } from "./candidate-context.js";
import type { State } from "./state.js";

export type RecruitmentRetrievalMode = "fixed" | "on_demand";

/** Retrieval addresses an actual interpretation/evidence gap, never acts as a search admission ticket. */
export function recruitmentRetrievalNeeds(state: State, mode: RecruitmentRetrievalMode) {
  if (mode === "fixed") return { methodology: true, playerReports: true };
  const messages = userMessages(state.history);
  const areas = requestedCapabilityEvidenceAreas(messages, undefined, state.abilityProfilesEnabled);
  const interpretiveGap = areas.length === 0 || areas.some(area => area.metricKeys.length === 0);
  const explicitReports = messages.some(message => /球探报告|比赛录像|定性|scouting report|video/i.test(message));
  const candidates = Object.values(evaluatedPlayersForConstraint(state));
  const missingEvidence = candidates.length > 0 && summarizeRequestedCapabilityCoverage({ userMessages: messages, evaluatedPlayers: candidates, candidateIdentityGroups: state.candidateIdentityGroups })
    .some(area => area.status !== "observed");
  return {
    methodology: interpretiveGap,
    // One bounded qualitative lookup for structural gaps; explicit report requests retain per-batch lookup.
    playerReports: explicitReports || (!state.hasSearchedPlayerReports && missingEvidence),
  };
}
