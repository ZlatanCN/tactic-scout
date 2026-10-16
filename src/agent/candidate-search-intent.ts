import { activeReferenceMessages } from "../domain/replacement-reference.js";
import { requestedCapabilityEvidenceAreas } from "../domain/recruitment-capabilities.js";
import { playerPositionMatches, positionMatchesRetrieval } from "../domain/positions.js";
import type { CapabilityMetricKey, PlayerProfile, Position } from "../domain/schemas.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import { understatCatalogPositionGroupsFor } from "../data/understat-position-evidence.js";
import { sourcePlayerIdentityKey } from "../identity/source-player-key.js";

import { replacementTargetNames, replacementTargetMention, isReplacementTarget } from "./replacement-target.js";

export type PositionConstraintChange = { changed: true; position: Position | null } | { changed: false };

export interface CandidateSearchIntent {
  discoveryMetricGroups: CapabilityMetricKey[][];
  position: Position | null;
  positions?: readonly Position[];
  positionBasis: "user" | "reference" | null;
  maxAge: number | null;
  minimumMinutes: number;
  competition: string | null;
  season: string | null;
  allowsAnyPosition: boolean;
  replacementRequest: boolean;
  replacementTargetNames: string[];
  referenceIdentityResolved?: boolean;
  referenceSourceIdentityKeys?: readonly string[];
  declinedPositionBroadening: boolean;
  competitionMentioned: boolean;
  latestPositionChange: PositionConstraintChange;
}

const specificPositionPatterns: Array<{ position: Position; pattern: RegExp }> = [
  { position: "GK", pattern: /门将|守门员|\bGK\b/i },
  { position: "CB", pattern: /中后卫|中卫|\bCB\b/i },
  { position: "FB", pattern: /边后卫|边翼卫|fullback|\bFB\b/i },
  { position: "LB", pattern: /左后卫|\bLB\b/i },
  { position: "RB", pattern: /右后卫|\bRB\b/i },
  { position: "LWB", pattern: /左翼卫|左边翼卫|\bLWB\b/i },
  { position: "RWB", pattern: /右翼卫|右边翼卫|\bRWB\b/i },
  { position: "DM", pattern: /后腰|防守型中场|\bDM\b/i },
  { position: "CM", pattern: /中前卫|\bCM\b/i },
  { position: "AM", pattern: /前腰|攻击型中场|\bAM\b/i },
  { position: "LW", pattern: /左边锋|左翼锋|\bLW\b/i },
  { position: "RW", pattern: /右边锋|右翼锋|\bRW\b/i },
  { position: "WG", pattern: /(?<![左右])边锋|winger|\bWG\b/i },
  { position: "ST", pattern: /中锋|正中锋|九号位|9\s*号位|\bST\b/i },
];

const broadenAttackingPositionsPattern = /(?:扩大|扩展|放宽).{0,10}(?:其他|更多|不同)?(?:前锋|锋线)(?:位置|角色)?|(?:其他|别的)(?:前锋|锋线)(?:位置|角色)?/;
const broadenPositionPattern = /位置不限|不限.{0,8}位置|不限定.{0,8}(?:位置|中锋|中后卫|后腰|中前卫|前腰)|放宽.{0,10}(?:位置|范围|其他位置|任意位置)|(?:扩大|扩展).{0,10}(?:其他|别的|任意)?位置|(?:其他|任何|所有|别的)位置(?:都)?(?:可以|行|继续)?|(?:前锋|后卫|中场)都(?:可以|行)|不必局限.{0,10}(?:位置|中锋|后卫)|改(?:为|成)(?:任何位置)/;
const positionNegationPattern = /(?:不|别|不要|不找|不考虑|排除|而非|不是).{0,4}$/;
const declinePositionBroadeningPattern = /(?:不考虑|不要|不想|不愿|无需|不需要).{0,8}(?:扩大|放宽|其他位置|其他前锋|不同位置)|(?:只|仍然|还是|继续)[^，。；！？\n]{0,8}(?:找|要|限定|保留)?[^，。；！？\n]{0,6}(?:中锋|位置)|(?:保留|坚持).{0,8}(?:中锋|位置)/;
const broadAnyPositionPattern = /位置不限|不限(?:球员)?位置|不限定位置|任何位置都可以|位置都可以/i;
const explicitCompetitionPattern = /(英超|英冠|德甲|德乙|西甲|意甲|法甲|荷甲|葡超|苏超|MLS|Major League Soccer|Premier League|Bundesliga|La Liga|Serie A|Ligue 1)/i;
const constraintRemovalActionPattern = /(?:取消|移除|删除|清除|解除|不再限制|remove|clear|drop)/gi;

function explicitlyRemovesConstraint(message: string, constraintPattern: RegExp): boolean {
  for (const action of message.matchAll(constraintRemovalActionPattern)) {
    const start = action.index ?? 0;
    const prefix = message.slice(Math.max(0, start - 8), start);
    if (/(?:不想|不希望|不打算|不准备|不愿意|不愿|不要|别|不必|不应|无需|禁止|do not|don't want to|don't|not)\s*$/i.test(prefix)) continue;
    if (constraintPattern.test(message.slice(start))) return true;
  }
  return false;
}

function positionConstraintChange(message: string, currentPosition: Position | null): PositionConstraintChange {
  const declinesBroadening = declinePositionBroadeningPattern.test(message);
  const explicitGroup = /(?:按|以|用)(前锋|锋线|中场|后卫)大类/.exec(message);
  if (explicitGroup && !declinesBroadening
    && !/(?:不|不要|不同意|不接受|不愿意|不愿|拒绝)\s*$/.test(message.slice(Math.max(0, explicitGroup.index - 8), explicitGroup.index))) {
    const position: Position = explicitGroup[1] === "中场" ? "MID" : explicitGroup[1] === "后卫" ? "DEF" : "ATT";
    return position === currentPosition ? { changed: false } : { changed: true, position };
  }
  if (currentPosition !== null && broadenAttackingPositionsPattern.test(message) && !declinesBroadening) {
    return currentPosition === "ATT" ? { changed: false } : { changed: true, position: "ATT" };
  }
  if (broadenPositionPattern.test(message) && !declinesBroadening) {
    return currentPosition === null ? { changed: false } : { changed: true, position: null };
  }
  const matches: Array<{ position: Position; index: number }> = [];
  for (const { position, pattern } of specificPositionPatterns) {
    const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
    for (const match of message.matchAll(globalPattern)) {
      const index = match.index ?? 0;
      if (positionNegationPattern.test(message.slice(Math.max(0, index - 7), index))) continue;
      matches.push({ position, index });
    }
  }
  const lastMatch = matches.sort((left, right) => left.index - right.index).at(-1);
  if (!lastMatch && currentPosition !== null) {
    const broadPosition = explicitBroadPositionGroup([message]);
    if (broadPosition && broadPosition !== currentPosition) return { changed: true, position: broadPosition };
  }
  if (!lastMatch || lastMatch.position === currentPosition) return { changed: false };
  return { changed: true, position: lastMatch.position };
}

function explicitBroadPositionGroup(userMessages: readonly string[]): Position | null {
  const patterns: Array<{ position: Position; pattern: RegExp }> = [
    { position: "MID", pattern: /中场|中場|midfield(?:er)?s?/gi },
    { position: "DEF", pattern: /后卫|後衛|后防|defenders?|defence|defense/gi },
    { position: "ATT", pattern: /前锋|前鋒|锋线|鋒線|strikers?|attackers?/gi },
  ];
  let requestedPosition: Position | null = null;
  for (const message of userMessages) {
    if (broadAnyPositionPattern.test(message)) {
      requestedPosition = null;
      continue;
    }
    let hadNegatedPositionMention = false;
    const mentions = patterns.flatMap(({ position, pattern }) => {
      const matcher = new RegExp(pattern.source, pattern.flags);
      return [...message.matchAll(matcher)].flatMap((match) => {
        const index = match.index ?? 0;
        const prefix = message.slice(Math.max(0, index - 8), index);
        if (/(?:不|别|不要|不找|排除|而非|不是|not|(?:不同意|不接受|不愿意|不愿|拒绝)(?:按|以|用))\s*$/i.test(prefix)) {
          hadNegatedPositionMention = true;
          return [];
        }
        return [{ position, index }];
      });
    }).sort((left, right) => left.index - right.index);
    if (mentions.length) requestedPosition = mentions.at(-1)!.position;
    else if (hadNegatedPositionMention) requestedPosition = null;
  }
  return requestedPosition;
}

function explicitMaxAge(userMessages: readonly string[]): number | null {
  const patterns = [
    /(\d{1,2})\s*岁(?:以下|以内|不超过)/,
    /(?:不超过|最多|最大年龄|年龄上限)(?:为|是|[:：])?\s*(\d{1,2})\s*岁?/,
    /年龄.{0,8}(\d{1,2})\s*岁/,
    /\b(?:under|younger than|no older than|max(?:imum)? age)\s*(\d{1,2})\b/i,
  ];
  for (const message of [...userMessages].reverse()) {
    if (explicitlyRemovesConstraint(message, /年龄|age/i)
      || /(?:年龄(?:上限|限制|要求)?|age limit)\s*(?:不限|不限制|不设限|没有限制|不重要|is unrestricted|isn't restricted)|(?:不限|不设限|不限制)(?:任何)?年龄/i.test(message)) {
      return null;
    }
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match?.[1]) return Number(match[1]);
    }
  }
  return null;
}

function explicitCompetition(userMessages: readonly string[]): string | null {
  for (const message of [...userMessages].reverse()) {
    if (explicitlyRemovesConstraint(message, /赛事|联赛|competition|league/i)
      || /(?:赛事|联赛|competition|league)(?:范围|限制|要求)?\s*(?:不限|不限制|不设限|都可以|不重要|is unrestricted|isn't restricted)|(?:不限|不设限|不限制)(?:任何)?(?:赛事|联赛|competition|league)/i.test(message)) {
      return null;
    }
    const mentions = [...message.matchAll(new RegExp(explicitCompetitionPattern.source, "gi"))];
    if (!mentions.length) continue;
    const positiveMentions = mentions.filter((mention) => {
      const index = mention.index ?? 0;
      const prefix = message.slice(Math.max(0, index - 8), index);
      return !/(?:不|别|不要|排除|不限于|非|not)\s*$/i.test(prefix);
    });
    return positiveMentions.length ? positiveMentions.at(-1)![1] ?? null : null;
  }
  return null;
}

function explicitSeason(userMessages: readonly string[]): string | null {
  const patterns = [
    /\b((?:19|20)\d{2}\s*[/-]\s*(?:\d{2}|(?:19|20)\d{2}))\b/i,
    /(?:赛季|season)\s*((?:19|20)\d{2})\b/i,
    /\b((?:19|20)\d{2})\s*(?:赛季|season)\b/i,
  ];
  for (const message of [...userMessages].reverse()) {
    if (explicitlyRemovesConstraint(message, /赛季|season/i)
      || /(?:赛季|season)(?:范围|限制|要求)?\s*(?:不限|不限制|不设限|都可以|不重要|is unrestricted|isn't restricted)|(?:不限|不设限|不限制)(?:任何)?(?:赛季|season)/i.test(message)) {
      return null;
    }
    for (const pattern of patterns) {
      const match = pattern.exec(message);
      if (match?.[1]) {
        if (/(?:不|别|不要|排除|不限于|非)\s*$/.test(message.slice(Math.max(0, match.index - 6), match.index))) return null;
        return match[1].replace(/\s+/g, "");
      }
    }
  }
  return null;
}

function explicitMinimumMinutes(userMessages: readonly string[]): number {
  const patterns = [
    /(?:至少|不少于|不低于|超过|多于|at least|over|more than)\s*(\d{1,4})\s*(?:分钟|min(?:utes?)?)/i,
    /(?:出场|踢|比赛时间)\s*(\d{1,4})\s*(?:分钟)以上/,
  ];
  for (const message of [...userMessages].reverse()) {
    if (explicitlyRemovesConstraint(message, /分钟|出场时间|minutes?|playing time/i)
      || /(?:分钟|出场时间|playing time|minutes?)(?:门槛|限制|要求)?\s*(?:不限|不限制|不设限|没有限制|不重要|is unrestricted|isn't restricted)|(?:不限|不设限|不限制)(?:最低)?(?:出场)?(?:分钟|出场时间|playing time|minutes?)/i.test(message)) {
      return 0;
    }
    for (const pattern of patterns) {
      const match = pattern.exec(message);
      if (match?.[1]) return Number(match[1]);
    }
  }
  return 0;
}

export function resolveCandidateSearchIntent(input: {
  userMessages: readonly string[];
  confirmedPosition: Position | null;
  confirmedPositions?: readonly Position[];
  replacementReferencePosition?: Position | null;
  referenceNames?: readonly string[];
  referenceIdentityResolved?: boolean;
  referenceSourceIdentityKeys?: readonly string[];
  latestMessage?: string;
}): CandidateSearchIntent {
  const { userMessages, confirmedPosition, replacementReferencePosition = null, latestMessage } = input;
  const originalRequest = userMessages[0] ?? "";
  const replacementRequest = Boolean(replacementTargetMention(userMessages)) || /替代者|替代|接班人|接班|替补|replacement|successor|backup/i.test(originalRequest);
  const currentPosition = confirmedPosition ?? (replacementRequest ? replacementReferencePosition : null);
  const latestPositionChange = latestMessage === undefined
    ? { changed: false } as const
    : positionConstraintChange(latestMessage, currentPosition);
  const effectiveConfirmedPosition = latestPositionChange.changed ? latestPositionChange.position : confirmedPosition;
  const positionMessages = activeReferenceMessages(userMessages);
  const explicitPosition = explicitBroadPositionGroup(positionMessages);
  const allowsAnyPosition = positionMessages.some((message) => broadAnyPositionPattern.test(message)
    || (broadenPositionPattern.test(message) && !broadenAttackingPositionsPattern.test(message)
      && !declinePositionBroadeningPattern.test(message)));
  const selectedPositions = latestPositionChange.changed ? [] : input.confirmedPositions ?? [];
  const position = selectedPositions.length ? selectedPositions[0]! : allowsAnyPosition ? null : effectiveConfirmedPosition ?? explicitPosition
    ?? (replacementRequest ? replacementReferencePosition : null);
  return {
    position,
    ...(selectedPositions.length ? { positions: selectedPositions } : {}),
    discoveryMetricGroups: requestedCapabilityEvidenceAreas(userMessages).filter(area => area.metricKeys.length > 0).map(area => [...area.metricKeys]),
    positionBasis: position === null ? null : effectiveConfirmedPosition !== null || explicitPosition !== null ? "user" : "reference",
    maxAge: explicitMaxAge(userMessages),
    minimumMinutes: explicitMinimumMinutes(userMessages),
    competition: explicitCompetition(userMessages),
    season: explicitSeason(userMessages),
    allowsAnyPosition,
    replacementRequest,
    replacementTargetNames: [...new Set([...replacementTargetNames(userMessages), ...(input.referenceNames ?? []).map(normalizeSearchText)])],
    ...(input.referenceIdentityResolved ? { referenceIdentityResolved: true, referenceSourceIdentityKeys: input.referenceSourceIdentityKeys ?? [] } : {}),
    declinedPositionBroadening: userMessages.some((message) => declinePositionBroadeningPattern.test(message)),
    competitionMentioned: userMessages.some((message) => explicitCompetitionPattern.test(message)),
    latestPositionChange,
  };
}

function matchesNonPositionIntent(player: PlayerProfile, intent: CandidateSearchIntent): boolean {
  if (intent.referenceIdentityResolved
    ? intent.referenceSourceIdentityKeys?.includes(sourcePlayerIdentityKey(player))
    : isReplacementTarget(player.name, intent.replacementTargetNames)) return false;
  if (intent.maxAge !== null && (player.age === null || player.age > intent.maxAge)) return false;
  if (player.minutes < intent.minimumMinutes) return false;
  if (intent.competition && !normalizeSearchText(player.competition).includes(normalizeSearchText(intent.competition))) return false;
  if (intent.season && !normalizeSearchText(player.season).includes(normalizeSearchText(intent.season))) return false;
  return true;
}

export function candidateMatchesSearchIntent(player: PlayerProfile, intent: CandidateSearchIntent): boolean {
  if (!matchesNonPositionIntent(player, intent)) return false;
  const positions = intent.positions?.length ? intent.positions : intent.position ? [intent.position] : [];
  if (positions.length && !positions.some((position) => playerPositionMatches(player, position))) return false;
  return true;
}

/** Includes source-family records only for recall and position-evidence investigation. */
export function candidateMatchesSearchIntentForPositionRetrieval(player: PlayerProfile, intent: CandidateSearchIntent): boolean {
  if (!matchesNonPositionIntent(player, intent)) return false;
  const positions = intent.positions?.length ? intent.positions : intent.position ? [intent.position] : [];
  if (!positions.length) return true;
  const isUnderstat = player.sourceIdentity?.provider === "understat";
  return positions.some((position) => positionMatchesRetrieval(
    player.position, position, player.sourceIdentity?.positionGroups,
    isUnderstat ? understatCatalogPositionGroupsFor(position) : [], isUnderstat,
  ));
}
