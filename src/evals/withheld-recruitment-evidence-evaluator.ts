import type { EvaluatedCandidate, RecruitmentEvidenceEvaluator } from "../agent/recruitment-evidence-evaluator.js";

export function createWithheldRecruitmentEvidenceEvaluator(
  reference: RecruitmentEvidenceEvaluator,
): RecruitmentEvidenceEvaluator {
  return {
    availability: "experimentally_withheld",
    describe: (evidence) => reference.describe(evidence),
    coverage: (candidate) => reference.coverage(candidate),
    async evaluate(eligiblePlayers, requestedIds) {
      const eligibleById = new Map(eligiblePlayers.map((player) => [player.playerId, player]));
      const evaluations: Record<string, EvaluatedCandidate> = {};
      for (const playerId of new Set(requestedIds)) {
        const player = eligibleById.get(playerId);
        if (player) evaluations[playerId] = { player, evidence: [] };
      }
      return { evaluations, observedPlayers: [] };
    },
  };
}
