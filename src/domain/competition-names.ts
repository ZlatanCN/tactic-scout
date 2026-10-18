import { normalizeSearchText } from "./text-matching.js";

const aliases = [
  ["EPL", "Premier League", "English Premier League", "英超", "英格兰超级联赛"],
  ["Bundesliga", "德甲", "德国甲级联赛"],
  ["La_liga", "La Liga", "西甲", "西班牙甲级联赛"],
  ["Serie_A", "Serie A", "意甲", "意大利甲级联赛"],
  ["Ligue_1", "Ligue 1", "法甲", "法国甲级联赛"],
].map(group => group.map(normalizeSearchText));

export function competitionNamesMatch(actual: string, requested: string): boolean {
  const left = normalizeSearchText(actual), right = normalizeSearchText(requested);
  if (!left || !right) return false;
  const known = aliases.find(group => group.includes(right));
  return known ? known.includes(left) : left.includes(right);
}
