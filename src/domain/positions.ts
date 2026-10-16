import type { PlayerPosition, Position } from "./schemas.js";

const positionFamilies: Partial<Record<Position, readonly Position[]>> = {
  DEF: ["DEF", "CB", "FB", "LB", "RB", "LWB", "RWB"],
  MID: ["MID", "DM", "CM", "AM"],
  ATT: ["ATT", "WG", "LW", "RW", "ST"],
  FB: ["FB", "LB", "RB", "LWB", "RWB"],
  WG: ["WG", "LW", "RW"],
};

const positionFamiliesByBroadGroup: Record<Position, Position> = {
  GK: "GK",
  DEF: "DEF",
  CB: "DEF",
  FB: "DEF",
  LB: "DEF",
  RB: "DEF",
  LWB: "DEF",
  RWB: "DEF",
  MID: "MID",
  DM: "MID",
  CM: "MID",
  AM: "MID",
  ATT: "ATT",
  WG: "ATT",
  LW: "ATT",
  RW: "ATT",
  ST: "ATT",
};

const intermediatePositionGroups: Partial<Record<Position, readonly Position[]>> = {
  LB: ["FB"],
  RB: ["FB"],
  LWB: ["FB"],
  RWB: ["FB"],
  LW: ["WG"],
  RW: ["WG"],
};

export function positionMatches(actual: PlayerPosition, requested: Position): boolean {
  if (actual === "UNKNOWN") return false;
  return actual === requested || positionFamilies[requested]?.includes(actual) === true;
}

export function positionFamilyFor(requested: Position): Position {
  return positionFamiliesByBroadGroup[requested];
}

export function isDetailedPosition(position: Position): boolean {
  return position !== "GK" && position !== "DEF" && position !== "MID" && position !== "ATT";
}

/** Retrieval may use a broad source label to find candidates for a narrower requested role. */
export function positionMatchesRetrieval(
  actual: PlayerPosition,
  requested: Position,
  sourceGroups: readonly Position[] = [],
  catalogGroups: readonly Position[] = [],
  includeUnknown = false,
): boolean {
  const retrievedGroups = new Set([
    positionFamilyFor(requested),
    ...(intermediatePositionGroups[requested] ?? []),
    ...catalogGroups,
  ]);
  return (actual === "UNKNOWN" ? includeUnknown : positionMatches(actual, requested) || retrievedGroups.has(actual))
    || sourceGroups.some((group) => positionMatches(group, requested) || retrievedGroups.has(group));
}

export function hasSpecificPositionEvidence(player: {
  sourceIdentity?: { provider?: string };
  positionEvidence?: { provider: string; targetPosition: Position; status: string };
}, requested: Position): boolean {
  const evidence = player.positionEvidence;
  return Boolean(player.sourceIdentity?.provider === evidence?.provider
    && evidence?.targetPosition === requested
    && (evidence.status === "direct" || evidence.status === "compatible"));
}

/** Position-family profile labels can retrieve a fine-role candidate, but only source evidence can qualify it. */
export function playerPositionMatches(player: {
  position: PlayerPosition;
  sourceIdentity?: {
    provider?: string;
    positionGroups?: Position[];
    positionSamples?: Array<{ position: Position; minutes: number }>;
  };
  positionEvidence?: { provider: string; targetPosition: Position; status: string };
}, requested: Position): boolean {
  if (player.sourceIdentity?.provider === "understat") {
    if (positionFamilyFor(requested) === requested) {
      return positionMatches(player.position, requested)
        || player.sourceIdentity.positionGroups?.some((group) => positionMatches(group, requested)) === true;
    }
    return hasSpecificPositionEvidence(player, requested);
  }
  return positionMatches(player.position, requested)
    || player.sourceIdentity?.positionGroups?.some((position) => positionMatches(position, requested)) === true
    || player.sourceIdentity?.positionSamples?.some(({ position }) => positionMatches(position, requested)) === true;
}
