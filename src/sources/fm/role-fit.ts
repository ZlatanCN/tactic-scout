import type { CapabilityMetricKey } from "../../domain/capabilities.js";
import type { FmAttributeKey, FmPlayerProfile, FmPositionKey } from "./profile.js";

// Explicit, inspectable starting templates. Their relative contribution is evaluated by ablation.
export const FmRoleTemplates = {
  link_forward: { label: "接应做球前锋", positions: ["stc", "amc"], attributes: ["first_touch", "passing", "vision", "decisions", "teamwork", "off_the_ball"], performance: ["understatExpectedAssistsPer90", "understatKeyPassesPer90", "understatXgBuildupPer90"] },
  finisher: { label: "禁区终结者", positions: ["stc"], attributes: ["finishing", "composure", "anticipation", "off_the_ball", "first_touch"], performance: ["understatNonPenaltyExpectedGoalsPer90", "understatShotsPer90", "goals"] },
  wide_forward: { label: "边路攻击手", positions: ["aml", "amr", "ml", "mr"], attributes: ["dribbling", "acceleration", "pace", "technique", "off_the_ball", "finishing"], performance: ["understatNonPenaltyExpectedGoalsPer90", "understatShotsPer90", "asaGoalsAddedDribblingPer90"] },
  playmaker: { label: "组织核心", positions: ["dm", "mc", "amc"], attributes: ["passing", "vision", "decisions", "first_touch", "technique", "teamwork"], performance: ["understatExpectedAssistsPer90", "understatKeyPassesPer90", "understatXgBuildupPer90", "asaGoalsAddedPassingPer90"] },
  ball_carrier: { label: "持球推进者", positions: ["mc", "amc", "aml", "amr"], attributes: ["dribbling", "technique", "acceleration", "balance", "decisions", "first_touch"], performance: ["asaGoalsAddedDribblingPer90", "premierLeagueSuccessfulDribblesPer90"] },
  holding_midfielder: { label: "防守型中场", positions: ["dm", "mc"], attributes: ["positioning", "anticipation", "tackling", "decisions", "teamwork", "work_rate", "stamina"], performance: ["tacklesInterceptions", "asaGoalsAddedInterruptingPer90"] },
  ball_playing_defender: { label: "出球中卫", positions: ["dc", "sw"], attributes: ["positioning", "anticipation", "tackling", "passing", "decisions", "composure", "jumping_reach"], performance: ["tacklesInterceptions", "wyscoutProgressivePassesPer90", "asaGoalsAddedPassingPer90"] },
  overlapping_fullback: { label: "往返边后卫", positions: ["dl", "dr", "wbl", "wbr"], attributes: ["stamina", "work_rate", "acceleration", "crossing", "off_the_ball", "tackling", "positioning"], performance: ["overlapRunsPer30Tip", "understatExpectedAssistsPer90", "tacklesInterceptions"] },
  goalkeeper: { label: "门线型门将", positions: ["gk"], attributes: ["reflexes", "handling", "one_on_ones", "positioning", "aerial_reach", "concentration"], performance: [] },
  sweeper_keeper: { label: "出击出球门将", positions: ["gk"], attributes: ["reflexes", "one_on_ones", "rushing_out", "decisions", "passing", "kicking", "first_touch", "composure"], performance: [] },
} as const satisfies Record<string, { label: string; positions: readonly FmPositionKey[]; attributes: readonly FmAttributeKey[]; performance: readonly CapabilityMetricKey[] }>;

export type FmRoleId = keyof typeof FmRoleTemplates;

export interface FmRoleFit {
  role: FmRoleId;
  label: string;
  positionRating: number | null;
  positionCompatible: boolean;
  fit: number | null;
  attributeCoverage: number;
  // Search priority uses a fixed neutral prior for unknowns, never a renormalized fit claim.
  searchPriority: number;
  attributes: Array<{ key: FmAttributeKey; value: number | null; displayValue: number | null }>;
}

export function assessFmRole(player: FmPlayerProfile, role: FmRoleId): FmRoleFit {
  const definition = FmRoleTemplates[role];
  const positionValues = definition.positions.flatMap((position) => player.positions[position] === null ? [] : [player.positions[position]!]);
  const positionRating = positionValues.length ? Math.max(...positionValues) : null;
  const attributes = definition.attributes.map((key) => {
    const value = player.attributes[key];
    return { key, value: value.raw ?? (value.display === null ? null : value.display * 5), displayValue: value.display };
  });
  const known = attributes.filter((attribute) => attribute.value !== null);
  const attributeCoverage = known.length / attributes.length;
  const searchPriority = attributes.reduce((total, attribute) => total + (attribute.value ?? 50), 0) / attributes.length;
  return {
    role, label: definition.label, positionRating, positionCompatible: positionRating !== null && positionRating >= 15,
    fit: known.length === attributes.length ? searchPriority : null,
    attributeCoverage, searchPriority, attributes,
  };
}

export interface FusionComponent { value: number | null; coverage: number }

/** Fixed source weights prevent missing sources from receiving the other source's weight. */
export function combineRoleEvidence(ability: FusionComponent, performance: FusionComponent, abilityWeight = 0.65): {
  abilityFit: number | null;
  performanceFit: number | null;
  combinedFit: number | null;
  searchPriority: number | null;
  evidenceCoverage: number;
} {
  if (!Number.isFinite(abilityWeight) || abilityWeight < 0 || abilityWeight > 1) throw new Error("Invalid ability weight.");
  for (const component of [ability, performance]) {
    if (!Number.isFinite(component.coverage) || component.coverage < 0 || component.coverage > 1
      || (component.value !== null && (!Number.isFinite(component.value) || component.value < 0 || component.value > 100))) throw new Error("Invalid role evidence component.");
  }
  const evidenceCoverage = abilityWeight * (ability.value === null ? 0 : ability.coverage)
    + (1 - abilityWeight) * (performance.value === null ? 0 : performance.coverage);
  const combinedFit = ability.value !== null && performance.value !== null
    ? abilityWeight * ability.value + (1 - abilityWeight) * performance.value : null;
  return {
    abilityFit: ability.value, performanceFit: performance.value, combinedFit,
    searchPriority: evidenceCoverage === 0 ? null :
      abilityWeight * ((ability.value ?? 50) * ability.coverage + 50 * (1 - ability.coverage))
      + (1 - abilityWeight) * ((performance.value ?? 50) * performance.coverage + 50 * (1 - performance.coverage)),
    evidenceCoverage,
  };
}
