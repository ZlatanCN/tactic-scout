import { normalizeSearchText } from "./text-matching.js";

const groups = [
  ["拜仁", "拜仁慕尼黑", "Bayern", "Bayern Munich", "FC Bayern München", "Bayern München"],
  ["巴萨", "巴塞罗那", "Barcelona", "FC Barcelona"],
] as const;

/** Curated exact club aliases; never a player-identity resolver. */
export function teamNamesMatch(left: string, right: string): boolean {
  const a = normalizeSearchText(left), b = normalizeSearchText(right);
  return a === b || groups.some(group => group.some(name => normalizeSearchText(name) === a)
    && group.some(name => normalizeSearchText(name) === b));
}

export function teamNameSearchKey(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const normalized = normalizeSearchText(value);
  const group = groups.find(aliases => aliases.some(name => normalizeSearchText(name) === normalized));
  return normalizeSearchText(group?.[0] ?? value);
}

/** Excludes known target-club players and unverifiable current-squad records. */
export function shouldExcludeForTargetTeam(
  player: { team: string; sourceIdentity?: { provider?: string; isCurrentSeason?: boolean } },
  targetTeam: string | null | undefined,
): boolean {
  if (!targetTeam?.trim()) return false;
  if (player.sourceIdentity?.provider === "fm" && !player.team.trim()) return true;
  if (player.sourceIdentity?.isCurrentSeason !== true) return false;
  if (!player.team.trim() || normalizeSearchText(player.team) === normalizeSearchText("球队未解析")) return true;
  return teamNamesMatch(player.team, targetTeam);
}
