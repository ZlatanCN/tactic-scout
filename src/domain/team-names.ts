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
