import { createHash } from "node:crypto";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { EvidenceAccessContext } from "../../knowledge/evidence-schemas.js";
import { isLoopbackModelEndpoint } from "../chat-model.js";
import type { State } from "./state.js";

/** Stable across checkpoint resumes; investigation owner is shared while reranker reservations are round-scoped. */
export function knowledgeEvidenceAccessContext(
  config: LangGraphRunnableConfig,
  state: Pick<State, "history" | "ragResearchQueryCount">,
  purpose: EvidenceAccessContext["purpose"],
  options: { phase?: "investigation" | "final_check"; rankingRound?: 1 | 2 } = {},
): EvidenceAccessContext {
  const threadId = typeof config.configurable?.thread_id === "string" ? config.configurable.thread_id : "local-recruitment-thread";
  const userTurn = Math.max(1, state.history.filter((entry) => entry.role === "user").length);
  const turnId = createHash("sha256").update(`knowledge-evidence-turn-v1\n${threadId}\n${userTurn}`).digest("hex");
  const phase = options.phase ?? "investigation";
  const investigationId = turnId;
  const rankingRound = phase === "final_check" ? undefined : options.rankingRound ?? (state.ragResearchQueryCount > 0 ? 2 as const : 1 as const);
  const operationTurnId = phase === "final_check"
    ? createHash("sha256").update(investigationId + "\nfinal_check").digest("hex")
    : rankingRound === undefined
      ? investigationId
    : createHash("sha256").update(investigationId + "\nround:" + rankingRound).digest("hex");
  return {
    turnId: operationTurnId,
    ...(phase === "final_check" ? {} : { investigationId, rankingRound }),
    purpose,
    modelDestination: isLoopbackModelEndpoint(process.env.OPENAI_BASE_URL) ? "local" : "configured_chat_gateway",
  };
}

export interface ExplicitEvidenceSampleScope {
  sampleFrom?: string;
  sampleTo?: string;
  sampleSeasons?: string[];
  scopeUnavailable?: boolean;
}

function shiftIsoDate(value: string, days: number): string | null {
  const date = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthBounds(value: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: match[1] + "-" + match[2] + "-01",
    to: match[1] + "-" + match[2] + "-" + String(lastDay).padStart(2, "0"),
  };
}

function dateMentionIsBirth(text: string, value: string): boolean {
  const index = text.indexOf(value);
  const context = text.slice(Math.max(0, index - 32), Math.min(text.length, index + value.length + 32));
  return /(?:出生|born|date of birth)/iu.test(context);
}

function hasOtherTemporalMention(text: string, matchedPhrase: string): boolean {
  const remaining = text.replace(matchedPhrase, " ");
  return /\b(?:19|20)\d{2}\b|\b(?:before|prior to|until|through|up to|after|since|from|starting|on|as of|by|onward|onwards|later|following)\b|(?:之前|以前|之后|以后|截至|起|以来|最近|最新|近期|未来|今年|去年|明年)/iu.test(remaining);
}

function timeBoundCount(text: string): number {
  const englishBounds = [...text.matchAll(/\b(?:after|since|from|starting|before|prior to|until|through|up to|by|as of)\b/giu)];
  const chineseBounds = [...text.matchAll(/(?:之后|以后|起|以来|以前|之前|截至|不早于|不晚于)/gu)];
  return englishBounds.length + chineseBounds.length;
}

function hasMultipleTimeBounds(text: string): boolean {
  return timeBoundCount(text) > 1;
}

function boundedRangeRelationsAllowed(
  text: string,
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  const boundaries = [
    ...[...text.matchAll(/\b(from|starting|since|after|before|prior to|until|through|up to|by|as of|onward|onwards|later|following)\b/giu)]
      .map((match) => ({ value: match[1]!.toLocaleLowerCase(), start: match.index ?? 0, end: (match.index ?? 0) + match[0].length })),
    ...[...text.matchAll(/(?:从|自|之后|以后|起|以来|以前|之前|截至|不早于|不晚于)/gu)]
      .map((match) => ({ value: match[0], start: match.index ?? 0, end: (match.index ?? 0) + match[0].length })),
  ];
  let startBounds = 0;
  let endBounds = 0;
  for (const boundary of boundaries) {
    if (boundary.end <= leftStart) {
      if (!["from", "starting", "since", "从", "自"].includes(boundary.value)) return false;
      startBounds += 1;
      continue;
    }
    if (boundary.start >= leftEnd && boundary.end <= rightStart) {
      if (!["through", "until", "之后", "以后", "起", "以来"].includes(boundary.value)) return false;
      endBounds += 1;
      continue;
    }
    if (boundary.start >= rightEnd) return false;
    return false;
  }
  return startBounds <= 1 && endBounds <= 1;
}

function yearMentionCount(text: string): number {
  return [...text.matchAll(/\b(?:19|20)\d{2}\b/gu)].length;
}

/** Compile only an explicitly stated user date/season constraint into pre-retrieval filters. */
export function explicitEvidenceSampleScope(text: string): ExplicitEvidenceSampleScope {
  const dateRange = /(\d{4}-\d{2}-\d{2})\s*(?:to|through|until|至|到|–|—|-)\s*(\d{4}-\d{2}-\d{2})/i.exec(text);
  if (dateRange) {
    const from = dateRange[1]!;
    const to = dateRange[2]!;
    const dateMentionCount = [...text.matchAll(/\d{4}-\d{2}-\d{2}/gu)].length;
    const leftStart = dateRange.index ?? 0;
    const leftEnd = leftStart + from.length;
    const rightStart = leftStart + dateRange[0].lastIndexOf(to);
    const rightEnd = rightStart + to.length;
    return dateMentionCount === 2 && timeBoundCount(text) <= 2
      && boundedRangeRelationsAllowed(text, leftStart, leftEnd, rightStart, rightEnd)
      && shiftIsoDate(from, 0) && shiftIsoDate(to, 0) && from <= to
      ? { sampleFrom: from, sampleTo: to }
      : { scopeUnavailable: true };
  }
  const dateBoundary = /\b(before|prior to|until|through|up to|after|since|from|starting|on|as of|by)\s+(\d{4}-\d{2}-\d{2})\b|(\d{4}-\d{2}-\d{2})\s*(之前|以前|之后|以后|截至|起|以来)/iu.exec(text);
  if (dateBoundary && !dateMentionIsBirth(text, dateBoundary[2] ?? dateBoundary[3]!)) {
    const relation = dateBoundary[1]?.toLocaleLowerCase();
    const date = dateBoundary[2] ?? dateBoundary[3]!;
    if (hasOtherTemporalMention(text, dateBoundary[0]) || hasMultipleTimeBounds(text)) return { scopeUnavailable: true };
    if (!shiftIsoDate(date, 0)) return { scopeUnavailable: true };
    if (relation === "before" || relation === "prior to" || dateBoundary[4] === "之前" || dateBoundary[4] === "以前") {
      const sampleTo = shiftIsoDate(date, -1);
      return sampleTo ? { sampleTo } : { scopeUnavailable: true };
    }
    if (relation === "after" || dateBoundary[4] === "之后" || dateBoundary[4] === "以后") {
      const sampleFrom = shiftIsoDate(date, 1);
      return sampleFrom ? { sampleFrom } : { scopeUnavailable: true };
    }
    if (relation === "since" || relation === "from" || relation === "starting" || relation === "on"
      || dateBoundary[4] === "起" || dateBoundary[4] === "以来") return { sampleFrom: date };
    return { sampleTo: date };
  }
  const prefixedChineseDate = /(?:截至|到|至|不晚于)\s*(\d{4}-\d{2}-\d{2})\b/u.exec(text);
  if (prefixedChineseDate && !dateMentionIsBirth(text, prefixedChineseDate[1]!)) {
    const sampleTo = prefixedChineseDate[1]!;
    if (hasOtherTemporalMention(text, prefixedChineseDate[0]) || hasMultipleTimeBounds(text)) return { scopeUnavailable: true };
    return shiftIsoDate(sampleTo, 0) ? { sampleTo } : { scopeUnavailable: true };
  }
  const exactIsoDate = /\b(\d{4}-\d{2}-\d{2})\b/u.exec(text);
  if (exactIsoDate && !dateMentionIsBirth(text, exactIsoDate[1]!)) {
    const date = exactIsoDate[1]!;
    if (hasOtherTemporalMention(text, date) || hasMultipleTimeBounds(text)) return { scopeUnavailable: true };
    return shiftIsoDate(date, 0) ? { sampleFrom: date, sampleTo: date } : { scopeUnavailable: true };
  }
  const monthRange = /(\d{4}-\d{2})\s*(?:to|through|until|至|到|–|—|-)\s*(\d{4}-\d{2})/iu.exec(text);
  if (monthRange) {
    const from = monthBounds(monthRange[1]!);
    const to = monthBounds(monthRange[2]!);
    const monthMentionCount = [...text.matchAll(/\b\d{4}-\d{2}\b(?!-\d{2})/gu)].length;
    const leftStart = monthRange.index ?? 0;
    const leftEnd = leftStart + monthRange[1]!.length;
    const rightStart = leftStart + monthRange[0].lastIndexOf(monthRange[2]!);
    const rightEnd = rightStart + monthRange[2]!.length;
    if (!from || !to || monthMentionCount !== 2 || timeBoundCount(text) > 2
      || !boundedRangeRelationsAllowed(text, leftStart, leftEnd, rightStart, rightEnd) || from.from > to.to) {
      return { scopeUnavailable: true };
    }
    return { sampleFrom: from.from, sampleTo: to.to };
  }
  const monthBoundary = /\b(before|prior to|until|through|up to|after|since|from|starting|on|as of|by)\s+(\d{4}-\d{2})\b|(\d{4}-\d{2})\s*(之前|以前|之后|以后|截至|起|以来)/iu.exec(text);
  if (monthBoundary && !dateMentionIsBirth(text, monthBoundary[2] ?? monthBoundary[3]!)) {
    const relation = monthBoundary[1]?.toLocaleLowerCase();
    const monthValue = monthBoundary[2] ?? monthBoundary[3]!;
    const month = monthBounds(monthValue);
    if (hasOtherTemporalMention(text, monthBoundary[0]) || hasMultipleTimeBounds(text)) return { scopeUnavailable: true };
    if (month && (relation === "before" || relation === "prior to" || monthBoundary[4] === "之前" || monthBoundary[4] === "以前")) {
      const sampleTo = shiftIsoDate(month.from, -1);
      return sampleTo ? { sampleTo } : { scopeUnavailable: true };
    }
    if (month && (relation === "after" || monthBoundary[4] === "之后" || monthBoundary[4] === "以后")) {
      const sampleFrom = shiftIsoDate(month.to, 1);
      return sampleFrom ? { sampleFrom } : { scopeUnavailable: true };
    }
    if (month && (relation === "since" || relation === "from" || relation === "starting" || relation === "on"
      || monthBoundary[4] === "起" || monthBoundary[4] === "以来")) return { sampleFrom: month.from };
    if (month) return { sampleTo: month.to };
  }
  const prefixedChineseMonth = /(?:截至|到|至|不晚于)\s*(\d{4}-\d{2})\b/u.exec(text);
  if (prefixedChineseMonth && !dateMentionIsBirth(text, prefixedChineseMonth[1]!)) {
    const month = monthBounds(prefixedChineseMonth[1]!);
    if (hasOtherTemporalMention(text, prefixedChineseMonth[0]) || hasMultipleTimeBounds(text)) return { scopeUnavailable: true };
    return month ? { sampleTo: month.to } : { scopeUnavailable: true };
  }
  const exactMonth = /\b(\d{4}-\d{2})\b/u.exec(text);
  if (exactMonth) {
    const bounds = monthBounds(exactMonth[1]!);
    if (bounds && !dateMentionIsBirth(text, exactMonth[1]!)) {
      return hasOtherTemporalMention(text, exactMonth[1]!) || hasMultipleTimeBounds(text)
        ? { scopeUnavailable: true }
        : { sampleFrom: bounds.from, sampleTo: bounds.to };
    }
  }
  if (/(?:current|last|latest|recent|next|upcoming)\s+season|(?:current|last|next|this|upcoming)\s+calendar\s+year|(?:next|upcoming)\s+(?:\d+\s+)?years?|this year|last year|\blast\s+\d+\s+seasons?\b|(?:本赛季|上赛季|下赛季|下一个赛季|最近|最新|近期|未来|今年|去年|明年|过去\s*\d+\s*(?:年|季|赛季))/iu.test(text)) {
    return { scopeUnavailable: true };
  }
  const seasonMatches = [...text.matchAll(/\b((?:19|20)\d{2})\s*(\/|–|—|-)\s*((?:(?:19|20)\d{2})|\d{2})\s*(赛季|season)?/giu)]
    .filter((match) => {
      const index = match.index ?? 0;
      const surroundingText = text.slice(Math.max(0, index - 32), Math.min(text.length, index + match[0].length + 32));
      if (/(?:calendar\s+years?|natural\s+years?|自然年|公历年)/iu.test(surroundingText)) return false;
      if (match[4]) return true;
      const seasonEndYear = match[3]!.length === 2
        ? Number(match[1]!.slice(0, 2) + match[3])
        : Number(match[3]);
      return seasonEndYear === Number(match[1]) + 1;
    });
  const seasons: Array<{ value: string; startYear: number; start: number; end: number }> = [];
  for (let seasonIndex = 0; seasonIndex < seasonMatches.length; seasonIndex += 1) {
    const seasonMatch = seasonMatches[seasonIndex]!;
    const start = seasonMatch[1]!;
    const end = seasonMatch[3]!;
    const matchIndex = seasonMatch.index ?? 0;
    const prefix = text.slice(Math.max(0, matchIndex - 40), matchIndex);
    const suffix = text.slice(matchIndex + seasonMatch[0].length, matchIndex + seasonMatch[0].length + 32);
    const nextSeason = seasonMatches[seasonIndex + 1];
    const between = nextSeason ? text.slice(matchIndex + seasonMatch[0].length, nextSeason.index ?? 0) : "";
    const hasInclusiveRangeEnd = Boolean(nextSeason && /^\s*(?:to|through|until|至|到|–|—|-)\s*$/iu.test(between));
    const precedingRelation = /\b(after|since|from|starting|following)\s+(?:(?:the\s+)?season\s+|the\s+)?$|(?:自从|自|从)\s*$/iu.exec(prefix);
    const relation = precedingRelation?.[1]?.toLocaleLowerCase();
    const boundedStartRelation = (relation === "from" || relation === "starting" || /(?:自从|自|从)\s*$/u.test(prefix))
      && hasInclusiveRangeEnd;
    if ((precedingRelation && !boundedStartRelation)
      || /^\s*(?:(?:after|onward|onwards|and after|following|later)\b|(?:之后|以后|起|以来))/iu.test(suffix)) {
      return { scopeUnavailable: true };
    }
    const fullEnd = end.length === 2 ? start.slice(0, 2) + end : end;
    seasons.push({
      value: start + "/" + fullEnd.slice(-2),
      startYear: Number(start),
      start: matchIndex,
      end: matchIndex + seasonMatch[0].length,
    });
  }
  if (seasons.length) {
    if (timeBoundCount(text) > 2) return { scopeUnavailable: true };
    const expanded: string[] = [];
    for (let index = 0; index < seasons.length; index += 1) {
      const current = seasons[index]!;
      const next = seasons[index + 1];
      const between = next ? text.slice(current.end, next.start) : "";
      if (next && /^\s*(?:to|through|until|至|到|–|—|-)\s*$/iu.test(between)) {
        const count = next.startYear - current.startYear + 1;
        if (count < 1 || count > 5) return { scopeUnavailable: true };
        for (let year = current.startYear; year <= next.startYear; year += 1) {
          expanded.push(String(year) + "/" + String((year + 1) % 100).padStart(2, "0"));
        }
        index += 1;
      } else {
        expanded.push(current.value);
      }
    }
    return expanded.length <= 5 ? { sampleSeasons: [...new Set(expanded)] } : { scopeUnavailable: true };
  }
  const yearRange = /\b((?:19|20)\d{2})\s*年?\s*(?:to|through|until|and|至|到|–|—|-)\s*((?:19|20)\d{2})\s*年?/iu.exec(text);
  if (yearRange) {
    const leftStart = (yearRange.index ?? 0) + yearRange[0].indexOf(yearRange[1]!);
    const leftEnd = leftStart + yearRange[1]!.length;
    const rightStart = (yearRange.index ?? 0) + yearRange[0].lastIndexOf(yearRange[2]!);
    const rightEnd = rightStart + yearRange[2]!.length;
    if (yearMentionCount(text) !== 2 || timeBoundCount(text) > 2
      || !boundedRangeRelationsAllowed(text, leftStart, leftEnd, rightStart, rightEnd)
      || Number(yearRange[1]) > Number(yearRange[2])) return { scopeUnavailable: true };
    return { sampleFrom: yearRange[1] + "-01-01", sampleTo: yearRange[2] + "-12-31" };
  }
  if (hasMultipleTimeBounds(text)) return { scopeUnavailable: true };
  const afterYear = /\b(after|since|from|starting|onward|onwards)\s*((?:19|20)\d{2})\b|((?:19|20)\d{2})\s*年?\s*(之后|以后|起|以来)|((?:19|20)\d{2})\s+(onward|onwards)\b/iu.exec(text);
  if (afterYear) {
    const year = Number(afterYear[2] ?? afterYear[3] ?? afterYear[5]);
    const inclusive = /^(?:from|since|starting|onward|onwards)$/iu.test(afterYear[1] ?? "")
      || /^(?:起|以来)$/u.test(afterYear[4] ?? "")
      || Boolean(afterYear[6]);
    return { sampleFrom: (inclusive ? year : year + 1) + "-01-01" };
  }
  const beforeYear = /\b(before|prior to|until)\s*((?:19|20)\d{2})\b|((?:19|20)\d{2})\s*年?\s*(以前|之前|截至)/i.exec(text);
  if (beforeYear) {
    const year = Number(beforeYear[2] ?? beforeYear[3]);
    const inclusive = /^until$/i.test(beforeYear[1] ?? "") || /^截至$/u.test(beforeYear[4] ?? "");
    return { sampleTo: (inclusive ? year : year - 1) + "-12-31" };
  }
  const prefixedBeforeYear = /\b(up to|through|until|before|prior to|by|as of|to)\s+((?:19|20)\d{2})\b|(?:截至|到|至|不晚于)\s*((?:19|20)\d{2})\s*年?/iu.exec(text);
  if (prefixedBeforeYear) {
    const year = Number(prefixedBeforeYear[2] ?? prefixedBeforeYear[3]);
    const relation = prefixedBeforeYear[1]?.toLocaleLowerCase();
    const inclusive = /^(?:up to|through|until|by|as of|to)$/iu.test(relation ?? "") || Boolean(prefixedBeforeYear[3]);
    return { sampleTo: (inclusive ? year : year - 1) + "-12-31" };
  }
  const singleYear = /\b(?:in|during|within|for)\s+((?:19|20)\d{2})\b|((?:19|20)\d{2})\s*(?:年(?:度)?|calendar year|year)/giu;
  for (const match of text.matchAll(singleYear)) {
    const year = match[1] ?? match[2]!;
    const matchIndex = match.index ?? 0;
    const yearIndex = match[0].indexOf(year) + matchIndex;
    const nearbyText = text.slice(Math.max(0, yearIndex - 24), Math.min(text.length, yearIndex + year.length + 24));
    if (/(?:出生|born|date of birth)/iu.test(nearbyText)) continue;
    return { sampleFrom: year + "-01-01", sampleTo: year + "-12-31" };
  }
  if (/\b(?:between|after|since|from|starting|before|prior to|until)\b.{0,32}\b(?:19|20)\d{2}\b|(?:之后|以后|起|以来|以前|之前|截至|介于).{0,16}(?:19|20)\d{2}/iu.test(text)) {
    return { scopeUnavailable: true };
  }
  const malformedDateOrSeasonRange = /\b(?:19|20)\d{2}\s*(?:\/|–|—|-)\s*\d{2,4}\b/u.exec(text);
  if (malformedDateOrSeasonRange && !dateMentionIsBirth(text, malformedDateOrSeasonRange[0])) return { scopeUnavailable: true };
  return {};
}
