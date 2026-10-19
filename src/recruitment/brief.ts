import { RecruitmentBriefSchema, type RecruitmentBrief } from "../domain/recruitment-brief.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import { positionFamilyFor, positionMatches } from "../domain/positions.js";
import { PositionSchema } from "../domain/position-contracts.js";
import { explicitCapabilityPrioritiesFromMessages } from "../domain/recruitment-capabilities.js";
import { explicitPositionState, resolveCandidateSearchIntent } from "./candidate-search-intent.js";
export { RecruitmentBriefSchema, type RecruitmentBrief } from "../domain/recruitment-brief.js";

export interface RecruitmentBriefInterpreter {
  interpret(input: {
    message: string;
    previous: RecruitmentBrief | null;
    recentMessages: readonly string[];
    /** Full immutable message archive for validating quotes/explicit facts; never sent by default. */
    validationMessages?: readonly string[];
    visibleCandidates?: readonly VisibleRecruitmentCandidate[];
    clarificationQuestion?: string;
    signal?: AbortSignal;
    onUsage?: (usage: { outcome?: "response" | "failed"; inputTokens?: number; outputTokens?: number; totalTokens?: number; contextChars?: number; estimatedInputTokens?: number; inputBudgetTokens?: number; contextStatus?: "within_budget" | "over_budget"; omittedHistoryEntries?: number }) => void;
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

function explicitAgeQuote(messages: readonly string[], age: number): string | null {
  const patterns = [
    new RegExp(`${age}\\s*岁\\s*(?:及以下|以下|以内|及以内|不超过|之内)`, "u"),
    new RegExp(`(?:under|below|younger than|at most|no older than)\\s*${age}(?:\\s*(?:years? old)?)?`, "iu"),
  ];
  for (const message of messages) {
    for (const pattern of patterns) {
      const quote = message.match(pattern)?.[0];
      if (quote) return quote;
    }
  }
  return null;
}

export class RecruitmentBriefValidationError extends Error {
  override name = "RecruitmentBriefValidationError";
}

export class RecruitmentBriefOutputLimitError extends Error {
  override name = "RecruitmentBriefOutputLimitError";

  constructor(readonly maxOutputTokens: number, options?: ErrorOptions) {
    super(`需求理解模型在 ${maxOutputTokens} 个输出 token 的预算内未能完成结构化结果。`, options);
  }
}

/** Reject fabricated explicit evidence before it can become a search condition. */
export function validateRecruitmentBrief(value: unknown, userMessages: readonly string[], visibleCandidates: readonly VisibleRecruitmentCandidate[] = []): RecruitmentBrief {
  const brief = RecruitmentBriefSchema.parse(value);
  const representedPriorities = new Set(brief.priorities.map(priority => normalizeSearchText(priority.value)));
  for (const priority of explicitCapabilityPrioritiesFromMessages(userMessages)) {
    const key = normalizeSearchText(priority.value);
    if (representedPriorities.has(key)) continue;
    brief.priorities.push(priority);
    representedPriorities.add(key);
  }
  if (brief.filters.maxAge !== null
    && !brief.constraints.some(item => item.kind === "age" && item.strength === "required" && item.requirement.basis === "explicit")) {
    const quote = explicitAgeQuote(userMessages, brief.filters.maxAge);
    if (quote) brief.constraints.push({
      kind: "age",
      strength: "required",
      requirement: { value: quote, basis: "explicit", quote },
    });
  }
  if (brief.referenceRecheck && !userMessages.at(-1)?.includes(brief.referenceRecheck.quote)) throw new RecruitmentBriefValidationError("身份重查必须引用本轮用户的原话，不继承旧轮次的重查要求。");
  const explicitPositions = explicitPositionState(userMessages);
  brief.positions = explicitPositions.positions;
  brief.allowsAnyPosition = explicitPositions.allowsAnyPosition;
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
  if (brief.allowsAnyPosition) brief.positions = [];
  const latestPosition = [...userMessages].reverse().map(message => resolveCandidateSearchIntent({
    userMessages: [message], latestMessage: message, confirmedPosition: null,
  }).position).find(position => position !== null);
  const latestMessage = userMessages.at(-1) ?? "";
  const selectedCandidate = visibleCandidates.find(candidate => candidate.playerId === brief.selectedCandidateId);
  // Resolve presentation metadata from the actual visible list and current user
  // selection. The model cannot supply a different identity or invent a quote.
  if (selectedCandidate && brief.referencePlayer?.value === selectedCandidate.name
    && explicitlySelectsCandidate(latestMessage, selectedCandidate, visibleCandidates)) {
    brief.referencePlayer = { value: selectedCandidate.name, basis: "explicit", quote: latestMessage };
  }
  if (!brief.referencePlayer && latestPosition === undefined
    && /(?:还?没|未|尚未)(?:想好|确定|决定|定).{0,12}位置|位置.{0,12}(?:还?没|未|尚未)(?:想好|确定|决定|定)|不知道.{0,10}(?:哪个|什么)位置|unsure.{0,12}position|not.{0,8}decided.{0,12}position/i.test(latestMessage)) {
    brief.positions = [];
    brief.allowsAnyPosition = false;
    const positionQuestion: RecruitmentBrief["unresolved"][number] = { topic: "position", question: "你想补强哪些位置？可以在球场上多选。", impact: "位置会决定寻找和比较哪些球员；尚未确定不等于接受所有位置。" };
    brief.unresolved = [positionQuestion, ...brief.unresolved.filter(item => item.topic !== "position")].slice(0, 3);
  }
  if (latestPosition && ["DEF", "MID", "ATT"].includes(latestPosition) && brief.positions.length
    && brief.positions.every(position => positionFamilyFor(position) === latestPosition)) {
    brief.positions = [latestPosition];
  }
  if (!brief.allowsAnyPosition && latestPosition && brief.positions.length === 1
    && brief.positions[0] !== latestPosition && positionMatches(latestPosition, brief.positions[0]!)) {
    throw new RecruitmentBriefValidationError(`用户明确提到细分位置 ${latestPosition}，不能将 positions 放宽为 ${brief.positions[0]}。请保留用户要求的全部细分位置；只有用户明确不限位置时才允许扩大范围。`);
  }
  const quotes = [brief.targetTeam, brief.referencePlayer, ...brief.priorities,
    ...brief.constraints.map(item => item.requirement)].filter(item => item !== null);
  for (const item of quotes) {
    if (item.basis === "explicit" && (!item.quote.trim() || !userMessages.some(message => message.includes(item.quote)))) {
      throw new RecruitmentBriefValidationError(`明确条件 ${JSON.stringify(item.value)} 的 quote=${JSON.stringify(item.quote)} 不是用户连续原文。quote 必须逐字引用 recentMessages/message；候选指代应引用“第三个”等用户原话，候选姓名只放 value。不能编造引文。`);
    }
  }
  if (brief.constraints.some(item => item.strength === "required" && item.requirement.basis !== "explicit")) {
    throw new RecruitmentBriefValidationError("推断偏好不能成为硬性筛选条件。");
  }
  for (const [kind, active] of [["age", brief.filters.maxAge !== null], ["minutes", brief.filters.minimumMinutes > 0],
    ["competition", brief.filters.competition !== null || brief.filters.excludedCompetitions.length > 0], ["season", brief.filters.season !== null]] as const) {
    if (active && !brief.constraints.some(item => item.kind === kind && item.strength === "required" && item.requirement.basis === "explicit")) {
      throw new RecruitmentBriefValidationError(`筛选条件 ${kind} 缺少对应约束。请在 constraints 添加 {kind:"${kind}",strength:"required",requirement:{value:用户条件,basis:"explicit",quote:用户连续原文}}；只可引用真实用户条件，用户未要求时必须清除该 filter。`);
    }
  }
  for (const [kind, value] of [["age", brief.filters.maxAge], ["minutes", brief.filters.minimumMinutes || null]] as const) {
    if (value !== null && !brief.constraints.some(item => item.kind === kind && item.strength === "required"
      && item.requirement.quote.match(/\d+/g)?.some(number => Number(number) === value))) {
      throw new RecruitmentBriefValidationError("数值筛选条件与用户原话不一致。");
    }
  }
  if (brief.selectedCandidateId && (!selectedCandidate || !brief.referencePlayer || brief.referencePlayer.value !== selectedCandidate.name
    || !explicitlySelectsCandidate(brief.referencePlayer.quote, selectedCandidate, visibleCandidates))) {
    throw new RecruitmentBriefValidationError("候选指代必须对应上一份可见报告中的具体人选和正确序号；不确定时请澄清。");
  }
  if (brief.referencePlayer && (brief.referencePlayer.basis !== "explicit" || (!selectedCandidate && !brief.referencePlayer.quote.includes(brief.referencePlayer.value)))) {
    throw new RecruitmentBriefValidationError("参考称呼必须保留用户提及，不能用模型猜测的名字替换。");
  }
  if (brief.referencePlayer && /^(?:门将|守门员|后卫|中卫|中后卫|边后卫|左后卫|右后卫|翼卫|中场|后腰|中前卫|前腰|边锋|前锋|中锋|GK|DEF|CB|FB|LB|RB|LWB|RWB|MID|DM|CM|AM|ATT|WG|LW|RW|ST)$/i.test(brief.referencePlayer.value.trim())) {
    throw new RecruitmentBriefValidationError("位置或职责名称不是参考球员；没有提及具体人时应使用 reinforcement，并将 referencePlayer 设为 null。");
  }
  if (brief.referencePlayer && brief.positions.length && brief.priorities.some(priority => priority.value.length > 3
    && brief.referencePlayer!.value.includes(priority.value) && brief.referencePlayer!.value.includes("的"))) {
    throw new RecruitmentBriefValidationError("referencePlayer 混入了已提取的能力与位置描述。用户没有指定具名人物时，应为 reinforcement，referencePlayer=null，能力留在 priorities。");
  }
  if (brief.task !== "reinforcement" && brief.referencePlayer === null && brief.unresolved.length === 0) {
    throw new RecruitmentBriefValidationError("参考球员任务需要名称或具体澄清问题。");
  }
  if (brief.task === "reinforcement" && brief.referencePlayer !== null) {
    throw new RecruitmentBriefValidationError("具名参考球员与任务类型矛盾；有相似或替代参照时应选择对应任务，没有参照才是 reinforcement。");
  }
  return brief;
}
