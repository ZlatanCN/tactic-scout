import { type DatasetMode } from "../domain/datasets.js";
import { type Position } from "../domain/position-contracts.js";
import { positionMatches } from "../domain/positions.js";

/** Normalized labels each provider can preserve from its own position fields. */
const sourcePositionLabels: Partial<Record<DatasetMode, readonly Position[]>> = {
  demo: ["CB", "FB", "LB", "RB", "LWB", "RWB", "DM", "CM", "AM", "WG", "LW", "RW", "ST"],
  statsbomb: ["CB", "LB", "RB", "LWB", "RWB", "DM", "CM", "AM", "LW", "RW", "ST"],
  sportmonks: ["CB", "LB", "RB", "LWB", "RWB", "DM", "CM", "AM", "LW", "RW", "ST"],
  skillcorner: ["CB", "FB", "WG", "ST"],
  asa: ["CB", "FB", "DM", "CM", "AM", "WG", "ST"],
  curated: ["CB", "FB", "LB", "RB", "LWB", "RWB", "DM", "CM", "AM", "WG", "LW", "RW", "ST"],
  // mosaic includes Understat's player-position inspection path plus ASA's native groups.
  mosaic: ["CB", "FB", "LB", "RB", "LWB", "RWB", "DM", "CM", "AM", "WG", "LW", "RW", "ST"],
};

/** Whether this mode can produce evidence qualifying the requested role from source-native labels. */
export function canProvideDetailedPositionEvidence(mode: DatasetMode, requested: Position): boolean {
  return sourcePositionLabels[mode]?.some((label) => positionMatches(label, requested)) ?? false;
}
