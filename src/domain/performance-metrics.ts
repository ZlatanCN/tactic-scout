import type {
  Per90,
  PlayerProfile,
  RawStatKey,
  CapabilityMetricKey,
} from "./schemas.js";

/** Shared availability semantics for discovery and the evidence evaluator. */
export function observableMetricValue(player: PlayerProfile, key: CapabilityMetricKey): number | undefined {
  const supplementary = player.supplementaryMetrics?.find(metric => metric.key === key);
  if (supplementary) return supplementary.value ?? undefined;
  if (player.eventDataComplete === false) return undefined;
  const values = toPer90(player);
  return key in values ? (values[key as keyof Per90] ?? undefined) : undefined;
}

function hasStat(player: PlayerProfile, key: RawStatKey): boolean {
  // Older repositories and saved records predate the keyPasses field.
  if (key === "keyPasses" && player.availableStats === undefined) return false;
  return player.availableStats === undefined || player.availableStats.includes(key);
}

function per90(player: PlayerProfile, key: RawStatKey, value: number): number | null {
  if (!hasStat(player, key) || player.minutes <= 0) return null;
  return round(value * 90 / player.minutes);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toPer90(player: PlayerProfile): Per90 {
  const passesAttempted = per90(player, "passesAttempted", player.stats.passesAttempted);
  const hasPassCounts = hasStat(player, "passesAttempted") && hasStat(player, "passesCompleted");
  const passCompletionPct = hasPassCounts && player.stats.passesAttempted > 0
    ? round(player.stats.passesCompleted / player.stats.passesAttempted * 100)
    : null;
  const hasDefensiveCounts = hasStat(player, "tackles") && hasStat(player, "interceptions");
  return {
    goals: per90(player, "goals", player.stats.goals),
    assists: per90(player, "assists", player.stats.assists),
    passesAttempted,
    passCompletionPct,
    longPasses: per90(player, "longPasses", player.stats.longPasses),
    carries: per90(player, "carries", player.stats.carries),
    pressures: per90(player, "pressures", player.stats.pressures),
    tacklesInterceptions: hasDefensiveCounts && player.minutes > 0
      ? round((player.stats.tackles + player.stats.interceptions) * 90 / player.minutes)
      : null,
    shotAssists: per90(player, "shotAssists", player.stats.shotAssists),
    keyPasses: per90(player, "keyPasses", player.stats.keyPasses),
  };
}
