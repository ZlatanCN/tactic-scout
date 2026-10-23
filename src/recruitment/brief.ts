import { RecruitmentBriefSchema, type RecruitmentBrief, type RecruitmentCriterion } from "../domain/recruitment-brief.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import { positionMatches } from "../domain/positions.js";
import { PositionSchema } from "../domain/position-contracts.js";
import { explicitPositionState, resolveCandidateSearchIntent } from "./candidate-search-intent.js";
import { positionFamilyFor } from "../domain/positions.js";
import { FmAttributeKeys } from "../sources/fm/profile.js";
export { RecruitmentBriefSchema, type RecruitmentBrief } from "../domain/recruitment-brief.js";

export interface RecruitmentBriefInterpreter {
  interpret(input: {
    message: string;
    previous: RecruitmentBrief | null;
    recentMessages: readonly string[];
    /** Recent chronological user turns and the assistant clarification questions they answer. */
    recentDialogue?: readonly { role: "user" | "assistant"; content: string; eventId?: string }[];
    /** Full immutable message archive for validating quotes/explicit facts; never sent by default. */
    validationMessages?: readonly string[];
    visibleCandidates?: readonly VisibleRecruitmentCandidate[];
    clarificationQuestion?: string;
    contextRevision?: string;
    protectedQuoteReferences?: readonly { quote: string; eventId: string }[];
    includedHistoryEventIds?: readonly string[];
    omittedHistoryEventIds?: readonly string[];
    currentMessageEventId?: string;
    clarificationQuestionEventId?: string;
    signal?: AbortSignal;
    onModelRetry?: (notice: import("./chat-model.js").ModelRetryNotice) => void;
    /** gatewayAttempts is the count since the preceding usage event for this interpretation. */
    onUsage?: (usage: { outcome?: "response" | "failed"; gatewayAttempts?: number; inputTokens?: number; outputTokens?: number; totalTokens?: number; contextChars?: number; estimatedInputTokens?: number; inputBudgetTokens?: number | null; contextStatus?: "within_budget" | "over_budget" | "unknown"; omittedHistoryEntries?: number; contextManifest?: import("./context.js").RecruitmentContextManifest }) => void;
    onContextCompaction?: (status: "started" | "completed") => void;
  }): Promise<RecruitmentBrief>;
}

export interface VisibleRecruitmentCandidate { playerId: string; name: string; rank: number }

function explicitlySelectsCandidate(quote: string, candidate: VisibleRecruitmentCandidate, candidates: readonly VisibleRecruitmentCandidate[]): boolean {
  const name = normalizeSearchText(candidate.name);
  if (normalizeSearchText(quote).includes(name) && visibleNamesUnique(candidate, candidates)) return true;
  const ordinal = quote.match(/第?\s*(\d+|[一二三四五六七八九十]+)\s*(?:个|位|名)/)?.[1];
  const number = ordinal ? Number(ordinal) || "一二三四五".indexOf(ordinal) + 1 : null;
  if (number !== null) return number === candidate.rank;
  const english = quote.toLowerCase().match(/\b(first|second|third|fourth|fifth|[1-5](?:st|nd|rd|th))\s+(?:one|player|candidate)\b/)?.[1];
  if (english) return (Number.parseInt(english) || ["first", "second", "third", "fourth", "fifth"].indexOf(english) + 1) === candidate.rank;
  return /最后一[个位名]|last (?:one|player|candidate)/i.test(quote) && candidate.rank === Math.max(...candidates.map(item => item.rank));
}

function visibleNamesUnique(candidate: VisibleRecruitmentCandidate, candidates: readonly VisibleRecruitmentCandidate[]): boolean {
  return candidates.filter(item => normalizeSearchText(item.name) === normalizeSearchText(candidate.name)).length === 1;
}

export type RecruitmentBriefValidationCode =
  | "stale_reference_recheck"
  | "quote_not_verbatim"
  | "inferred_hard_constraint"
  | "numeric_filter_mismatch"
  | "invalid_criterion"
  | "invalid_candidate_selection"
  | "reference_name_not_preserved"
  | "position_used_as_reference"
  | "missing_reference_player"
  | "reference_task_mismatch"
  | "invalid_brief";

export class RecruitmentBriefValidationError extends Error {
  override name = "RecruitmentBriefValidationError";

  constructor(message: string, readonly validationCode: RecruitmentBriefValidationCode = "invalid_brief", options?: ErrorOptions) {
    super(message, options);
  }
}

export class RecruitmentBriefOutputLimitError extends Error {
  override name = "RecruitmentBriefOutputLimitError";

  constructor(readonly maxOutputTokens: number, options?: ErrorOptions) {
    super(`需求理解模型在 ${maxOutputTokens} 个输出 token 的预算内未能完成结构化结果。`, options);
  }
}

/** Reject fabricated explicit evidence before it can become a search condition. */
export function validateRecruitmentBrief(
  value: unknown,
  userMessages: readonly string[],
  visibleCandidates: readonly VisibleRecruitmentCandidate[] = [],
  previousBrief?: RecruitmentBrief | null,
): RecruitmentBrief {
  const brief = RecruitmentBriefSchema.parse(value);
  if (brief.referenceRecheck && !userMessages.at(-1)?.includes(brief.referenceRecheck.quote)) throw new RecruitmentBriefValidationError("身份重查必须引用本轮用户的原话，不继承旧轮次的重查要求。", "stale_reference_recheck");
  if (brief.referenceClues) brief.referenceClues = brief.referenceClues.filter(clue => {
    if (!userMessages.some(message => message.includes(clue.quote))) return false;
    if (clue.kind === "position") {
      const parsedPosition = resolveCandidateSearchIntent({ userMessages: [clue.quote], latestMessage: clue.quote, confirmedPosition: null }).position;
      const cluePosition = PositionSchema.safeParse(clue.value);
      if (!parsedPosition || !cluePosition.success || !positionMatches(parsedPosition, cluePosition.data)) return false;
    } else if (!normalizeSearchText(clue.quote).includes(normalizeSearchText(clue.value))) return false;
    if (clue.kind === "team" && normalizeSearchText(clue.value) === normalizeSearchText(brief.targetTeam?.value ?? "")) {
      const explicitPlayerTeamRelation = /(?:效力(?:于|过)?|在.{0,8}踢球|踢球(?:时|期间)|在.{0,8}效力|加盟|转会至)/.test(clue.quote)
        && Boolean(brief.referencePlayer && clue.quote.includes(brief.referencePlayer.value));
      if (!explicitPlayerTeamRelation) return false;
    }
    return true;
  });
  const latestMessage = userMessages.at(-1) ?? "";
  const explicitlyUndecidedPosition = /(?:位置|场上位置|补强位置).{0,12}(?:还没|未|尚未)(?:定|确定|想好|决定)|(?:还没|未|尚未)(?:定|确定|想好|决定).{0,12}(?:位置|场上位置)/u.test(latestMessage);
  if (explicitlyUndecidedPosition
    && !brief.criteria.some(criterion => criterion.field === "position")
    && !brief.unresolved.some(item => item.topic === "position")) {
    brief.unresolved.push({
      topic: "position",
      question: "你想补强哪个场上位置？如果还不确定，也可以先说希望球员承担的职责。",
      impact: "未决定的位置会改变候选范围；我不会把它当成位置不限。",
    });
  }
  const explicitlySelectedCandidate = visibleCandidates.find(candidate => (
    explicitlySelectsCandidate(latestMessage, candidate, visibleCandidates)
  ));
  if (explicitlySelectedCandidate) {
    brief.selectedCandidateId = explicitlySelectedCandidate.playerId;
    brief.referencePlayer = { value: explicitlySelectedCandidate.name, basis: "explicit", quote: latestMessage };
  } else if (brief.selectedCandidateId) {
    const modelSelectedCandidate = visibleCandidates.find(candidate => candidate.playerId === brief.selectedCandidateId);
    brief.selectedCandidateId = null;
    if (modelSelectedCandidate && brief.referencePlayer?.value === modelSelectedCandidate.name && previousBrief) {
      brief.task = previousBrief.task;
      brief.referencePlayer = previousBrief.referencePlayer;
    }
  }
  const selectedCandidate = visibleCandidates.find(candidate => candidate.playerId === brief.selectedCandidateId);
  // Resolve presentation metadata from the actual visible list and current user
  // selection. The model cannot supply a different identity or invent a quote.
  if (selectedCandidate && brief.referencePlayer?.value === selectedCandidate.name
    && explicitlySelectsCandidate(latestMessage, selectedCandidate, visibleCandidates)) {
    brief.referencePlayer = { value: selectedCandidate.name, basis: "explicit", quote: latestMessage };
  }
  const quotes = [brief.targetTeam, brief.referencePlayer].filter(item => item !== null);
  for (const item of quotes) {
    if (item.basis === "explicit" && (!item.quote.trim() || !userMessages.some(message => message.includes(item.quote)))) {
      throw new RecruitmentBriefValidationError(`明确条件 ${JSON.stringify(item.value)} 的 quote=${JSON.stringify(item.quote)} 不是用户连续原文。quote 必须逐字引用 recentMessages/message；候选指代应引用“第三个”等用户原话，候选姓名只放 value。不能编造引文。`, "quote_not_verbatim");
    }
  }
  for (const criterion of brief.criteria) validateCriterionEvidence(criterion, userMessages);
  if (brief.criteria.some(item => item.strength === "required" && item.basis !== "explicit")) {
    throw new RecruitmentBriefValidationError("推断条件不能成为硬性筛选条件。", "inferred_hard_constraint");
  }
  if (brief.selectedCandidateId && (!selectedCandidate || !brief.referencePlayer || brief.referencePlayer.value !== selectedCandidate.name
    || !explicitlySelectsCandidate(latestMessage, selectedCandidate, visibleCandidates))) {
    throw new RecruitmentBriefValidationError("候选指代必须对应上一份可见报告中的具体人选和正确序号；不确定时请澄清。", "invalid_candidate_selection");
  }
  if (brief.referencePlayer && (brief.referencePlayer.basis !== "explicit" || (!selectedCandidate && !brief.referencePlayer.quote.includes(brief.referencePlayer.value)))) {
    throw new RecruitmentBriefValidationError("参考称呼必须保留用户提及，不能用模型猜测的名字替换。", "reference_name_not_preserved");
  }
  if (brief.referencePlayer && /^(?:门将|守门员|后卫|中卫|中后卫|边后卫|左后卫|右后卫|翼卫|中场|后腰|中前卫|前腰|边锋|前锋|中锋|GK|DEF|CB|FB|LB|RB|LWB|RWB|MID|DM|CM|AM|ATT|WG|LW|RW|ST)$/i.test(brief.referencePlayer.value.trim())) {
    throw new RecruitmentBriefValidationError("位置或职责名称不是参考球员；没有提及具体人时应使用 reinforcement，并将 referencePlayer 设为 null。", "position_used_as_reference");
  }
  if (brief.task !== "reinforcement" && brief.referencePlayer === null && brief.unresolved.length === 0) {
    throw new RecruitmentBriefValidationError("参考球员任务需要名称或具体澄清问题。", "missing_reference_player");
  }
  if (brief.task === "reinforcement" && brief.referencePlayer !== null) {
    throw new RecruitmentBriefValidationError("具名参考球员与任务类型矛盾；有相似或替代参照时应选择对应任务，没有参照才是 reinforcement。", "reference_task_mismatch");
  }
  return brief;
}

function validateCriterionEvidence(criterion: RecruitmentCriterion, userMessages: readonly string[]): void {
  if (criterion.basis === "explicit" && (!criterion.quote.trim() || !userMessages.some(message => message.includes(criterion.quote)))) {
    throw new RecruitmentBriefValidationError(`需求条件 ${criterion.field} 的 quote=${JSON.stringify(criterion.quote)} 不是用户连续原文。`, "quote_not_verbatim");
  }
  const numericFields = new Set(["age", "minimumMinutes", "heightCm", "potentialAbility", "currentAbility", "fmAttribute", "budget"]);
  const numericOperators = new Set(["lt", "lte", "gt", "gte", "prefer_high", "prefer_low"]);
  if (numericFields.has(criterion.field) && !numericOperators.has(criterion.operator)) {
    throw new RecruitmentBriefValidationError(`${criterion.field} 需要数值比较符，收到 ${criterion.operator}。`, "numeric_filter_mismatch");
  }
  if (numericOperators.has(criterion.operator) && criterion.value !== null && typeof criterion.value !== "number") {
    throw new RecruitmentBriefValidationError(`${criterion.field} 的比较值必须是数值。`, "numeric_filter_mismatch");
  }
  if (numericFields.has(criterion.field) && ["lt", "lte", "gt", "gte"].includes(criterion.operator)
    && typeof criterion.value !== "number") {
    throw new RecruitmentBriefValidationError(`${criterion.field} 的硬阈值必须有明确数值。`, "numeric_filter_mismatch");
  }
  if (numericFields.has(criterion.field) && typeof criterion.value === "number"
    && !criterionQuoteContainsValue(criterion.quote, criterion.field, criterion.operator, criterion.value)) {
    throw new RecruitmentBriefValidationError(`${criterion.field} 的数值 ${criterion.value} 不在对应原话“${criterion.quote}”中，不能从“年轻一些”等模糊表达补造阈值。`, "numeric_filter_mismatch");
  }
  if (["lt", "lte", "gt", "gte"].includes(criterion.operator)) {
    const quotedOperator = numericComparisonFromQuote(criterion.quote);
    const equivalentIntegerAgeBoundary = criterion.field === "age" && typeof criterion.value === "number"
      && ageBoundaryEquivalent(criterion.quote, criterion.operator, criterion.value);
    if (quotedOperator !== criterion.operator && !equivalentIntegerAgeBoundary) {
      throw new RecruitmentBriefValidationError(`${criterion.field} 的比较符 ${criterion.operator} 与原话“${criterion.quote}”表达的${quotedOperator ?? "比较方向不明确"}不一致。`, "numeric_filter_mismatch");
    }
  }
  if (criterion.field === "fmAttribute" && !criterion.attributeKey) {
    throw new RecruitmentBriefValidationError("FM 属性条件缺少 attributeKey。", "invalid_brief");
  }
  if (criterion.field === "fmAttribute" && !FmAttributeKeys.includes(criterion.attributeKey as typeof FmAttributeKeys[number])) {
    throw new RecruitmentBriefValidationError(`FM 属性 ${criterion.attributeKey} 不在当前字段目录中。`, "invalid_criterion");
  }
  if (criterion.field === "heightCm" && criterion.unit !== "cm") {
    throw new RecruitmentBriefValidationError("身高条件必须统一为 cm。", "invalid_criterion");
  }
  if (["potentialAbility", "currentAbility"].includes(criterion.field) && criterion.unit !== "/200") {
    throw new RecruitmentBriefValidationError("FM CA/PA 条件必须保留 /200 单位。", "invalid_criterion");
  }
  if (["prefer_high", "prefer_low"].includes(criterion.operator)
    && (criterion.strength !== "preferred" || criterion.value !== null)) {
    throw new RecruitmentBriefValidationError("无阈值的高低方向条件必须是 value=null 的 preferred 偏好。", "invalid_criterion");
  }
  if (criterion.field === "position") {
    const values = Array.isArray(criterion.value) ? criterion.value : typeof criterion.value === "string" ? [criterion.value] : [];
    if (criterion.operator === "in" && (!values.length || values.some(value => !PositionSchema.safeParse(value).success))) {
      throw new RecruitmentBriefValidationError("位置条件必须使用有效的位置代码。", "invalid_brief");
    }
    if (criterion.operator === "in") {
      const explicit = explicitPositionState([criterion.quote]).positions;
      const mostSpecific = explicit.filter(position => !explicit.some(other =>
        other !== position && positionFamilyFor(other) === position));
      if (!mostSpecific.length || values.length !== mostSpecific.length || values.some(value => !mostSpecific.includes(value as typeof mostSpecific[number]))) {
        throw new RecruitmentBriefValidationError(`位置条件 ${JSON.stringify(values)} 与原话“${criterion.quote}”表达的位置范围不一致。`, "invalid_criterion");
      }
    }
    if (criterion.operator === "any") {
      if (criterion.value !== null || !explicitPositionState([criterion.quote]).allowsAnyPosition) {
        throw new RecruitmentBriefValidationError("位置不限必须由用户明确表达，不能从未决定位置推断。", "invalid_criterion");
      }
    }
  }
}

function criterionQuoteContainsValue(quote: string, field: RecruitmentCriterion["field"], operator: RecruitmentCriterion["operator"], value: number): boolean {
  const numbers = [...quote.matchAll(/\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千]+/g)]
    .flatMap(match => {
      const raw = match[0]!;
      const parsed = /^\d/.test(raw) ? Number(raw) : chineseInteger(raw);
      return Number.isFinite(parsed) ? [parsed] : [];
    });
  if (field === "heightCm") {
    const metersAndCentimeters = quote.match(/(\d+)\s*(?:米|m)\s*(\d{1,2})(?!\d)/i);
    if (metersAndCentimeters) {
      const centimeters = metersAndCentimeters[2]!.length === 1
        ? Number(metersAndCentimeters[2]) * 10
        : Number(metersAndCentimeters[2]);
      return Number(metersAndCentimeters[1]) * 100 + centimeters === value;
    }
    const metric = quote.match(/(\d+(?:\.\d+)?)\s*(厘米|公分|cm|米|m)/i);
    if (metric) {
      const parsed = Number(metric[1]) * (/^(?:米|m)$/i.test(metric[2]!) ? 100 : 1);
      return Math.abs(parsed - value) < 0.01;
    }
    const chineseMeter = quote.match(/([一二两三四五六七八九十])米([一二三四五六七八九]?)/);
    if (chineseMeter) {
      const meters = chineseInteger(chineseMeter[1]!);
      const centimeters = chineseMeter[2] ? chineseInteger(chineseMeter[2]!) * 10 : 0;
      return Math.abs(meters * 100 + centimeters - value) < 0.01;
    }
  }
  if (numbers.some(number => Math.abs(number - value) < 0.0001)) return true;
  return field === "age" && ageBoundaryEquivalent(quote, operator, value);
}

function ageBoundaryEquivalent(quote: string, operator: RecruitmentCriterion["operator"], value: number): boolean {
  const quotedOperator = numericComparisonFromQuote(quote);
  const quotedAges = [...quote.matchAll(/(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千]+)\s*岁?/g)]
    .map(match => /^\d/.test(match[1]!) ? Number(match[1]) : chineseInteger(match[1]!))
    .filter(Number.isFinite);
  return quotedAges.some(age => (quotedOperator === "lte" && operator === "lt" && value === age + 1)
    || (quotedOperator === "lt" && operator === "lte" && value === age - 1));
}

function numericComparisonFromQuote(quote: string): "lt" | "lte" | "gt" | "gte" | null {
  if (/(?:至少|不少于|不低于|及以上|以上|(?:>=|≥)|at least|no less than|or more|and up|or taller|or higher|\d\s*cm\s*\+)/i.test(quote)) return "gte";
  if (/(?:不超过|至多|最多|不大于|不高于|及以下|以下|以内|(?:<=|≤)|at most|no more than|up to)/i.test(quote)) return "lte";
  if (/(?:超过|高于|大于|多于|(?:>)|over|more than|greater than|above)/i.test(quote)) return "gt";
  if (/(?:低于|小于|不到|少于|(?:<)|under|below|younger than|less than)/i.test(quote)) return "lt";
  return null;
}

function chineseInteger(text: string): number {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let current = 0;
  for (const character of text) {
    if (Object.hasOwn(digits, character)) current = digits[character]!;
    else if (Object.hasOwn(units, character)) {
      total += (current || (character === "十" ? 1 : 0)) * units[character]!;
      current = 0;
    } else return Number.NaN;
  }
  return total + current;
}
