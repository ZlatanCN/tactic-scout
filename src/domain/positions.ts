import { type PlayerPosition, type Position } from "./position-contracts.js";

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

const broadPositionEligibility: Partial<Record<Position, readonly Position[]>> = {
  DEF: ["CB", "FB", "LB", "RB", "LWB", "RWB"],
  MID: ["DM", "CM", "AM"],
  ATT: ["WG", "LW", "RW", "ST"],
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
  positionEvidenceByPosition?: Partial<Record<Position, { provider: string; targetPosition: Position; status: string }>>;
}, requested: Position): boolean {
  const evidence = player.positionEvidenceByPosition?.[requested] ?? player.positionEvidence;
  return Boolean(player.sourceIdentity?.provider === evidence?.provider
    && evidence?.targetPosition === requested
    && (evidence.status === "direct" || evidence.status === "compatible"));
}

export function hasAbilityPositionEvidence(player: {
  abilityProfile?: { positions: Partial<Record<Position, number>> };
}, requested: Position): boolean {
  const positions = Object.entries(player.abilityProfile?.positions ?? {})
    .filter((entry): entry is [Position, number] => entry[1] !== undefined && entry[1] >= 15)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const primary = positions[0]?.[0];
  if (!primary) return false;
  const broadEligible = broadPositionEligibility[requested];
  // A broad request means "this side of the team" and follows the strongest
  // observed role. A detailed request preserves source-backed versatility.
  return broadEligible ? broadEligible.includes(primary) : positions.some(([position]) => position === requested);
}

/** Position qualification may use verified profile familiarity or observed source position evidence. */
export function playerPositionMatches(player: {
  position: PlayerPosition;
  abilityProfile?: { positions: Partial<Record<Position, number>> };
  sourceIdentity?: {
    provider?: string;
    positionGroups?: Position[];
    positionSamples?: Array<{ position: Position; minutes: number }>;
  };
  positionEvidence?: { provider: string; targetPosition: Position; status: string };
  positionEvidenceByPosition?: Partial<Record<Position, { provider: string; targetPosition: Position; status: string }>>;
}, requested: Position): boolean {
  const hasAbilityProfile = player.abilityProfile?.positions !== undefined;
  if (hasAbilityPositionEvidence(player, requested)) return true;
  if (hasAbilityProfile) return false;
  if (player.sourceIdentity?.provider === "understat") {
    if (positionFamilyFor(requested) === requested) {
      const eligibleGroups = [requested, ...(broadPositionEligibility[requested] ?? [])];
      return (player.position !== "UNKNOWN" && eligibleGroups.includes(player.position))
        || player.sourceIdentity.positionGroups?.some((group) => eligibleGroups.includes(group)) === true;
    }
    return hasSpecificPositionEvidence(player, requested);
  }
  return positionMatches(player.position, requested)
    || player.sourceIdentity?.positionGroups?.some((position) => positionMatches(position, requested)) === true
    || player.sourceIdentity?.positionSamples?.some(({ position }) => positionMatches(position, requested)) === true;
}
