import type { ReferenceSimilarity } from "../domain/reference-similarity.js";
import type { ReferencePlayerProfile } from "./recruitment-comparison.js";
import type { EvaluatedCandidate } from "./recruitment-evidence-evaluator.js";

export function referenceComparisonEvidence(profiles: ReferencePlayerProfile[], enabled: boolean): ReferencePlayerProfile[] {
  return enabled ? profiles : profiles.map(profile => ({ ...profile, metrics: {}, abilityRolePriorities: undefined }));
}

/** Descriptive distance on observed comparable fields, never an ability or confidence score. */
export function compareWithReference(candidate: EvaluatedCandidate, references: readonly ReferencePlayerProfile[]): ReferenceSimilarity | undefined {
  const ability: number[] = [], performance: number[] = [];
  const used = new Set<string>();
  let referenceName: string | undefined;
  for (const reference of references) for (const evidence of candidate.evidence) {
    if (used.has(evidence.key) || evidence.sourceScope === "season_position_aggregate") continue;
    const value = reference.metrics[evidence.key];
    if (value === undefined || !Number.isFinite(value)) continue;
    if (evidence.basis === "ability_profile") {
      if (!reference.abilitySnapshotId || reference.abilitySnapshotId !== candidate.player.abilityProfile?.snapshotId) continue;
      ability.push(Math.min(100, Math.abs(evidence.value - value)));
    } else {
      if (reference.provider !== (candidate.player.sourceIdentity?.provider ?? candidate.player.source)
        || reference.position !== candidate.player.position || reference.competition !== candidate.player.competition
        || reference.season !== candidate.player.season || reference.minutes < 900
        || evidence.minutes === null || evidence.minutes < 900) continue;
      performance.push(Math.abs(evidence.value - value) / Math.max(1, Math.abs(evidence.value), Math.abs(value)) * 100);
    }
    used.add(evidence.key); referenceName = reference.name;
  }
  if (!referenceName) return undefined;
  const summary = (values: number[]) => values.length ? { distance: values.reduce((a, b) => a + b, 0) / values.length, comparedMetrics: values.length } : null;
  return { referenceName, ability: summary(ability), performance: summary(performance) };
}
