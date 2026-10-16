import { randomUUID } from "node:crypto";
import { selectablePositionsFor } from "../../domain/position-selection.js";
import type { DatasetMode } from "../../domain/schemas.js";
import { type Position } from "../../domain/schemas.js";
import type { PlayerNameResolution } from "../../data/player-name-resolver.js";
import { resolveCandidateSearchIntent } from "../candidate-search-intent.js";
import { type ConversationHistoryEntry } from "../planner-context.js";
import { type ParsedRecruitmentAction } from "../recruitment-actions.js";
import { userMessages } from "./candidate-context.js";
import { type PendingQuestion, type PolicyBlockReasonCode, type RecruitmentAskUserMode } from "./contracts.js";

export const askPolicyDisabledPause: PendingQuestion = {
  question: "本评测组已禁用 Agent 追问。影响候选搜索或能力评估的关键需求仍未解决，因此本轮已安全暂停，未生成候选名单。",
  reason: "此对照组不会猜测用户偏好、补造答案或擅自扩大筛选条件；补充需求后应重新开始调查。",
};

export function questionForAskPolicy(
  action: Extract<ParsedRecruitmentAction, { action: "ask_user" }>,
  mode: RecruitmentAskUserMode,
): PendingQuestion {
  if (mode === "disabled") return askPolicyDisabledPause;
  const selection = action.positionSelection;
  return {
    question: action.question,
    reason: action.reason,
    ...(selection ? { input: {
      kind: "positions" as const,
      questionId: randomUUID(),
      highlightedPositions: selectablePositionsFor(selection.highlight),
      selectedPositions: selection.current ? selectablePositionsFor(selection.current) : [],
      ...(selection.current ? { allowKeepCurrent: true } : {}),
    } } : {}),
  };
}

export function playerIdentityClarification(resolution: Exclude<PlayerNameResolution, { status: "resolved" }>, rawMention: string) {
  const mention = rawMention.trim() || resolution.mention;
  const reason = resolution.status === "unavailable"
    ? "身份查询服务没有返回结果；服务故障不代表球员不存在。为了避免把相似姓名误认成同一人，需要补充线索或稍后重试。"
    : resolution.status === "unresolved"
      ? "当前别名与实体来源没有提供足够证据确认这个名字；不能仅凭模型记忆或姓名相似度猜测球员。"
    : "身份线索尚未与用户提及建立足够可靠的唯一对应。确认前不会把任何候选当作参考球员，也不会据此排除候选名单中的球员。";
  const question = resolution.status === "unavailable"
    ? `我暂时无法核实“${mention}”指哪位球员。请补充他的外文全名、球队/位置/年代等线索，或稍后重试。`
    : resolution.status === "unresolved"
      ? `我还不能可靠对应“${mention}”。请补充外文全名、球队、位置或大致年代；我不会按相似名字替你猜。`
      : resolution.status === "needs_confirmation"
        ? `“${mention}”可能指 ${resolution.candidates[0]?.preferredName}。请确认这是否是你说的球员。`
        : `“${mention}”对应多个球员。请选择你指的对象，或补充球队、位置或年代。`;
  return {
    question,
    reason,
    ...(resolution.status === "ambiguous" || resolution.status === "needs_confirmation" ? { input: {
      kind: "player_identity" as const,
      questionId: randomUUID(),
      mention,
      candidates: resolution.candidates.slice(0, 5).map(candidate => ({
        entityId: candidate.entityId,
        name: candidate.preferredName,
        ...(candidate.description ? { description: candidate.description } : {}),
        sourceUrl: candidate.sourceUrl,
      })),
    } } : {}),
  };
}

export function actionForAskPolicy(
  action: Extract<ParsedRecruitmentAction, { action: "ask_user" }>,
  mode: RecruitmentAskUserMode,
): Extract<ParsedRecruitmentAction, { action: "ask_user" }> {
  return mode === "disabled"
    ? { ...action, question: askPolicyDisabledPause.question, reason: askPolicyDisabledPause.reason }
    : action;
}

export const positionLabels: Record<Position, string> = {
  GK: "门将", DEF: "后卫（细分位置未知）", CB: "中后卫", FB: "边后卫", LB: "左后卫", RB: "右后卫", LWB: "左翼卫", RWB: "右翼卫",
  MID: "中场（细分位置未知）", DM: "后腰", CM: "中前卫", AM: "前腰", ATT: "前锋（细分位置未知）",
  WG: "边锋", LW: "左边锋", RW: "右边锋", ST: "中锋",
};

const asksAboutUnspecifiedScopePattern = /联赛|赛事|赛季|跨联赛|其他联赛|来自.{0,8}(?:联赛|赛事)|是否接受.{0,8}(?:联赛|赛季)/;

const asksToConfirmReferenceIdentityPattern = /(?:是指|指的是).{0,16}(?:吗|？|\?)|确认.{0,8}(?:身份|名字|是哪位)|哪一位.{0,8}(?:球员|凯恩)/;

const assertsCurrentAffiliationPattern = /(?:目前|现在|当前).{0,24}(?:效力|在|是|属于).{0,18}(?:俱乐部|球队|联赛|球员|英超|英冠|德甲|德乙|西甲|意甲|法甲|荷甲|葡超|苏超|Premier League|Bundesliga|La Liga|Serie A|Ligue 1)|(?<!曾)(?<!曾经)(?<!此前)(?<!过去)(?:效力于|效力在)[\p{L}\p{N}][^，。；\n]{0,18}|(?:在|踢|效力于|效力在)(?:英超|英冠|德甲|德乙|西甲|意甲|法甲|荷甲|葡超|苏超|Premier League|Bundesliga|La Liga|Serie A|Ligue 1)/iu;

export function unsupportedCurrentAffiliationFeedback(action: ParsedRecruitmentAction, history: ConversationHistoryEntry[]): string | null {
  const userFacingText = action.action === "ask_user"
    ? `${action.question}\n${action.reason}`
    : action.action === "finish"
      ? [action.needSummary, ...action.capabilityProfile, ...action.reportObservations.map(({ summary }) => summary)].join("\n")
      : "";
  if (assertsCurrentAffiliationPattern.test(userFacingText)) {
    return action.action === "ask_user"
      ? "现有工具没有可用的球员现役俱乐部或联赛核验来源；不得在追问中断言这些信息。删除该断言，并按用户已提供的角色继续调查。"
      : "当前报告文本不能从模型记忆断言球员现役俱乐部或联赛；现有比赛数据不支持这类说法。删除需求摘要、能力画像或观察摘要中的该断言后重新完成报告。";
  }
  if (action.action !== "ask_user") return null;
  const messages = userMessages(history);
  const userText = messages.join("\n");
  const questionText = `${action.question}\n${action.reason}`;
  if (asksAboutUnspecifiedScopePattern.test(questionText)
    && !resolveCandidateSearchIntent({ userMessages: messages, confirmedPosition: null }).competitionMentioned) {
    return "用户没有指定联赛、赛事或赛季；不能询问是否接受跨联赛，也不能把目标球队或参考球员当成联赛限制。继续用 competition=null、season=null 搜索当前数据覆盖中的候选人。";
  }
  if (asksToConfirmReferenceIdentityPattern.test(questionText)
    && /替代者|替补|接班|前锋|中锋|后卫|中场/.test(userText)) {
    return "用户已说明替代目标及所需位置/角色；不要要求确认参考球员身份。将名字只作为参考画像，按用户已经给出的角色继续调查。";
  }
  return null;
}

export function asksToRepeatPositionBroadeningQuestion(action: ParsedRecruitmentAction): boolean {
  if (action.action !== "ask_user") return false;
  const text = `${action.question} ${action.reason}`;
  const asksPermission = /(?:你希望|是否|要不要|请确认|愿意|可以.{0,12}吗|would you|should we|do you want|please confirm)/i.test(text);
  const asksToBroaden = /(?:扩大|扩展|放宽|其他位置|其他前锋位置|更广.{0,8}范围|broaden|expand|broader|other positions)/i.test(text);
  return asksPermission && asksToBroaden;
}

export function claimsUnavailablePlayerReports(action: ParsedRecruitmentAction): boolean {
  if (action.action !== "ask_user") return false;
  const text = `${action.question} ${action.reason}`;
  const mentionsReports = /(?:球员报告|球探报告|报告|player reports?|scouting reports?)/i.test(text);
  const claimsRetrievedEvidence = /(?:已获取|已检索到|现有|已有).{0,18}(?:球员|球探)?报告|报告中.{0,32}(?:显示|指出|提到|发现|例如|如|样本)|基于.{0,24}(?:球员|球探)?报告|reports?.{0,40}(?:show|say|include|find|such as)/i.test(text);
  return mentionsReports && claimsRetrievedEvidence;
}

export function policyBlockReasonCode(feedback: string): PolicyBlockReasonCode {
  if (feedback.includes("先调查至少一项可用球队或球员数据")) return "question_before_investigation";
  if (feedback.includes("用户没有指定联赛、赛事或赛季")) return "unspecified_competition_scope";
  if (feedback.includes("现有工具没有可用的球员现役俱乐部或联赛核验来源")) return "unverified_current_affiliation";
  if (feedback.includes("用户已说明替代目标及所需位置/角色")) return "reference_player_identity";
  if (feedback.includes("用户已经同意扩大位置范围")) return "repeated_position_broadening";
  if (feedback.includes("球员报告检索结果为零")) return "unavailable_player_report_claim";
  if (feedback.includes("当前这组候选筛选已到最后一页")) return "candidate_search_exhausted";
  return "other";
}

export function replacementPositionClarification(targetTeam: string | null): Extract<ParsedRecruitmentAction, { action: "ask_user" }> {
  return {
    action: "ask_user",
    targetTeam,
    question: "参考球员的位置是什么？在球场上选择，可以多选。",
    positionSelection: { highlight: null },
    reason: "替代者默认延续参考球员的位置；当前资料无法可靠匹配该球员与位置，不能先用混合位置候选代替。",
  };
}

export function redundantReplacementRoleQuestion(
  action: ParsedRecruitmentAction,
  replacementRequest: boolean,
  referencePosition: Position | null,
): string | null {
  if (!replacementRequest || action.action !== "ask_user") return null;
  const text = `${action.question} ${action.reason}`;
  const asksSameOrDifferent = /(?:延续|沿用|保持|继承|同一|相同|same|continue|inherit).{0,30}(?:位置|职责|角色|position|role).{0,36}(?:还是|或|or).{0,36}(?:不同|其他|另一|换|different|other|change)|(?:延续|沿用|保持|继承).{0,24}(?:还是|或|or).{0,24}(?:不同|其他|另一|换|different|other)/i.test(text);
  const asksGenericRole = /(?:什么|哪个|哪种|希望|是否|要不要|承担|延续|考虑).{0,24}(?:位置|职责|角色)|(?:位置|职责|角色).{0,24}(?:怎么|如何|什么|哪个|哪种|是否|还是)/i.test(text);
  if (asksForSpecificMissingReplacementPosition(action, replacementRequest, referencePosition) && !asksSameOrDifferent) return null;
  if (!asksSameOrDifferent && !asksGenericRole) return null;
  return referencePosition
    ? `这是替代者请求，且已从参考球员的资料确认其位置为 ${positionLabels[referencePosition]}。足球引援默认按同位置/主要角色寻找接班人；不要询问是否换位置，直接按该位置搜索。只有用户明确要求不同位置时才改变范围。`
    : "这是替代者请求，默认按参考球员的同位置/主要角色寻找接班人。不要把‘是否延续角色或换位置’当作默认问题；先依据球队名单、参考球员表现资料和可靠的位置知识解析参考角色。若检查后仍无法确认，只问一个具体的身份或位置缺口。";
}

export function asksForSpecificMissingReplacementPosition(
  action: ParsedRecruitmentAction,
  replacementRequest: boolean,
  referencePosition: Position | null,
): boolean {
  if (!replacementRequest || referencePosition !== null || action.action !== "ask_user") return false;
  const text = `${action.question} ${action.reason}`;
  return /(?:参考球员|他|这名球员).{0,18}(?:具体)?位置.{0,12}(?:是什么|是哪|告诉我|确认)|(?:告诉我|补充|确认).{0,12}(?:球员)?位置|which position|what position/i.test(text);
}

export function broadRoleQuestion(targetTeam: string | null, highlight: Position | null = null): Extract<ParsedRecruitmentAction, { action: "ask_user" }> {
  return {
    action: "ask_user",
    targetTeam,
    question: "你想补强哪个场上位置？在球场上选择，可以多选。",
    positionSelection: { highlight },
    reason: "位置会改变候选池和可比较的球员组。我已先检索并评估初步表现样本；你回答后，我会在同一案件按确认的位置继续调查。",
  };
}

export function emptyPositionQuestion(
  targetTeam: string | null,
  position: Position,
  sourceMode?: DatasetMode,
): Extract<ParsedRecruitmentAction, { action: "ask_user" }> {
  const label = positionLabels[position];
  return {
    action: "ask_user",
    targetTeam,
    question: `当前数据源中没有找到符合${label}位置范围的候选样本。你想扩大到其他位置继续找吗？可以在球场上选择，或保留${label}范围并结束本轮。`,
    positionSelection: { highlight: position, current: position },
    reason: sourceMode === "understat"
      ? `Understat 已按${label}对应的大类位置检索，并核实可用的当前赛季细分位置记录；没有得到你的同意前，不会用不符合位置证据的球员替代。`
      : "你确认的位置范围是硬约束；没有得到同意前，我不会用其他位置的球员替代。",
  };
}
