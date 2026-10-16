import { type PlayerProfile } from "../../domain/players.js";
import { type PlayerPositionEvidence, type Position } from "../../domain/position-contracts.js";
import { isDetailedPosition } from "../../domain/positions.js";
import type { UnderstatPlayerInsight } from "./research.js";

type PositionRelation = "direct" | "compatible";

// This is an application crosswalk for observed Understat lineup labels. It is
// not a claim that a source label proves a player's tactical role or suitability.
const understatPositionMappings: Partial<Record<Position, Readonly<Record<string, PositionRelation>>>> = {
  CB: { DC: "direct" },
  FB: { DL: "direct", DR: "direct" },
  LB: { DL: "direct" },
  RB: { DR: "direct" },
  LWB: { DL: "compatible", DML: "compatible", ML: "compatible" },
  RWB: { DR: "compatible", DMR: "compatible", MR: "compatible" },
  DM: { DML: "direct", DMC: "direct", DMR: "direct" },
  CM: { MC: "direct", ML: "compatible", MR: "compatible" },
  AM: { AMC: "direct", AML: "compatible", AMR: "compatible" },
  WG: { FWL: "direct", FWR: "direct", AML: "compatible", AMR: "compatible" },
  LW: { FWL: "direct", AML: "compatible", ML: "compatible" },
  RW: { FWR: "direct", AMR: "compatible", MR: "compatible" },
  ST: { FW: "direct", FWL: "compatible", FWR: "compatible" },
};

const understatCatalogGroups: Partial<Record<Position, readonly Position[]>> = {
  CB: ["DEF"],
  FB: ["DEF"],
  LB: ["DEF"],
  RB: ["DEF"],
  LWB: ["DEF", "MID"],
  RWB: ["DEF", "MID"],
  DM: ["DEF", "MID"],
  CM: ["DEF", "MID"],
  AM: ["MID", "ATT"],
  WG: ["MID", "ATT"],
  LW: ["MID", "ATT"],
  RW: ["MID", "ATT"],
  ST: ["MID", "ATT"],
};

export function understatCatalogPositionGroupsFor(position: Position): readonly Position[] {
  return understatCatalogGroups[position] ?? [position];
}

export function assessUnderstatPositionEvidence(
  profile: PlayerProfile,
  insight: UnderstatPlayerInsight | undefined,
  targetPosition: Position,
): PlayerPositionEvidence {
  const season = profile.sourceIdentity?.seasonId ?? profile.season.split("/", 1)[0] ?? null;
  const base = {
    provider: "understat",
    targetPosition,
    sourceScope: "season_position_aggregate",
    season,
  } as const;
  if (profile.sourceIdentity?.provider !== "understat"
    || insight?.playerId !== profile.playerId
    || insight.sourcePlayerId !== profile.externalPlayerId
    || !insight.availableSections.includes("positions")) {
    return { ...base, status: "unavailable", sourceCodes: [], sampleMinutes: null };
  }

  const currentSeasonRows = (insight.positions ?? []).filter((row) => row.season === season);
  if (currentSeasonRows.length === 0) {
    return { ...base, status: "unavailable", sourceCodes: [], sampleMinutes: null };
  }

  const targetMappings = understatPositionMappings[targetPosition] ?? {};
  const mappedRows = currentSeasonRows.flatMap((row) => {
    const code = row.code.trim().toUpperCase().replace(/[^A-Z]/g, "");
    const relation = targetMappings[code];
    return relation ? [{ row, code, relation }] : [];
  });
  if (mappedRows.length === 0) {
    return { ...base, status: "not_observed", sourceCodes: currentSeasonRows.map(({ code }) => code), sampleMinutes: null };
  }

  const observedDirectRows = mappedRows.filter(({ relation, row }) => relation === "direct" && row.minutes !== null && row.minutes > 0);
  const observedCompatibleRows = mappedRows.filter(({ relation, row }) => relation === "compatible" && row.minutes !== null && row.minutes > 0);
  const selectedRows = observedDirectRows.length ? observedDirectRows : observedCompatibleRows;
  if (selectedRows.length > 0) {
    const status = observedDirectRows.length ? "direct" : "compatible";
    return {
      ...base,
      status,
      sourceCodes: [...new Set(selectedRows.map(({ row }) => row.code))].sort(),
      sampleMinutes: selectedRows.reduce((sum, { row }) => sum + row.minutes!, 0),
    };
  }

  const sourceCodes = [...new Set(mappedRows.map(({ row }) => row.code))].sort();
  const hasUnknownMinutes = mappedRows.some(({ row }) => row.minutes === null);
  const sampleMinutes = mappedRows.every(({ row }) => row.minutes !== null)
    ? mappedRows.reduce((sum, { row }) => sum + row.minutes!, 0)
    : null;
  return {
    ...base,
    status: hasUnknownMinutes ? "unavailable" : "not_observed",
    sourceCodes,
    sampleMinutes,
  };
}

export function withUnderstatPositionEvidence(
  profile: PlayerProfile,
  insight: UnderstatPlayerInsight | undefined,
  targetPosition: Position,
): PlayerProfile {
  const positionEvidence = assessUnderstatPositionEvidence(profile, insight, targetPosition);
  return {
    ...profile,
    ...(positionEvidence.status === "direct" ? { position: targetPosition } : {}),
    positionEvidence,
    positionEvidenceByPosition: { ...profile.positionEvidenceByPosition, [targetPosition]: positionEvidence },
  };
}

export function withPendingUnderstatPositionEvidence(profile: PlayerProfile, targetPosition: Position): PlayerProfile {
  return {
    ...profile,
    positionEvidence: {
      provider: "understat",
      targetPosition,
      status: "pending",
      sourceScope: "season_position_aggregate",
      season: profile.sourceIdentity?.seasonId ?? profile.season.split("/", 1)[0] ?? null,
      sourceCodes: [],
      sampleMinutes: null,
    },
  };
}

export function isUnderstatFinePositionSearch(position: Position): boolean {
  return isDetailedPosition(position);
}

export function understatPositionSourceCodesFor(position: Position): string[] {
  return Object.entries(understatPositionMappings[position] ?? {}).map(([code]) => code).sort();
}

/** One source read can verify every selected role without overwriting another role's evidence. */
export function withUnderstatPositionEvidenceForTargets(profile: PlayerProfile, insight: UnderstatPlayerInsight | undefined, targets: readonly Position[]): PlayerProfile {
  const result = targets.reduce((player, target) => withUnderstatPositionEvidence(player, insight, target), profile);
  const evidence = targets.map((target) => result.positionEvidenceByPosition?.[target]);
  const primary = evidence.find((item) => item?.status === "direct") ?? evidence.find((item) => item?.status === "compatible") ?? evidence[0];
  return { ...result, ...(primary ? { positionEvidence: primary, ...(primary.status === "direct" ? { position: primary.targetPosition } : {}) } : {}) };
}
