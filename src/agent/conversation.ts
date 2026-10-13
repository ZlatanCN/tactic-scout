import { Annotation, Command, END, getWriter, MemorySaver, START, StateGraph, interrupt, type BaseCheckpointSaver, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod/v4";
import {
  ConversationTurnResponseSchema,
  RecruitmentReportSchema,
  RecruitmentSearchScopeSchema,
  createEmptyExternalSignalCoverage,
  type RecruitmentProgress,
  type RecruitmentProgressEventStatus,
  type DatasetScope,
  type CandidateIdentityResolutionStatus,
  type ExternalSignalCoverage,
  type HistoricalArchiveCoverage,
  type HistoricalArchiveSample,
  type Position,
  type ConversationTurnResponse,
  type PlayerProfile,
  type PlayerEloSignal,
  type RequestedCapabilityCoverage,
  type RecruitmentReport,
} from "../domain/schemas.js";
import type { PlayerRepository, PlayerSearchFilter } from "../data/provider.js";
import { createConfiguredPlayerEloReportClient } from "../data/playerelo-client.js";
import { enrichPlayerEloSignals } from "../data/playerelo-enrichment.js";
import { createConfiguredHistoricalArchive } from "../data/historical-archive-enrichment.js";
import { describeDatasetScope } from "../domain/dataset-scope.js";
import { positionMatches } from "../domain/positions.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import { minimumMinutesForPercentileComparison } from "../domain/evidence-comparison.js";
import { sourcePlayerKey } from "../identity/source-player-key.js";
import {
  groupCandidatesByExactIdentity,
  summarizeCandidateIdentityGroupReferences,
  toCandidateIdentityGroupReferences,
  type CandidateIdentityGroup,
  type CandidateIdentityGroupReference,
} from "../identity/candidate-groups.js";
import { groupCandidatesWithConfiguredReepIndex } from "../identity/configured-candidate-grouper.js";
import { createLocalKnowledgeBase, type KnowledgeRepository } from "../knowledge/index.js";
import type { KnowledgeSearchResult } from "../knowledge/schemas.js";
import { collectMethodologySourceReferences } from "./methodology-sources.js";
import { isLoopbackModelEndpoint } from "./chat-model.js";
import { createRecruitmentEvidenceEvaluator, type EvaluatedCandidate, type RecruitmentEvidenceEvaluator } from "./recruitment-evidence-evaluator.js";
import {
  FinishActionSchema,
  emptyToolUseCounts,
  isToolAction,
  RecruitmentActionSchema,
  toolBudgets,
  type RecruitmentAction,
  type FinishRecruitmentAction,
  type ParsedRecruitmentAction,
  type ToolActionName,
  type ToolUseCounts,
} from "./recruitment-actions.js";
import {
  alignRecommendationEvidenceToRequestedCapabilities,
  buildDecisionConstraints,
  conclusionPlannerOutputFallback,
  expansionPlannerFallback,
  requestedCapabilityEvidenceAreas,
  summarizeRequestedCapabilityCoverage,
  validateConclusion,
  type RecruitmentDecisionConstraints,
  type RecruitmentExpansionConstraints,
} from "./conclusion-policy.js";
import { extractExplicitTargetTeam } from "./target-team-context.js";
import {
  createRecruitmentTurnRuntime,
  recruitmentProgressTransformer,
  type RecruitmentTurnInput,
} from "./conversation-turn-runtime.js";
import {
  createRecruitmentPlanner,
  RecruitmentModelTimeoutError,
  RecruitmentPlannerOutputError,
  RecruitmentModelUnavailableError,
  type RecruitmentPlanner,
  type RecruitmentPlannerResponseDiagnostics,
  type RecruitmentPlannerUsageObservation,
} from "./recruitment-planner.js";
import {
  compactConclusionHistory,
  compactExpansionHistory,
  type ConversationHistoryEntry,
} from "./planner-context.js";
import {
  executeRecruitmentToolAction,
  type RecruitmentToolExecutionRequest,
} from "./recruitment-tool-executor.js";
import { RecruitmentTurnCancelledError } from "./turn-cancellation.js";
import { candidateMatchesSearchIntent, resolveCandidateSearchIntent, type CandidateSearchIntent } from "./candidate-search-intent.js";
import { applyRecruitmentCandidatePolicy } from "./recruitment-candidate-policy.js";

export { type RecruitmentAction } from "./recruitment-actions.js";
export { RecruitmentModelTimeoutError, RecruitmentModelUnavailableError };
export {
  RecruitmentPlannerOutputError,
  conclusionInstructions,
  expansionInstructions,
  reorientationInstructions,
} from "./recruitment-planner.js";
export type { ConversationHistoryEntry, RecruitmentPlanner, RecruitmentPlannerResponseDiagnostics };

export type RecruitmentTraceEvent =
  | ({ phase: "model_usage" } & RecruitmentPlannerUsageObservation)
  | {
      phase: "decision";
      action: string | null;
      decisionSource?: "planner" | "policy";
      proposedAction?: string | null;
      elapsedMs: number;
      ok: boolean;
      policyBlocked?: boolean;
      askPolicyOutcome?: "allowed" | "suppressed";
      policyReasonCodes?: PolicyBlockReasonCode[];
      plannerFallback?: "expansion_timeout" | "expansion_output_limit" | "conclusion_output_limit";
      targetTeam?: string | null;
    }
  | {
      phase: "tool";
      toolName: ToolActionName;
      elapsedMs: number;
      ok: boolean;
      filters: Record<string, string | number | boolean | null | string[]>;
      resultCount: number;
      matchingRecordCount?: number;
    }
  | {
      phase: "review";
      mode: RecruitmentReviewerMode;
      outcome: "passed" | "retry" | "exhausted" | "bypassed";
      elapsedMs: number;
      problemCount?: number;
      repairedEvidenceReferenceCount?: number;
    };

export type RecruitmentReviewerMode = "enabled" | "bypassed";
export type RecruitmentAskUserMode = "enabled" | "disabled";
export type RecruitmentCandidatePolicyMode = "enabled" | "bypassed";

type PolicyBlockReasonCode =
  | "question_before_investigation"
  | "unspecified_competition_scope"
  | "unverified_current_affiliation"
  | "reference_player_identity"
  | "repeated_position_broadening"
  | "unavailable_player_report_claim"
  | "candidate_search_exhausted"
  | "other";

export type RecruitmentTraceObserver = (event: RecruitmentTraceEvent) => void;

export interface RecruitmentConversation {
  turn(input: RecruitmentTurnInput): Promise<ConversationTurnResponse>;
}

type ProgressUpdate = Pick<RecruitmentProgress, "stage" | "message" | "completedSteps"> & { status: RecruitmentProgressEventStatus };
type ProgressUpdateInput = Omit<ProgressUpdate, "status"> & { status?: RecruitmentProgressEventStatus };

type EvaluatedPlayer = EvaluatedCandidate;

function throwIfTurnCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new RecruitmentTurnCancelledError();
  }
}

interface PendingQuestion {
  question: string;
  reason: string;
}

const askPolicyDisabledPause: PendingQuestion = {
  question: "本评测组已禁用 Agent 追问。影响候选搜索或能力评估的关键需求仍未解决，因此本轮已安全暂停，未生成候选名单。",
  reason: "此对照组不会猜测用户偏好、补造答案或擅自扩大筛选条件；补充需求后应重新开始调查。",
};

function questionForAskPolicy(
  action: Extract<ParsedRecruitmentAction, { action: "ask_user" }>,
  mode: RecruitmentAskUserMode,
): PendingQuestion {
  return mode === "disabled" ? askPolicyDisabledPause : { question: action.question, reason: action.reason };
}

function actionForAskPolicy(
  action: Extract<ParsedRecruitmentAction, { action: "ask_user" }>,
  mode: RecruitmentAskUserMode,
): Extract<ParsedRecruitmentAction, { action: "ask_user" }> {
  return mode === "disabled"
    ? { ...action, question: askPolicyDisabledPause.question, reason: askPolicyDisabledPause.reason }
    : action;
}

const positionLabels: Record<Position, string> = {
  GK: "门将", DEF: "后卫（细分位置未知）", CB: "中后卫", FB: "边后卫", LB: "左后卫", RB: "右后卫", LWB: "左翼卫", RWB: "右翼卫",
  MID: "中场（细分位置未知）", DM: "后腰", CM: "中前卫", AM: "前腰", ATT: "前锋（细分位置未知）",
  WG: "边锋", LW: "左边锋", RW: "右边锋", ST: "中锋",
};

const asksAboutUnspecifiedScopePattern = /联赛|赛事|赛季|跨联赛|其他联赛|来自.{0,8}(?:联赛|赛事)|是否接受.{0,8}(?:联赛|赛季)/;
const asksToConfirmReferenceIdentityPattern = /(?:是指|指的是).{0,16}(?:吗|？|\?)|确认.{0,8}(?:身份|名字|是哪位)|哪一位.{0,8}(?:球员|凯恩)/;
const assertsCurrentAffiliationPattern = /(?:目前|现在|当前).{0,24}(?:效力|在|是|属于).{0,18}(?:俱乐部|球队|联赛|球员|英超|英冠|德甲|德乙|西甲|意甲|法甲|荷甲|葡超|苏超|Premier League|Bundesliga|La Liga|Serie A|Ligue 1)|(?<!曾)(?<!曾经)(?<!此前)(?<!过去)(?:效力于|效力在)[\p{L}\p{N}][^，。；\n]{0,18}|(?:在|踢|效力于|效力在)(?:英超|英冠|德甲|德乙|西甲|意甲|法甲|荷甲|葡超|苏超|Premier League|Bundesliga|La Liga|Serie A|Ligue 1)/iu;

function unsupportedCurrentAffiliationFeedback(action: ParsedRecruitmentAction, history: ConversationHistoryEntry[]): string | null {
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

function assertRepositoryModelProcessingAllowed(repository: PlayerRepository): void {
  if (repository.mode === "premier_league") {
    throw new RecruitmentModelUnavailableError(
      "Premier League Pulselive 数据在取得书面批准前不能自动抓取、建库或交给 Agent 处理；请切换到已确认适用的数据源。",
    );
  }
  if (repository.mode === "fpl") {
    throw new RecruitmentModelUnavailableError(
      "FPL 仅保留历史实验和离线测试；官方条款不允许本项目发起新的自动访问与数据提取，因此不能用于招募 Agent。",
    );
  }
  if (repository.mode === "fbref") {
    throw new RecruitmentModelUnavailableError(
      "FBref 数据在取得 Sports Reference 许可前不可交给 Agent 或模型处理；请切换到其他数据源。非商业使用不构成来源许可。",
    );
  }
  if (repository.mode === "understat" || repository.mode === "asa" || repository.mode === "mosaic") {
    if (isLoopbackModelEndpoint(process.env.OPENAI_BASE_URL)) return;
    throw new RecruitmentModelUnavailableError(
      `${repository.sourceName} 的来源处理权限尚未核实，因此只允许交给配置在本机回环地址的模型处理。请将 OPENAI_BASE_URL 配置为本机 Ollama 等回环地址；本机处理限制不代表已获得来源授权。`,
    );
  }
  if (repository.mode !== "statsbomb") return;
  if (process.env.TACTISCOUT_STATSBOMB_AI_PROCESSING_ALLOWED === "true" && isLoopbackModelEndpoint(process.env.OPENAI_BASE_URL)) return;
  throw new RecruitmentModelUnavailableError(
    "StatsBomb 数据仅在审阅使用协议、明确开启本机处理，并将 OPENAI_BASE_URL 配置为本机 Ollama 等回环地址后，才可交给 Agent 处理。",
  );
}

export class RecruitmentCaseStateExpiredError extends Error {
  constructor() {
    super("服务端找不到此案件的内部调查状态。请保留浏览器中已有报告，新建案件并重新发送原始需求；已有浏览器记录不会被覆盖。");
    this.name = "RecruitmentCaseStateExpiredError";
  }
}

const emptyDecision = (targetTeam: string | null): FinishRecruitmentAction => FinishActionSchema.parse({
  action: "finish",
  targetTeam,
  needSummary: "当前案件的目标画像仍需更多调查。",
  capabilityProfile: [],
  recommendations: [],
  limitationKeys: ["other"],
});

function emptyPositionConclusion(targetTeam: string | null, position: Position): FinishRecruitmentAction {
  return FinishActionSchema.parse({
    ...emptyDecision(targetTeam),
    needSummary: `当前数据源没有找到符合用户确认的${positionLabels[position]}位置范围的候选球员。`,
  });
}

const replaceable = <T>(defaultValue: () => T) => Annotation<T>({
  reducer: (_previous, update) => update,
  default: defaultValue,
});

type CandidateSearchAction = Extract<ParsedRecruitmentAction, { action: "search_candidates" }>;

interface CandidateSearchObservation {
  request: CandidateSearchAction;
  appliedFilters: PlayerSearchFilter[];
  actualOffset: number;
  nextOffset: number | null;
  matchingRecordCount: number | null;
  discoveredSourceRecordIds: string[];
  reportScope: z.infer<typeof RecruitmentSearchScopeSchema>;
}

const RecruitmentState = Annotation.Root({
  userMessage: Annotation<string>(),
  history: Annotation<ConversationHistoryEntry[]>({
    reducer: (previous, update) => previous.concat(update),
    default: () => [],
  }),
  action: replaceable<ParsedRecruitmentAction | undefined>(() => undefined),
  discoveredPlayers: Annotation<Record<string, PlayerProfile>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  candidateIdentityGroups: replaceable<CandidateIdentityGroupReference[]>(() => []),
  observedRecords: Annotation<Record<string, { competition: string; season: string }>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  evaluatedPlayers: Annotation<Record<string, EvaluatedPlayer>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  evidenceEvaluationWithheld: replaceable<boolean>(() => false),
  externalSignals: replaceable<Record<string, PlayerEloSignal>>(() => ({})),
  externalSignalCoverage: replaceable<ExternalSignalCoverage>(() => createEmptyExternalSignalCoverage()),
  historicalArchiveSamplesByPlayerId: replaceable<Record<string, HistoricalArchiveSample[]>>(() => ({})),
  historicalArchiveCoverage: replaceable<HistoricalArchiveCoverage>(() => ({
    status: "not_run",
    disabledReason: null,
    checkedCandidates: 0,
    mappedCandidates: 0,
    matchedCandidates: 0,
    failedCandidates: 0,
  })),
  targetTeam: replaceable<string | null>(() => null),
  confirmedPosition: replaceable<Position | null>(() => null),
  confirmedPositionSearchObservationIndex: replaceable<number | null>(() => null),
  candidateSearchScopeChanged: replaceable<boolean>(() => false),
  confirmedPositionNoMatchQuestionAsked: replaceable<boolean>(() => false),
  confirmedPositionNoMatchDeclined: replaceable<boolean>(() => false),
  positionBroadeningApproved: replaceable<boolean>(() => false),
  roleClarificationAsked: replaceable<boolean>(() => false),
  replacementRoleQuestionAsked: replaceable<boolean>(() => false),
  pendingQuestion: replaceable<PendingQuestion | null>(() => null),
  report: replaceable<RecruitmentReport | null>(() => null),
  datasetScope: replaceable<DatasetScope | undefined>(() => undefined),
  responseMessage: replaceable<string>(() => ""),
  decisionSteps: replaceable<number>(() => 0),
  toolUses: replaceable<ToolUseCounts>(emptyToolUseCounts),
  reviewAttempts: replaceable<number>(() => 0),
  reviewResult: replaceable<"valid" | "retry" | "exhausted" | "bypassed">(() => "valid"),
  forcedLimitReached: replaceable<boolean>(() => false),
  hasInvestigated: replaceable<boolean>(() => false),
  hasSearchedMethodology: replaceable<boolean>(() => false),
  hasSearchedPlayerReports: replaceable<boolean>(() => false),
  methodologySearchFailed: replaceable<boolean>(() => false),
  playerReportSearchFailed: replaceable<boolean>(() => false),
  sourceAccessFailure: replaceable<{ code: "blocked" | "rate_limit"; message: string } | null>(() => null),
  candidateSearchFailure: replaceable<{ code: string | null; message: string } | null>(() => null),
  candidateSearchSucceededThisTurn: replaceable<boolean>(() => false),
  candidateSearchTurnStartIndex: replaceable<number>(() => 0),
  policyBlocked: replaceable<boolean>(() => false),
  policyBlockedRepeatCount: replaceable<number>(() => 0),
  policyLoopStopped: replaceable<boolean>(() => false),
  searchedReportPlayerNames: Annotation<string[]>({
    reducer: (previous, update) => [...new Set([...previous, ...update])],
    default: () => [],
  }),
  retrievedKnowledge: replaceable<Record<string, KnowledgeSearchResult>>(() => ({})),
  candidateSearchObservations: Annotation<CandidateSearchObservation[]>({
    reducer: (previous, update) => previous.concat(update),
    default: () => [],
  }),
  candidateSearchCursorAdjustment: replaceable<{ requestedOffset: number; effectiveOffset: number } | null>(() => null),
});

type State = typeof RecruitmentState.State;
const maxDecisionsPerTurn = 16;


function providerErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[a-z0-9_-]{1,40}$/i.test(code) ? code : undefined;
}

function safeToolFailure(error: unknown): { code: string | null; message: string } {
  const rawMessage = error instanceof Error ? error.message : "数据工具调用失败。";
  const message = rawMessage
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [已隐藏]")
    .replace(/\b(authorization|api[_-]?(?:token|key)|access[_-]?token|token)\s*[:=]\s*["']?[^\s,&"']+/gi, "$1=[已隐藏]")
    .slice(0, 400);
  return { code: providerErrorCode(error) ?? null, message: message || "数据工具调用失败。" };
}

function asksToRepeatPositionBroadeningQuestion(action: ParsedRecruitmentAction): boolean {
  if (action.action !== "ask_user") return false;
  const text = `${action.question} ${action.reason}`;
  const asksPermission = /(?:你希望|是否|要不要|请确认|愿意|可以.{0,12}吗|would you|should we|do you want|please confirm)/i.test(text);
  const asksToBroaden = /(?:扩大|扩展|放宽|其他位置|其他前锋位置|更广.{0,8}范围|broaden|expand|broader|other positions)/i.test(text);
  return asksPermission && asksToBroaden;
}

function claimsUnavailablePlayerReports(action: ParsedRecruitmentAction): boolean {
  if (action.action !== "ask_user") return false;
  const text = `${action.question} ${action.reason}`;
  const mentionsReports = /(?:球员报告|球探报告|报告|player reports?|scouting reports?)/i.test(text);
  const claimsRetrievedEvidence = /(?:已获取|已检索到|现有|已有).{0,18}(?:球员|球探)?报告|报告中.{0,32}(?:显示|指出|提到|发现|例如|如|样本)|基于.{0,24}(?:球员|球探)?报告|reports?.{0,40}(?:show|say|include|find|such as)/i.test(text);
  return mentionsReports && claimsRetrievedEvidence;
}

function policyBlockReasonCode(feedback: string): PolicyBlockReasonCode {
  if (feedback.includes("先调查至少一项可用球队或球员数据")) return "question_before_investigation";
  if (feedback.includes("用户没有指定联赛、赛事或赛季")) return "unspecified_competition_scope";
  if (feedback.includes("现有工具没有可用的球员现役俱乐部或联赛核验来源")) return "unverified_current_affiliation";
  if (feedback.includes("用户已说明替代目标及所需位置/角色")) return "reference_player_identity";
  if (feedback.includes("用户已经同意扩大位置范围")) return "repeated_position_broadening";
  if (feedback.includes("球员报告检索结果为零")) return "unavailable_player_report_claim";
  if (feedback.includes("当前这组候选筛选已到最后一页")) return "candidate_search_exhausted";
  return "other";
}

function candidateSearchScopeKey(action: CandidateSearchAction): string {
  return JSON.stringify({
    position: action.position,
    playerName: action.playerName ? normalizeSearchText(action.playerName) : null,
    maxAge: action.maxAge,
    minimumMinutes: action.minimumMinutes,
    competition: action.competition ? normalizeSearchText(action.competition) : null,
    season: action.season ? normalizeSearchText(action.season) : null,
  });
}

function candidateSearchScopeKeyForIntent(intent: CandidateSearchIntent): string {
  return candidateSearchScopeKey({
    action: "search_candidates",
    position: intent.position,
    playerName: null,
    maxAge: intent.maxAge,
    minimumMinutes: intent.minimumMinutes,
    competition: intent.competition,
    season: intent.season,
    offset: 0,
    limit: 20,
  });
}

function candidateSearchObservationIndexForIntent(
  intent: CandidateSearchIntent,
  observations: CandidateSearchObservation[],
  minimumIndex = 0,
): number | null {
  const expectedScope = candidateSearchScopeKeyForIntent(intent);
  for (let index = observations.length - 1; index >= minimumIndex; index -= 1) {
    const observation = observations[index];
    if (observation.request.playerName === null
      && candidateSearchScopeKey(observation.request) === expectedScope) return index;
  }
  return null;
}

function confirmedPositionSearchObservation(state: State): CandidateSearchObservation | null {
  const index = state.confirmedPositionSearchObservationIndex;
  return index === null ? null : state.candidateSearchObservations[index] ?? null;
}

function sampleUnevaluatedCandidates(state: State, limit = 10): string[] {
  const intent = resolvedCandidateSearchIntent(state);
  const groups = state.candidateIdentityGroups.length
    ? state.candidateIdentityGroups
    : Object.values(state.discoveredPlayers).map((player) => ({
      identityKey: `source:${sourcePlayerKey(player)}`,
      status: player.sourceIdentity ? "registry_unavailable" as const : "missing_source_identity" as const,
      registryAvailable: false,
      reepId: null,
      releaseStamp: null,
      recordPlayerIds: [player.playerId],
    }));
  const candidates: string[] = [];
  for (const group of groups) {
    for (const playerId of group.recordPlayerIds) {
      const player = state.discoveredPlayers[playerId];
      if (!player || state.evaluatedPlayers[playerId] || !candidateMatchesSearchIntent(player, intent)) continue;
      candidates.push(playerId);
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}

function routeCandidateSearch(
  action: CandidateSearchAction,
  state: State,
  enforceCurrentTurnObservation: boolean,
): {
  action: CandidateSearchAction;
  requestedOffset: number;
  effectiveOffset: number;
  exhausted: boolean;
} {
  const key = candidateSearchScopeKey(action);
  const observations = enforceCurrentTurnObservation && state.candidateSearchScopeChanged
    ? state.candidateSearchObservations.slice(state.candidateSearchTurnStartIndex)
    : state.candidateSearchObservations;
  const previousSearch = observations.slice().reverse().find((observation) => (
    candidateSearchScopeKey(observation.request) === key
  ));
  const hasPreviousPage = previousSearch !== undefined;
  const nextOffset = previousSearch?.nextOffset;
  const requestedOffset = action.offset;
  const exhausted = hasPreviousPage && nextOffset === null;
  const effectiveOffset = exhausted ? requestedOffset : hasPreviousPage ? nextOffset! : 0;
  return {
    action: { ...action, offset: effectiveOffset },
    requestedOffset,
    effectiveOffset,
    exhausted,
  };
}

type CandidateConstraintState = Pick<State, "confirmedPosition" | "history">;

function resolvedCandidateSearchIntent(state: CandidateConstraintState, latestMessage?: string): CandidateSearchIntent {
  const messages = userMessages(state.history);
  return resolveCandidateSearchIntent({
    userMessages: latestMessage === undefined ? messages : [...messages, latestMessage],
    confirmedPosition: state.confirmedPosition,
    ...(latestMessage === undefined ? {} : { latestMessage }),
  });
}

function hasCandidateSearchScopeChanged(
  history: ConversationHistoryEntry[],
  latestMessage: string,
  confirmedPosition: Position | null,
): boolean {
  const priorMessages = userMessages(history);
  if (priorMessages.length === 0) return false;
  const priorIntent = resolveCandidateSearchIntent({ userMessages: priorMessages, confirmedPosition });
  const latestIntent = resolveCandidateSearchIntent({
    userMessages: [...priorMessages, latestMessage],
    confirmedPosition,
    latestMessage,
  });
  return candidateSearchScopeKeyForIntent(priorIntent) !== candidateSearchScopeKeyForIntent(latestIntent);
}

function discoveredPlayersForConstraint(
  state: Pick<State, "confirmedPosition" | "history" | "discoveredPlayers">,
  intent = resolvedCandidateSearchIntent(state),
): PlayerProfile[] {
  return Object.values(state.discoveredPlayers).filter((player) => candidateMatchesSearchIntent(player, intent));
}

function evaluatedPlayersForConstraint(
  state: Pick<State, "confirmedPosition" | "history" | "evaluatedPlayers">,
  intent = resolvedCandidateSearchIntent(state),
): Record<string, EvaluatedPlayer> {
  return Object.fromEntries(Object.entries(state.evaluatedPlayers).filter(([, evaluated]) =>
    candidateMatchesSearchIntent(evaluated.player, intent),
  ));
}

function userMessages(history: ConversationHistoryEntry[]): string[] {
  return history.filter((entry) => entry.role === "user").map((entry) => entry.content);
}

function replacementRoleQuestion(targetTeam: string | null): Extract<ParsedRecruitmentAction, { action: "ask_user" }> {
  return {
    action: "ask_user",
    targetTeam,
    question: "你希望替代者延续参考球员的场上角色，还是考虑不同的位置或职责？",
    reason: "角色方向会改变候选搜索和能力评估维度，先确认后再继续同一案件。",
  };
}

function broadRoleQuestion(targetTeam: string | null): Extract<ParsedRecruitmentAction, { action: "ask_user" }> {
  return {
    action: "ask_user",
    targetTeam,
    question: "我先做了首轮宽范围调查。你希望补强哪个场上位置？可以说前锋、中场、后卫、门将，也可以指定中锋、边锋或边后卫。",
    reason: "位置会改变候选池和可比较的球员组。我已先检索并评估初步表现样本；你回答后，我会在同一案件按确认的位置继续调查。",
  };
}

function emptyPositionQuestion(
  targetTeam: string | null,
  position: Position,
): Extract<ParsedRecruitmentAction, { action: "ask_user" }> {
  const label = positionLabels[position];
  return {
    action: "ask_user",
    targetTeam,
    question: `当前数据源中没有找到符合${label}位置范围的候选样本。你希望扩大到其他位置继续找，还是保留${label}范围并先结束本轮？如只愿意放宽到其他前锋位置，也可以直接说明。`,
    reason: "你确认的位置范围是硬约束；没有得到同意前，我不会用其他位置的球员替代。",
  };
}

function teamHistory(players: PlayerProfile[], teamName: string, repository: PlayerRepository) {
  const key = normalizeSearchText(teamName);
  const matches = players.filter((player) => {
    const team = normalizeSearchText(player.team);
    return team === key || (key.length >= 4 && team.includes(key)) || (team.length >= 4 && key.includes(team));
  });
  const currentSeasonMatches = matches.filter((player) => player.sourceIdentity?.isCurrentSeason === true);
  const displayedMatches = currentSeasonMatches.length ? currentSeasonMatches : matches;
  const seasons = [...new Set(matches.map((player) => `${player.competition} · ${player.season}`))];
  return {
    requestedTeam: teamName,
    matchedRecords: displayedMatches.length,
    sampledSeasons: seasons,
    sample: displayedMatches.slice(0, 12).map((player) => ({
      playerId: player.playerId,
      name: player.name,
      position: player.position,
      competition: player.competition,
      season: player.season,
      minutes: player.minutes,
      eventDataComplete: player.eventDataComplete !== false,
    })),
    currentRosterVerified: repository.mode === "sportmonks" && currentSeasonMatches.length > 0,
    note: currentSeasonMatches.length > 0 && repository.mode === "premier_league"
      ? "这些是 Premier League 当前赛季统计榜中的该队表现记录样本，不是球队完整注册阵容。"
      : currentSeasonMatches.length > 0 && repository.mode === "fpl"
      ? "这些是 Fantasy Premier League 当前赛季游戏目录中的该队球员记录，不代表球队完整注册名单。"
      : currentSeasonMatches.length > 0 && repository.mode === "asa"
      ? "这些是 ASA 返回的该队当前赛季表现记录样本，不是球队完整注册名单。"
      : currentSeasonMatches.length > 0 && repository.mode === "understat"
      ? "这些是 Understat 当前赛季联赛页中的该队表现记录样本，不是球队完整注册名单。"
      : currentSeasonMatches.length > 0 && repository.mode === "mosaic"
      ? "这些是多来源当前赛季表现记录样本；同队名不构成跨来源身份确认，也不是完整注册名单。"
      : currentSeasonMatches.length
        ? "这些是 provider 记录的当前赛季阵容样本；仅代表该来源、该赛季的名单覆盖。"
      : matches.length
        ? "这些只是数据覆盖内的历史比赛阵容样本，不能作为当前完整阵容。"
      : "所选数据中没有找到该队阵容样本，不能据此判断当前阵容。",
  };
}

const limitationDescriptions = {
  current_roster: "当前数据不能核实目标球队的完整现役阵容。",
  budget: "当前数据不含球队可用预算，预算可行性尚未核实。",
  market_value: "当前数据不含可核验的球员市场估值或转会费。",
  contract: "当前数据不含球员合同、薪资或经纪费用。",
  injury: "当前数据不含伤病史或医疗评估。",
  physical: "当前数据不含身体属性或体能测试结果。",
  potential: "当前数据不能验证球员潜力或未来发展。",
  registration: "当前数据未核验联赛或赛事注册资格。",
  work_permit: "当前数据未核验工作许可或移民资格。",
  other: "有些需求无法由当前数据验证，需要补充来源或人工核实。",
} satisfies Record<Extract<FinishRecruitmentAction["limitationKeys"][number], string>, string>;

function candidateSearchSampleCoverage(observations: CandidateSearchObservation[]): Array<{
  matchingRecordCount: number | null;
  discoveredSourceRecordCount: number;
  nextOffset: number | null;
}> {
  const scopes = new Map<string, {
    matchingRecordCount: number | null;
    nextOffset: number | null;
    sourceRecordIds: Set<string>;
  }>();
  for (const observation of observations) {
    const scopeKey = candidateSearchScopeKey(observation.request);
    const scope = scopes.get(scopeKey) ?? {
      matchingRecordCount: null,
      nextOffset: null,
      sourceRecordIds: new Set<string>(),
    };
    if (observation.matchingRecordCount !== null) {
      scope.matchingRecordCount = observation.matchingRecordCount;
    }
    scope.nextOffset = observation.nextOffset;
    for (const sourceRecordId of observation.discoveredSourceRecordIds) {
      scope.sourceRecordIds.add(sourceRecordId);
    }
    scopes.set(scopeKey, scope);
  }
  return [...scopes.values()].map(({ matchingRecordCount, nextOffset, sourceRecordIds }) => ({
    matchingRecordCount,
    discoveredSourceRecordCount: sourceRecordIds.size,
    nextOffset,
  }));
}

function hasLowSampleEvidence({ player, evidence }: EvaluatedPlayer): boolean {
  return player.minutes < minimumMinutesForPercentileComparison
    || evidence.some((item) => item.minutes !== null && item.minutes < minimumMinutesForPercentileComparison);
}

function limitationsFor(
  state: State,
  repository: PlayerRepository,
  action: FinishRecruitmentAction,
  evaluator: RecruitmentEvidenceEvaluator,
): string[] {
  const eligibleEvaluatedPlayers = Object.values(evaluatedPlayersForConstraint(state));
  const requestedEvidenceAreas = requestedCapabilityEvidenceAreas(userMessages(state.history));
  const limitations = action.limitationKeys.map((key) => limitationDescriptions[key]);
  const identityCoverage = summarizeCandidateIdentityGroupReferences(state.candidateIdentityGroups);
  const identityStatusCount = (status: CandidateIdentityResolutionStatus) => (
    identityCoverage.resolutionStatusCounts.find((item) => item.status === status)?.count ?? 0
  );
  const missingIdentityCount = identityStatusCount("missing_source_identity");
  const unavailableIdentityCount = identityStatusCount("registry_unavailable");
  if (missingIdentityCount > 0) {
    limitations.push(`${missingIdentityCount} 条候选来源记录没有稳定球员 ID，无法进行精确身份关联；这些记录按独立来源记录保留。`);
  }
  if (unavailableIdentityCount > 0) {
    limitations.push(`本机未能读取 Reep 身份索引；${unavailableIdentityCount} 条具备来源 ID 的候选记录未做身份解析，按独立记录保留。`);
  }
  if (identityCoverage.registryAvailable && identityCoverage.unresolvedSourceRecordCount > 0) {
    limitations.push(`Reep release ${identityCoverage.releaseStamp ?? "未确认"} 将 ${identityCoverage.resolvedSourceRecordCount} 条来源记录归为 ${identityCoverage.resolvedIdentityCount} 个精确身份组；另有 ${identityCoverage.unresolvedSourceRecordCount} 条记录未能解析，继续按来源记录分别保留。身份映射不合并指标或评分。`);
  }
  if (state.evidenceEvaluationWithheld) {
    limitations.push("实验对照组有意屏蔽球员表现评估器；当前结果不提供能力指标或百分位，也不代表数据源缺失或球员能力为零。");
  } else {
    for (const area of requestedEvidenceAreas) {
      if (eligibleEvaluatedPlayers.length && eligibleEvaluatedPlayers.every(({ evidence }) => (
        !evidence.some((item) => area.metricKeys.includes(item.key))
      ))) {
        limitations.push(`当前数据没有提供与用户要求的“${area.name}”相对应的可观测指标，无法评估该能力。`);
      }
    }
  }
  for (const coverage of candidateSearchSampleCoverage(state.candidateSearchObservations)) {
    const hasKnownUnobservedRecords = coverage.matchingRecordCount !== null
      && coverage.matchingRecordCount > coverage.discoveredSourceRecordCount;
    if (hasKnownUnobservedRecords || coverage.nextOffset !== null) {
      if (coverage.matchingRecordCount === null) {
        limitations.push(`当前筛选的匹配总数未知；Agent 已读取 ${coverage.discoveredSourceRecordCount} 条来源记录，来源仍返回下一页（offset=${coverage.nextOffset}），样本尚未读完。`);
        continue;
      }
      limitations.push(state.evidenceEvaluationWithheld
        ? `当前筛选命中 ${coverage.matchingRecordCount} 条候选记录；Agent 读取 ${coverage.discoveredSourceRecordCount} 条来源记录。本实验屏蔽了能力评估，不能据此形成能力比较；本轮也不代表全量市场排名。`
        : `当前筛选命中 ${coverage.matchingRecordCount} 条候选记录；Agent 读取 ${coverage.discoveredSourceRecordCount} 条来源记录、评估 ${eligibleEvaluatedPlayers.length} 人。本轮是有限样本调查，不代表全量市场排名。`);
    }
  }
  const eligibleDiscoveredPlayers = discoveredPlayersForConstraint(state);
  const unevaluatedDiscoveredCount = eligibleDiscoveredPlayers.filter(({ playerId }) => !state.evaluatedPlayers[playerId]).length;
  if (unevaluatedDiscoveredCount > 0) {
    limitations.push(`本轮已发现 ${eligibleDiscoveredPlayers.length} 名符合当前条件的候选，其中 ${unevaluatedDiscoveredCount} 人未完成表现评估；结论只覆盖已评估样本。`);
  }
  if (!state.evidenceEvaluationWithheld && repository.mode === "fbref" && eligibleEvaluatedPlayers.some(({ player }) => player.source.includes("统计页未读取"))) {
    limitations.push("本次有一个或多个补充统计页未能读取；只使用了来源成功返回的字段，缺失指标没有按零值处理。 ");
  }
  if (state.sourceAccessFailure) {
    limitations.push(`${repository.sourceName} 数据源访问失败（${state.sourceAccessFailure.code}）：${state.sourceAccessFailure.message}`);
  }
  if (state.candidateSearchFailure && !state.sourceAccessFailure) {
    const { code, message } = state.candidateSearchFailure;
    limitations.push(`${repository.sourceName} 最近一次候选查询失败${code ? `（${code}）` : ""}：${message} 该失败不能解释为零匹配，不代表没有符合条件的球员。`);
  }
  limitations.push(...describeDatasetScope(repository.mode).limitations);
  const confirmedPositionSearch = confirmedPositionSearchObservation(state);
  if (state.confirmedPosition && confirmedPositionSearch?.matchingRecordCount === 0) {
    limitations.push(`本轮按用户确认的位置（${positionLabels[state.confirmedPosition]}）完成候选检索后，没有找到符合当前筛选条件的球员；没有放宽位置范围。`);
  } else if (state.confirmedPosition && !confirmedPositionSearch && !discoveredPlayersForConstraint(state).length) {
    limitations.push(`本轮尚未完成用户确认位置（${positionLabels[state.confirmedPosition]}）的候选检索；报告没有用其他位置的球员代替。`);
  } else if (state.confirmedPosition && confirmedPositionSearch
    && confirmedPositionSearch.matchingRecordCount === null && !discoveredPlayersForConstraint(state).length) {
    limitations.push(`来源没有提供用户确认位置（${positionLabels[state.confirmedPosition]}）的精确匹配总数；已读取页面未发现候选，不能据此确认没有符合条件的球员。`);
  } else if (state.confirmedPosition && !eligibleEvaluatedPlayers.length) {
    limitations.push(`已找到符合用户确认位置（${positionLabels[state.confirmedPosition]}）的球员，但当前数据不足以完成该位置的可靠评估。`);
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some(hasLowSampleEvidence)) {
    limitations.push(`部分候选人或指标样本少于 ${minimumMinutesForPercentileComparison} 分钟，单赛季每 90 分钟数据波动较大；这些指标不显示百分位。`);
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some(({ evidence }) => evidence.some((item) => item.peerPercentileUnavailableReason === "candidate_sample_unknown"))) {
    limitations.push("部分指标来源没有提供样本分钟，无法核实比较门槛，因此不显示这些指标的百分位。");
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some(({ player }) => player.eventDataComplete === false)) {
    limitations.push("部分球员缺少一场或多场比赛的事件文件；这些球员只作为候选线索，不提供比赛表现指标或推荐依据。");
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some((candidate) => evaluator.coverage(candidate).hasMissingMetrics)) {
    limitations.push("来源或赛季记录没有提供部分评估指标；这些指标保持暂无数据，不按零值处理，也不参与对应职责的适配计算。");
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some(({ player }) =>
    player.stats.passesAttempted === 0
      && (player.availableStats === undefined || player.availableStats.includes("passesAttempted"))
  )) {
    limitations.push("部分评估对象没有传球尝试，传球成功率不适用，因此不列入可用指标。");
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some(({ evidence }) => evidence.some((item) => item.peerPercentileUnavailableReason === "insufficient_peer_group"))) {
    limitations.push(`部分指标达到 ${minimumMinutesForPercentileComparison} 分钟门槛的同位置、同赛事、同赛季比较组不足 5 人；这些维度不显示百分位比较。`);
  }
  if (!state.evidenceEvaluationWithheld) {
    limitations.push("比赛事件指标只能说明可观察到的表现产出，不能代表球员的完整能力或未来表现。");
  }
  if (state.forcedLimitReached) limitations.push("本轮调查达到安全步数上限，未完成的方向需要用户补充后再继续。");
  if (state.policyLoopStopped) limitations.push("Agent 连续重复提出被调查策略拒绝的相同动作，系统已停止重复调用模型；报告只保留当前可验证证据。");
  if (state.reviewResult === "exhausted") limitations.push("推荐未通过证据引用检查，因此本次没有输出候选推荐。");
  const unsearchedReportCount = eligibleEvaluatedPlayers
    .filter(({ player }) => !state.searchedReportPlayerNames.some((name) => normalizeSearchText(name) === normalizeSearchText(player.name)))
    .length;
  if (unsearchedReportCount > 0 && state.toolUses.search_player_reports >= toolBudgets.search_player_reports) {
    limitations.push(`本轮球员报告检索预算已用尽；${unsearchedReportCount} 名已评估候选未完成报告检索，相关观察仍需人工补查。`);
  }
  if (state.hasSearchedPlayerReports && !Object.values(state.retrievedKnowledge).some((document) => document.corpus === "player_report")) {
    limitations.push(state.playerReportSearchFailed
      ? "本轮球员报告检索发生错误；未能取得报告层面的定性观察。"
      : "本轮获准索引中没有检索到相关球员报告；报告层面的定性观察仍需人工补查。");
  }
  if (state.methodologySearchFailed) limitations.push("角色/方法资料索引检索发生错误；能力画像只由对话和比赛数据形成。 ".trim());
  return [...new Set(limitations)];
}

export function createRecruitmentConversation(input: {
  repository: PlayerRepository;
  planner: RecruitmentPlanner;
  candidateIdentityGrouper?: (records: readonly PlayerProfile[]) => CandidateIdentityGroup[];
  knowledgeBase?: KnowledgeRepository;
  observer?: RecruitmentTraceObserver;
  checkpointer?: BaseCheckpointSaver;
  experimentalReviewerMode?: RecruitmentReviewerMode;
  experimentalAskUserMode?: RecruitmentAskUserMode;
  experimentalCandidatePolicyMode?: RecruitmentCandidatePolicyMode;
  experimentalCandidateSearchFreshnessMode?: "enabled" | "bypassed";
  evidenceEvaluator?: RecruitmentEvidenceEvaluator;
}): RecruitmentConversation {
  const { repository, planner, observer } = input;
  const groupCandidateRecords = input.candidateIdentityGrouper
    ?? ((records) => groupCandidatesByExactIdentity(records));
  const candidateIdentityGroupReferencesFor = (state: State): CandidateIdentityGroupReference[] => (
    state.candidateIdentityGroups.length
      ? state.candidateIdentityGroups
      : toCandidateIdentityGroupReferences(groupCandidateRecords(Object.values(state.discoveredPlayers)))
  );
  const evidenceEvaluator = input.evidenceEvaluator ?? createRecruitmentEvidenceEvaluator(repository);
  const reviewerMode = input.experimentalReviewerMode ?? "enabled";
  const askUserMode = input.experimentalAskUserMode ?? "enabled";
  const candidatePolicyMode = input.experimentalCandidatePolicyMode ?? "enabled";
  const candidateSearchFreshnessMode = input.experimentalCandidateSearchFreshnessMode ?? "enabled";
  const enforceCurrentTurnObservation = candidateSearchFreshnessMode === "enabled";
  const knowledgeBase = input.knowledgeBase ?? createLocalKnowledgeBase();
  const playerEloSetup = createConfiguredPlayerEloReportClient();
  const historicalArchiveSetup = createConfiguredHistoricalArchive();
  const disabledPlayerEloCoverage: ExternalSignalCoverage = playerEloSetup.status === "disabled"
    ? createEmptyExternalSignalCoverage("disabled", playerEloSetup.reason)
    : createEmptyExternalSignalCoverage();
  const emitProgress = (config: LangGraphRunnableConfig, progress: ProgressUpdateInput) => {
    getWriter(config)?.({
      type: "tactiscout/recruitment-progress",
      status: "started",
      ...progress,
    });
  };
  const workflow = new StateGraph(RecruitmentState)
    .addNode("record_user_turn", (state: State) => {
      const positionIntent = resolvedCandidateSearchIntent(state, state.userMessage);
      const positionChange = positionIntent.latestPositionChange;
      const searchScopeChanged = hasCandidateSearchScopeChanged(state.history, state.userMessage, state.confirmedPosition);
      const priorCandidateSearchIndex = !searchScopeChanged && positionIntent.position !== null
        ? candidateSearchObservationIndexForIntent(positionIntent, state.candidateSearchObservations)
        : null;
      const explicitTargetTeam = extractExplicitTargetTeam(state.userMessage);
      return {
        candidateSearchTurnStartIndex: state.candidateSearchObservations.length,
        history: [{ role: "user" as const, content: state.userMessage }],
        ...(explicitTargetTeam ? { targetTeam: explicitTargetTeam } : {}),
        report: null,
        externalSignals: {},
        externalSignalCoverage: disabledPlayerEloCoverage,
        historicalArchiveSamplesByPlayerId: {},
        historicalArchiveCoverage: historicalArchiveSetup.coverage,
        responseMessage: "",
        pendingQuestion: null,
        decisionSteps: 0,
        toolUses: emptyToolUseCounts(),
        reviewAttempts: 0,
        reviewResult: "valid" as const,
        forcedLimitReached: false,
        hasSearchedMethodology: false,
        hasSearchedPlayerReports: false,
        methodologySearchFailed: false,
        playerReportSearchFailed: false,
        sourceAccessFailure: null,
        candidateSearchFailure: null,
        candidateSearchSucceededThisTurn: false,
        candidateSearchScopeChanged: searchScopeChanged,
        confirmedPositionNoMatchQuestionAsked: false,
        confirmedPositionNoMatchDeclined: false,
        positionBroadeningApproved: false,
        roleClarificationAsked: false,
        policyBlocked: false,
        policyBlockedRepeatCount: 0,
        policyLoopStopped: false,
        searchedReportPlayerNames: [],
        retrievedKnowledge: {},
        confirmedPositionSearchObservationIndex: priorCandidateSearchIndex,
        ...(positionChange.changed ? { confirmedPosition: positionChange.position } : {}),
      };
    })
    .addNode("choose_next_action", async (state: State, config: LangGraphRunnableConfig) => {
      const intent = resolvedCandidateSearchIntent(state);
      emitProgress(config, {
        stage: "planning",
        message: state.decisionSteps === 0 ? "正在整理需求并规划调查步骤" : "正在根据已收集的信息规划下一步调查",
        completedSteps: state.decisionSteps,
      });
      const completePlanning = (message: string) => emitProgress(config, {
        stage: "planning",
        status: "completed",
        message,
        completedSteps: state.decisionSteps,
      });
      if (state.sourceAccessFailure) {
        const action = FinishActionSchema.parse({
          ...emptyDecision(state.targetTeam),
          needSummary: `${repository.sourceName} 当前数据请求被拒绝，本轮无法生成候选名单。`,
        });
        const responseMessage = `${repository.sourceName} 的数据请求被拒绝（${state.sourceAccessFailure.code === "blocked" ? "HTTP 403" : "HTTP 429"}）。本轮无法读取球员数据；这不代表没有符合条件的球员。`;
        observer?.({ phase: "decision", action: "finish", decisionSource: "policy", elapsedMs: 0, ok: true, policyBlocked: false, targetTeam: state.targetTeam ?? undefined });
        completePlanning("已确认当前数据源无法访问，正在整理调查结果");
        return {
          action,
          responseMessage,
          decisionSteps: state.decisionSteps + 1,
          pendingQuestion: null,
          policyBlocked: false,
          policyBlockedRepeatCount: 0,
          history: [{ role: "assistant" as const, content: JSON.stringify(action) }],
        };
      }
      if (repository.mode === "asa"
        && state.candidateSearchFailure
        && !state.candidateSearchSucceededThisTurn
        && ["network", "timeout"].includes(state.candidateSearchFailure.code ?? "")) {
        const action = emptyDecision(state.targetTeam);
        action.needSummary = `${repository.sourceName} 在完成一次有界传输重试后仍无法读取；当前不能确认候选匹配结果。`;
        const responseMessage = `${repository.sourceName} 暂时无法连接，已停止本轮候选调查；这不代表没有匹配球员。请稍后重新分析。`;
        observer?.({ phase: "decision", action: "finish", decisionSource: "policy", elapsedMs: 0, ok: true, policyBlocked: false, targetTeam: state.targetTeam ?? undefined });
        completePlanning("ASA 数据请求重试后仍失败，正在如实说明来源状态");
        return {
          action,
          responseMessage,
          decisionSteps: state.decisionSteps + 1,
          pendingQuestion: null,
          policyBlocked: false,
          policyBlockedRepeatCount: 0,
          history: [{ role: "assistant" as const, content: JSON.stringify(action) }],
        };
      }
      if ((repository.mode === "fpl" || repository.mode === "premier_league"
          || ((repository.mode === "understat" || repository.mode === "mosaic") && state.candidateSearchFailure?.code !== "unsupported_scope"))
        && state.candidateSearchFailure
        && !state.candidateSearchSucceededThisTurn) {
        const action = emptyDecision(state.targetTeam);
        action.needSummary = `${repository.sourceName} 候选查询未成功，当前无法确认匹配结果。`;
        const responseMessage = `${repository.sourceName} 候选查询失败，当前无法确认是否有符合条件的球员；这不代表没有匹配球员。请稍后重新分析。`;
        observer?.({ phase: "decision", action: "finish", decisionSource: "policy", elapsedMs: 0, ok: true, policyBlocked: false, targetTeam: state.targetTeam ?? undefined });
        completePlanning("候选来源查询未成功，正在明确说明匹配情况未知");
        return {
          action,
          responseMessage,
          decisionSteps: state.decisionSteps + 1,
          pendingQuestion: null,
          policyBlocked: false,
          policyBlockedRepeatCount: 0,
          history: [{ role: "assistant" as const, content: JSON.stringify(action) }],
        };
      }
      if (state.confirmedPosition && confirmedPositionSearchObservation(state)?.matchingRecordCount === 0) {
        if (state.confirmedPositionNoMatchDeclined || intent.declinedPositionBroadening) {
          const action = emptyPositionConclusion(state.targetTeam, state.confirmedPosition);
          const responseMessage = `已保留${positionLabels[state.confirmedPosition]}范围并结束本轮；报告会说明当前数据中的候选缺口。`;
          observer?.({ phase: "decision", action: action.action, decisionSource: "policy", elapsedMs: 0, ok: true, policyBlocked: false, targetTeam: action.targetTeam });
          completePlanning("已按你确认的位置范围整理候选缺口");
          return {
            action,
            responseMessage,
            decisionSteps: state.decisionSteps + 1,
            policyBlocked: false,
            policyBlockedRepeatCount: 0,
            history: [{ role: "assistant" as const, content: JSON.stringify(action) }],
          };
        }
        if (!state.confirmedPositionNoMatchQuestionAsked) {
          const action = emptyPositionQuestion(state.targetTeam, state.confirmedPosition);
          const stateAction = actionForAskPolicy(action, askUserMode);
          const pendingQuestion = questionForAskPolicy(action, askUserMode);
          observer?.({ phase: "decision", action: action.action, decisionSource: "policy", elapsedMs: 0, ok: true, policyBlocked: false, askPolicyOutcome: askUserMode === "disabled" ? "suppressed" : "allowed", targetTeam: action.targetTeam });
          completePlanning(askUserMode === "disabled"
            ? "对照组已关闭 Agent 追问，因不能擅自扩大位置范围而安全暂停"
            : "当前来源没有该位置的候选记录，需要你决定是否扩大范围");
          return {
            action: stateAction,
            decisionSteps: state.decisionSteps + 1,
            pendingQuestion,
            responseMessage: pendingQuestion.question,
            confirmedPositionNoMatchQuestionAsked: true,
            policyBlocked: false,
            policyBlockedRepeatCount: 0,
            history: [{ role: "assistant" as const, content: askUserMode === "disabled"
              ? JSON.stringify({ action: "ask_user", suppressed: true })
              : JSON.stringify(action) }],
          };
        }
      }
      if (intent.replacementRequest
        && state.confirmedPosition === null
        && !state.replacementRoleQuestionAsked
        && state.candidateSearchObservations.length > 0) {
        const action = replacementRoleQuestion(state.targetTeam);
        const stateAction = actionForAskPolicy(action, askUserMode);
        const pendingQuestion = questionForAskPolicy(action, askUserMode);
        observer?.({
          phase: "decision",
          action: action.action,
          decisionSource: "policy",
          elapsedMs: 0,
          ok: true,
          policyBlocked: false,
          askPolicyOutcome: askUserMode === "disabled" ? "suppressed" : "allowed",
          targetTeam: action.targetTeam ?? state.targetTeam,
        });
        completePlanning(askUserMode === "disabled"
          ? "对照组已关闭 Agent 追问，关键职责仍未确认，已安全暂停"
          : "初步调查已完成，需要你确认要补强的具体职责");
        return {
          action: stateAction,
          decisionSteps: state.decisionSteps + 1,
          pendingQuestion,
          responseMessage: pendingQuestion.question,
          replacementRoleQuestionAsked: true,
          policyBlocked: false,
          policyBlockedRepeatCount: 0,
          history: [{ role: "assistant" as const, content: askUserMode === "disabled"
            ? JSON.stringify({ action: "ask_user", suppressed: true })
            : JSON.stringify(action) }],
        };
      }
      const roleIsUnspecified = intent.position === null;
      if (roleIsUnspecified
        && !intent.allowsAnyPosition
        && !intent.replacementRequest
        && !state.roleClarificationAsked
        && state.hasSearchedMethodology
        && Object.keys(evaluatedPlayersForConstraint(state)).length > 0) {
        const action = broadRoleQuestion(state.targetTeam);
        const stateAction = actionForAskPolicy(action, askUserMode);
        const pendingQuestion = questionForAskPolicy(action, askUserMode);
        observer?.({
          phase: "decision",
          action: action.action,
          decisionSource: "policy",
          elapsedMs: 0,
          ok: true,
          policyBlocked: false,
          askPolicyOutcome: askUserMode === "disabled" ? "suppressed" : "allowed",
          targetTeam: action.targetTeam ?? state.targetTeam,
        });
        completePlanning(askUserMode === "disabled"
          ? "对照组已关闭 Agent 追问，关键职责仍未确认，已安全暂停"
          : "首轮宽范围候选评估已完成，需要你确认场上位置");
        return {
          action: stateAction,
          decisionSteps: state.decisionSteps + 1,
          pendingQuestion,
          responseMessage: pendingQuestion.question,
          roleClarificationAsked: true,
          policyBlocked: false,
          policyBlockedRepeatCount: 0,
          history: [{ role: "assistant" as const, content: askUserMode === "disabled"
            ? JSON.stringify({ action: "ask_user", suppressed: true })
            : JSON.stringify(action) }],
        };
      }
      const pendingCandidateIds = sampleUnevaluatedCandidates(state);
      const confirmedPositionSearchComplete = confirmedPositionSearchObservation(state) !== null;
      const confirmedPositionSearchPending = Boolean(state.confirmedPosition && !confirmedPositionSearchComplete);
      const eligibleEvaluatedPlayers = evaluatedPlayersForConstraint(state);
      const unsearchedReportCandidates = Object.values(eligibleEvaluatedPlayers)
        .map(({ player }) => player.name)
        .filter((name) => !state.searchedReportPlayerNames.some((searchedName) => normalizeSearchText(searchedName) === normalizeSearchText(name)));
      if (!confirmedPositionSearchPending
        && pendingCandidateIds.length > 0
        && state.toolUses.evaluate_candidates < toolBudgets.evaluate_candidates) {
        if (Object.keys(eligibleEvaluatedPlayers).length > 0
          && unsearchedReportCandidates.length > 0
          && state.toolUses.search_player_reports < toolBudgets.search_player_reports) {
          const action = RecruitmentActionSchema.parse({
            action: "search_player_reports",
            targetTeam: state.targetTeam,
            query: "已评估候选球员的球探报告、比赛观察及可引用的定性证据",
            playerNames: unsearchedReportCandidates.slice(0, 10),
            limit: 4,
          });
          observer?.({
            phase: "decision",
            action: action.action,
            decisionSource: "policy",
            elapsedMs: 0,
            ok: true,
            policyBlocked: false,
            targetTeam: action.targetTeam,
          });
          completePlanning("先检索已评估候选的报告资料，再评估当前已发现的下一批候选");
          return {
            action,
            decisionSteps: state.decisionSteps + 1,
            policyBlocked: false,
            policyBlockedRepeatCount: 0,
            history: [
              { role: "assistant" as const, content: JSON.stringify(action) },
              { role: "tool" as const, toolName: "investigation_policy", content: "评估下一批候选前，先完成上一批的报告检索；报告结果不影响统计指标或候选排序。" },
            ],
          };
        }
        const action = RecruitmentActionSchema.parse({
          action: "evaluate_candidates",
          targetTeam: state.targetTeam,
          playerIds: pendingCandidateIds,
        });
        observer?.({
          phase: "decision",
          action: action.action,
          decisionSource: "policy",
          elapsedMs: 0,
          ok: true,
          policyBlocked: false,
          targetTeam: action.targetTeam,
        });
        completePlanning(`已发现 ${discoveredPlayersForConstraint(state).length} 名符合当前条件的候选，正在评估其中 ${pendingCandidateIds.length} 名未评估球员`);
        return {
          action,
          decisionSteps: state.decisionSteps + 1,
          policyBlocked: false,
          policyBlockedRepeatCount: 0,
          history: [
            { role: "assistant" as const, content: JSON.stringify(action) },
            { role: "tool" as const, toolName: "investigation_policy", content: `在 Planner 决定扩展候选范围或结束调查前，先评估已经发现且符合用户条件的候选；每批最多 10 人。当前已发现且符合条件 ${discoveredPlayersForConstraint(state).length} 人，本批评估 ${pendingCandidateIds.length} 人。评估预算耗尽时，最终报告必须说明未评估人数。` },
          ],
        };
      }
      if (state.decisionSteps >= maxDecisionsPerTurn) {
        const action = emptyDecision(state.targetTeam);
        const responseMessage = "已完成本轮有限调查。报告会说明当前证据和仍需核实的部分。";
        observer?.({ phase: "decision", action: action.action, decisionSource: "policy", elapsedMs: 0, ok: true, policyBlocked: false, targetTeam: action.targetTeam });
        completePlanning("本轮决策步数已达到上限，正在整理当前证据");
        return {
          action,
          responseMessage,
          forcedLimitReached: true,
          policyBlocked: false,
          history: [{ role: "assistant" as const, content: responseMessage }],
        };
      }
      const currentTurnCandidateSearches = state.candidateSearchObservations.slice(state.candidateSearchTurnStartIndex);
      const latestCandidatePage = currentTurnCandidateSearches.at(-1)
        ?? (state.positionBroadeningApproved ? confirmedPositionSearchObservation(state) : null);
      const candidatePageNextOffset = latestCandidatePage?.nextOffset ?? null;
      const candidatePageAction = latestCandidatePage?.request ?? null;
      // Report lookup has its own disclosure when capped; it must not block further candidate pages.
      const canExpandCandidates = candidatePageNextOffset !== null
        && candidatePageAction !== null
        && state.toolUses.search_candidates < toolBudgets.search_candidates
        && state.toolUses.evaluate_candidates < toolBudgets.evaluate_candidates;
      const reportSearchBudgetReached = state.toolUses.search_player_reports >= toolBudgets.search_player_reports;
      const reportsForCurrentCandidatesComplete = (state.hasSearchedPlayerReports
        && unsearchedReportCandidates.length === 0)
        || reportSearchBudgetReached;
      const decisionMode = reportsForCurrentCandidatesComplete
        ? canExpandCandidates
          ? state.policyBlocked && state.action?.action === "ask_user"
            ? "expand_recovery" as const
            : "expand" as const
          : candidatePageNextOffset === null && state.toolUses.search_candidates < toolBudgets.search_candidates
            ? "reorient" as const
            : "conclude" as const
        : "investigate" as const;
      const decisionConstraints = decisionMode === "investigate" ? undefined : buildDecisionConstraints({
        targetTeam: state.targetTeam,
        confirmedPosition: state.confirmedPosition,
        userMessages: userMessages(state.history),
        evaluatedPlayers: Object.values(eligibleEvaluatedPlayers),
        retrievedKnowledge: Object.values(state.retrievedKnowledge),
        candidateIdentityGroups: candidateIdentityGroupReferencesFor(state),
      });
      const expansionConstraints: RecruitmentExpansionConstraints | undefined = (decisionMode === "expand" || decisionMode === "expand_recovery")
        && candidatePageNextOffset !== null
        && candidatePageAction
        ? {
          targetTeam: state.targetTeam,
          nextOffset: candidatePageNextOffset,
          position: state.confirmedPosition ?? candidatePageAction.position,
          playerName: candidatePageAction.playerName,
          maxAge: candidatePageAction.maxAge,
          minimumMinutes: candidatePageAction.minimumMinutes,
          competition: candidatePageAction.competition,
          season: candidatePageAction.season,
        }
        : undefined;
      if (Object.keys(eligibleEvaluatedPlayers).length > 0
        && unsearchedReportCandidates.length > 0
        && state.toolUses.search_player_reports < toolBudgets.search_player_reports) {
        const action = RecruitmentActionSchema.parse({
          action: "search_player_reports",
          targetTeam: state.targetTeam,
          query: "已评估候选球员的球探报告、比赛观察及可引用的定性证据",
          playerNames: Object.values(eligibleEvaluatedPlayers).map(({ player }) => player.name).slice(0, 10),
          limit: 4,
        });
        observer?.({
          phase: "decision",
          action: action.action,
          decisionSource: "policy",
          elapsedMs: 0,
          ok: true,
          policyBlocked: false,
          targetTeam: action.targetTeam,
        });
        completePlanning("候选表现评估已完成，正在补充检索球员报告");
        return {
          action,
          decisionSteps: state.decisionSteps + 1,
          policyBlocked: false,
          policyBlockedRepeatCount: 0,
          history: [
            { role: "assistant" as const, content: JSON.stringify(action) },
            { role: "tool" as const, toolName: "investigation_policy", content: "能力评估后先检索球员报告补充定性观察，再交给 Planner 综合实际指标并生成结论。" },
          ],
        };
      }
      if (decisionMode === "conclude") {
        emitProgress(config, {
          stage: "synthesizing",
          message: "正在汇总候选证据并整理结论",
          completedSteps: state.decisionSteps,
        });
      }
      const decisionStartedAt = performance.now();
      let action: ParsedRecruitmentAction;
      let proposedAction: ParsedRecruitmentAction;
      let policyOverrodePlanner = false;
      let expansionPlannerTimeoutMs: number | undefined;
      let plannerFallback: "expansion_timeout" | "expansion_output_limit" | "conclusion_output_limit" | undefined;
      let candidateSearchCursorAdjustment: { requestedOffset: number; effectiveOffset: number } | null = null;
      let candidateSearchExhausted = false;
      const plannerHistory = (decisionMode === "expand" || decisionMode === "expand_recovery"
        ? compactExpansionHistory(state.history, { includeLatestPolicyFeedback: decisionMode === "expand_recovery" })
        : decisionMode === "conclude" || decisionMode === "reorient"
          ? compactConclusionHistory(state.history, decisionConstraints?.requestedCapabilityCoverage, {
            preserveAllMethodology: decisionMode === "reorient",
          })
          : state.history).map((entry) => ({ ...entry }));
      try {
        let modelAction: RecruitmentAction;
        try {
          modelAction = await planner.decide({
            history: plannerHistory,
            dataMode: repository.mode,
            dataSource: repository.sourceName,
            targetTeam: state.targetTeam,
            decisionMode,
            confirmedPosition: state.confirmedPosition,
            positionBroadeningApproved: state.positionBroadeningApproved,
            ...(config.signal ? { signal: config.signal } : {}),
            ...(decisionConstraints ? { constraints: decisionConstraints } : {}),
            ...(expansionConstraints ? { expansionConstraints } : {}),
            ...(observer ? { onTokenUsage: (usage: RecruitmentPlannerUsageObservation) => observer({ phase: "model_usage", ...usage }) } : {}),
          });
        } catch (error) {
          if (error instanceof RecruitmentModelTimeoutError
            && (decisionMode === "expand" || decisionMode === "expand_recovery")
            && decisionConstraints
            && expansionConstraints) {
            expansionPlannerTimeoutMs = error.timeoutMs;
            plannerFallback = "expansion_timeout";
            modelAction = expansionPlannerFallback({ decisionConstraints, expansionConstraints });
            emitProgress(config, {
              stage: "planning",
              status: "notice",
              message: modelAction.action === "search_candidates"
                ? "扩页模型规划超时，系统按能力证据缺口继续读取精确下一页"
                : "扩页模型规划超时，当前可测能力已有依据，系统开始整理报告",
              completedSteps: state.decisionSteps,
            });
          } else if (error instanceof RecruitmentPlannerOutputError
            && (decisionMode === "expand" || decisionMode === "expand_recovery")
            && error.diagnostics.finishReason === "length"
            && decisionConstraints
            && expansionConstraints) {
            plannerFallback = "expansion_output_limit";
            modelAction = expansionPlannerFallback({ decisionConstraints, expansionConstraints });
            emitProgress(config, {
              stage: "planning",
              status: "notice",
              message: modelAction.action === "search_candidates"
                ? "扩页模型达到输出上限，系统按能力证据缺口继续读取精确下一页"
                : "扩页模型达到输出上限，系统按当前证据整理报告",
              completedSteps: state.decisionSteps,
            });
          } else if (error instanceof RecruitmentPlannerOutputError
            && (decisionMode === "conclude" || decisionMode === "reorient")
            && error.diagnostics.finishReason === "length"
            && decisionConstraints) {
            plannerFallback = "conclusion_output_limit";
            modelAction = conclusionPlannerOutputFallback(decisionConstraints);
            emitProgress(config, {
              stage: "planning",
              status: "notice",
              message: "报告模型达到输出上限，系统按已复核的比赛证据整理结论",
              completedSteps: state.decisionSteps,
            });
          } else {
            throw error;
          }
        }
        proposedAction = RecruitmentActionSchema.parse(modelAction);
        action = candidatePolicyMode === "enabled"
          ? applyRecruitmentCandidatePolicy(proposedAction, state)
          : proposedAction;
        if (plannerFallback) policyOverrodePlanner = true;
        if (decisionMode === "expand"
          && state.positionBroadeningApproved
          && expansionConstraints
          && asksToRepeatPositionBroadeningQuestion(action)) {
          action = RecruitmentActionSchema.parse({
            action: "search_candidates",
            targetTeam: expansionConstraints.targetTeam,
            position: expansionConstraints.position,
            playerName: expansionConstraints.playerName,
            maxAge: expansionConstraints.maxAge,
            minimumMinutes: expansionConstraints.minimumMinutes,
            competition: expansionConstraints.competition,
            season: expansionConstraints.season,
            offset: expansionConstraints.nextOffset,
            limit: 20,
          });
          policyOverrodePlanner = true;
        }
        const intentSearchObservationIndex = candidateSearchObservationIndexForIntent(
          intent,
          state.candidateSearchObservations,
          state.candidateSearchScopeChanged ? state.candidateSearchTurnStartIndex : 0,
        );
        const intentSearchIsMissing = enforceCurrentTurnObservation
          && intentSearchObservationIndex === null
          && (state.candidateSearchScopeChanged
            || state.confirmedPosition !== null
            || state.candidateSearchObservations.length > 0);
        if (intentSearchIsMissing) {
          if (!state.hasSearchedMethodology && action.action !== "search_methodology") {
            action = RecruitmentActionSchema.parse({
              action: "search_methodology",
              targetTeam: state.targetTeam,
              query: intent.position
                ? `${positionLabels[intent.position]}位置的能力画像与可观察比赛表现评估方法`
                : "当前引援需求对应的能力画像与可观察比赛表现评估方法",
              limit: 4,
            });
            policyOverrodePlanner = true;
          } else if (state.hasSearchedMethodology && action.action !== "search_candidates") {
            action = RecruitmentActionSchema.parse({
              action: "search_candidates",
              targetTeam: state.targetTeam,
              position: intent.position,
              maxAge: intent.maxAge,
              minimumMinutes: intent.minimumMinutes,
              competition: intent.competition,
              season: intent.season,
              limit: 20,
            });
            policyOverrodePlanner = true;
          }
        }
        if (action.action === "search_candidates") {
          const cursor = routeCandidateSearch(action, state, enforceCurrentTurnObservation);
          action = cursor.action;
          candidateSearchCursorAdjustment = cursor.requestedOffset === cursor.effectiveOffset
            ? null
            : { requestedOffset: cursor.requestedOffset, effectiveOffset: cursor.effectiveOffset };
          candidateSearchExhausted = cursor.exhausted;
        }
        if (action.action === "evaluate_candidates"
          && action.playerIds.length > 0
          && action.playerIds.every((playerId) => Boolean(state.evaluatedPlayers[playerId]))
          && unsearchedReportCandidates.length > 0) {
          action = RecruitmentActionSchema.parse({
            action: "search_player_reports",
            targetTeam: state.targetTeam,
            query: "已评估候选球员的球探报告、比赛观察及可引用的定性证据",
            playerNames: Object.values(eligibleEvaluatedPlayers).map(({ player }) => player.name).slice(0, 10),
            limit: 4,
          });
          policyOverrodePlanner = true;
        }
      } catch (error) {
        observer?.({ phase: "decision", action: null, decisionSource: "planner", proposedAction: null, elapsedMs: Math.round(performance.now() - decisionStartedAt), ok: false });
        throw error;
      }
      const endedTooEarly = (action.action === "ask_user" || action.action === "finish") && !state.hasInvestigated;
      const affiliationFeedback = unsupportedCurrentAffiliationFeedback(action, state.history);
      const policyFeedback = [
        ...(isToolAction(action) && state.toolUses[action.action] >= toolBudgets[action.action]
          ? [action.action === "search_candidates" && Object.keys(state.discoveredPlayers).length > 0
            ? `候选发现已达到本轮上限 ${toolBudgets.search_candidates} 次；已经找到 ${Object.keys(state.discoveredPlayers).length} 名候选。现在必须调用 evaluate_candidates，从已发现的候选 ID 中选择要分析的人；评估完成后检索报告并给出有证据的结论。不要继续搜索候选，也不要在未评估任何人的情况下 finish。`
            : `${action.action} 已达到本轮独立调用上限 ${toolBudgets[action.action]} 次，请改用其他调查动作或完成当前结论。`] : []),
        ...(action.action === "search_candidates" && candidateSearchExhausted
          ? [Object.keys(state.discoveredPlayers).length > 0
            ? "当前这组候选筛选已到最后一页。请从已发现的候选中调用 evaluate_candidates；不要重复搜索此范围，也不要未评估就 finish。"
            : "当前这组候选筛选已到最后一页且没有候选结果。请改用用户允许的其他调查范围，或说明数据覆盖不足；不要重复搜索此范围。"] : []),
        ...(action.action === "evaluate_candidates" && action.playerIds.length > 0
          && action.playerIds.every((playerId) => Boolean(state.evaluatedPlayers[playerId]))
          ? [`这些候选人已经完成比赛表现评估；evaluate_candidates 不会重复计算。请调用 search_player_reports 检索定性补充，再完成结论。`] : []),
        ...(action.action === "search_candidates" && !state.hasSearchedMethodology
          ? ["先调用 search_methodology 检索角色或战术方法资料，再执行结构化候选筛选。"] : []),
        ...(action.action === "search_player_reports" && !Object.keys(eligibleEvaluatedPlayers).length
          ? ["先完成结构化筛选并至少评估一名候选人，再检索球员报告。"] : []),
        ...(action.action === "search_player_reports" && state.hasSearchedPlayerReports && unsearchedReportCandidates.length === 0
          ? ["当前所有已评估候选人都已完成球员报告检索；不要重复调用相同范围，请继续完成报告。"] : []),
        ...(action.action === "finish" && Object.keys(eligibleEvaluatedPlayers).length > 0
          && !state.hasSearchedPlayerReports
          && state.toolUses.search_player_reports < toolBudgets.search_player_reports
          ? ["已有比赛数据评估结果；先调用 search_player_reports 检索定性补充，再完成报告。"] : []),
        ...(endedTooEarly
          ? [action.action === "ask_user" ? "先调查至少一项可用球队或球员数据，再判断是否需要用户补充。" : "先调用数据工具调查现有证据，再提交最终报告。"] : []),
        ...(affiliationFeedback ? [affiliationFeedback] : []),
        ...(decisionMode === "expand" && state.positionBroadeningApproved
          && asksToRepeatPositionBroadeningQuestion(action)
          ? ["用户已经同意扩大位置范围；不得重复征求扩围许可。请继续读取当前范围的下一页，或依据现有证据完成报告。"]
          : []),
        ...(state.hasSearchedPlayerReports
          && !Object.values(state.retrievedKnowledge).some((document) => document.corpus === "player_report")
          && claimsUnavailablePlayerReports(action)
          ? ["球员报告检索结果为零；不得声称报告中存在发现、样本或球员资料。请继续使用已验证的比赛数据，或在结论中明确报告资料缺失。"]
          : []),
        ...(action.action === "evaluate_candidates" && state.confirmedPosition
          && !action.playerIds.some((playerId) => {
            const player = state.discoveredPlayers[playerId];
            return Boolean(player && positionMatches(player.position, state.confirmedPosition!));
          })
          ? [`用户已确认位置为 ${positionLabels[state.confirmedPosition]}；先按该位置搜索候选人，不能评估其他位置的球员。`] : []),
        ...(proposedAction.action === "finish" && proposedAction.recommendations.length > 0
          && action.action === "finish" && action.recommendations.length === 0 && state.confirmedPosition
          ? [`用户已确认位置为 ${positionLabels[state.confirmedPosition]}，刚才提交的推荐都不符合该位置。请先搜索和评估该位置候选人；若确实没有样本，再用空名单并说明数据限制。`] : []),
      ];
      let policyReasonCodes = policyFeedback.map(policyBlockReasonCode);
      if (decisionMode === "expand"
        && state.positionBroadeningApproved
        && expansionConstraints
        && action.action === "ask_user"
        && policyFeedback.length > 0) {
        policyReasonCodes = policyFeedback.map(policyBlockReasonCode);
        action = RecruitmentActionSchema.parse({
          action: "search_candidates",
          targetTeam: expansionConstraints.targetTeam,
          position: expansionConstraints.position,
          playerName: expansionConstraints.playerName,
          maxAge: expansionConstraints.maxAge,
          minimumMinutes: expansionConstraints.minimumMinutes,
          competition: expansionConstraints.competition,
          season: expansionConstraints.season,
          offset: expansionConstraints.nextOffset,
          limit: 20,
        });
        policyOverrodePlanner = true;
        policyFeedback.length = 0;
      }
      const blockedByPolicy = policyFeedback.length > 0;
      const askPolicyOutcome = action.action === "ask_user" && !endedTooEarly && !blockedByPolicy
        ? askUserMode === "disabled" ? "suppressed" as const : "allowed" as const
        : undefined;
      const stateAction = askPolicyOutcome === "suppressed" && action.action === "ask_user"
        ? actionForAskPolicy(action, "disabled")
        : action;
      const sameBlockedAction = blockedByPolicy && state.policyBlocked && state.action?.action === action.action;
      const policyBlockedRepeatCount = blockedByPolicy
        ? sameBlockedAction ? state.policyBlockedRepeatCount + 1 : 1
        : 0;
      const stopRepeatedPolicyAction = sameBlockedAction && state.policyBlockedRepeatCount >= 1;
      observer?.({
        phase: "decision",
        action: action.action,
        decisionSource: policyOverrodePlanner ? "policy" : "planner",
        ...(!plannerFallback ? { proposedAction: proposedAction.action } : {}),
        ...(plannerFallback ? { plannerFallback } : {}),
        elapsedMs: Math.round(performance.now() - decisionStartedAt),
        ok: true,
        policyBlocked: blockedByPolicy,
        ...(askPolicyOutcome ? { askPolicyOutcome } : {}),
        ...(policyReasonCodes.length ? { policyReasonCodes } : {}),
        targetTeam: action.action === "inspect_team" ? action.teamName : action.targetTeam ?? state.targetTeam,
      });
      completePlanning(stopRepeatedPolicyAction
        ? "已停止重复的受约束动作，正在审核当前证据"
        : plannerFallback === "expansion_timeout" || plannerFallback === "expansion_output_limit"
          ? action.action === "search_candidates"
            ? "扩页规划未能生成动作，按证据覆盖和原有筛选条件继续调查"
            : "扩页规划未能生成动作，按当前证据覆盖完成调查"
          : plannerFallback === "conclusion_output_limit"
            ? "报告模型达到输出上限，正在按已复核证据整理结论"
          : "已完成本步调查决策，正在按用户条件和工具预算继续");
      if (stopRepeatedPolicyAction) {
        const fallback = emptyDecision(state.targetTeam);
        observer?.({
          phase: "decision",
          action: fallback.action,
          decisionSource: "policy",
          elapsedMs: 0,
          ok: true,
          policyBlocked: false,
          targetTeam: fallback.targetTeam,
        });
        return {
          action: fallback,
          decisionSteps: state.decisionSteps + 1,
          policyBlocked: false,
          policyBlockedRepeatCount: 0,
          policyLoopStopped: true,
          history: [
            { role: "assistant" as const, content: JSON.stringify(fallback) },
            { role: "tool" as const, toolName: "investigation_guard", content: "Agent 连续两次重复提出被调查策略拒绝的相同动作；已停止继续调用模型并只报告当前可验证证据。" },
          ],
        };
      }
      return {
        action: stateAction,
        decisionSteps: state.decisionSteps + 1,
        policyBlocked: blockedByPolicy,
        policyBlockedRepeatCount,
        candidateSearchCursorAdjustment,
        ...(action.targetTeam ? { targetTeam: action.targetTeam } : {}),
        ...(action.action === "ask_user" && !endedTooEarly && !blockedByPolicy ? {
          pendingQuestion: questionForAskPolicy(action, askUserMode),
          responseMessage: askUserMode === "disabled" ? askPolicyDisabledPause.question : action.question,
        } : {}),
        history: [
          { role: "assistant" as const, content: askPolicyOutcome === "suppressed"
            ? JSON.stringify({ action: "ask_user", suppressed: true })
            : JSON.stringify(action) },
          ...(askPolicyOutcome === "suppressed" ? [{
            role: "tool" as const,
            toolName: "ask_policy",
            content: "评测控制组关闭了追问能力；关键需求未解决，因此暂停并且不生成候选名单。",
          }] : []),
          ...(plannerFallback === "expansion_timeout" ? [{
            role: "tool" as const,
            toolName: "investigation_policy",
            content: action.action === "search_candidates"
              ? `扩页 Planner 在 ${Math.round((expansionPlannerTimeoutMs ?? 0) / 1000)} 秒内未返回；依据 requestedCapabilityCoverage 存在可测缺口，LangGraph 按 nextOffset=${expansionConstraints?.nextOffset ?? 0} 和原筛选条件继续一页。`
              : `扩页 Planner 在 ${Math.round((expansionPlannerTimeoutMs ?? 0) / 1000)} 秒内未返回；没有可通过分页补足的能力指标，LangGraph 以当前已验证证据收束。`,
          }] : []),
          ...(plannerFallback === "expansion_output_limit" ? [{
            role: "tool" as const,
            toolName: "investigation_policy",
            content: action.action === "search_candidates"
              ? `扩页 Planner 达到输出长度上限；依据 requestedCapabilityCoverage 存在可测缺口，LangGraph 按 nextOffset=${expansionConstraints?.nextOffset ?? 0} 和原筛选条件继续一页。`
              : "扩页 Planner 达到输出长度上限；没有可通过分页补足的能力指标，LangGraph 以当前已验证证据收束。",
          }] : []),
          ...(plannerFallback === "conclusion_output_limit" ? [{
            role: "tool" as const,
            toolName: "investigation_policy",
            content: "结论 Planner 达到输出长度上限；LangGraph 只保留已评估候选中直接对应用户可测能力的证据，报告模型未能完成的定性描述不予补写。",
          }] : []),
          ...(blockedByPolicy ? [{ role: "tool" as const, toolName: "investigation_policy", content: policyFeedback.join(" ") }] : []),
        ],
      };
    })
    .addNode("execute_tool", async (state: State, config: LangGraphRunnableConfig) => {
      throwIfTurnCancelled(config.signal);
      const action = state.action;
      if (!action || action.action === "ask_user" || action.action === "finish") {
        return { history: [{ role: "tool" as const, toolName: "agent", content: "无效的工具动作。" }] };
      }
      const intent = resolvedCandidateSearchIntent(state);
      const toolStartedAt = performance.now();
      const progressByTool: Record<ToolActionName, Pick<ProgressUpdate, "stage" | "message">> = {
        search_methodology: { stage: "methodology", message: "正在检索球员角色和评估方法" },
        inspect_team: { stage: "team_sample", message: "正在检查目标球队在数据集中的历史样本" },
        search_candidates: { stage: "candidate_search", message: "正在按当前需求搜索候选球员" },
        evaluate_candidates: {
          stage: "player_evaluation",
          message: evidenceEvaluator.availability === "experimentally_withheld"
            ? "实验对照组有意屏蔽候选球员的表现评估证据"
            : "正在计算候选球员的可观察比赛表现",
        },
        search_player_reports: { stage: "report_search", message: "正在检索候选球员的报告资料" },
      };
      emitProgress(config, { ...progressByTool[action.action], completedSteps: state.decisionSteps });
      const completeToolProgress = (message: string, status: RecruitmentProgressEventStatus = "completed") => emitProgress(config, {
        stage: progressByTool[action.action].stage,
        status,
        message,
        completedSteps: state.decisionSteps,
      });
      const eligibleEvaluatedPlayers = Object.values(evaluatedPlayersForConstraint(state));
      const alreadySearchedReportNames = new Set(state.searchedReportPlayerNames.map(normalizeSearchText));
      const reportNames = action.action === "search_player_reports"
        ? eligibleEvaluatedPlayers
          .map(({ player }) => player.name)
          .filter((name) => !alreadySearchedReportNames.has(normalizeSearchText(name)))
        : [];
      let filters: Record<string, string | number | boolean | null | string[]> = {};
      const toolUses = { ...state.toolUses, [action.action]: state.toolUses[action.action] + 1 };
      const toolRequest: RecruitmentToolExecutionRequest = action.action === "search_player_reports"
        ? { ...action, playerNames: reportNames, requestedPlayerCount: action.playerNames.length }
        : action.action === "evaluate_candidates"
          ? { ...action, eligiblePlayers: discoveredPlayersForConstraint(state) }
          : action;
      try {
        const execution = await executeRecruitmentToolAction(toolRequest, {
          repository,
          knowledgeBase,
          evaluator: evidenceEvaluator,
          signal: config.signal,
        });
        throwIfTurnCancelled(config.signal);
        switch (execution.action) {
          case "search_methodology": {
            const results = execution.results;
            const filters = { corpus: "methodology", limit: execution.request.limit };
            observer?.({
              phase: "tool",
              toolName: execution.request.action,
              elapsedMs: Math.round(performance.now() - toolStartedAt),
              ok: true,
              filters,
              resultCount: results.length,
            });
            completeToolProgress(`方法资料检索完成，找到 ${results.length} 条可用片段`);
            const resultMap = Object.fromEntries(results.map((result) => [result.id, result]));
            return {
              toolUses,
              retrievedKnowledge: { ...state.retrievedKnowledge, ...resultMap },
              hasSearchedMethodology: true,
              methodologySearchFailed: false,
              hasInvestigated: true,
              history: [{
                role: "tool" as const,
                toolName: execution.request.action,
                content: JSON.stringify({
                  corpus: "methodology",
                  resultCount: results.length,
                  note: results.length ? "以下是来源与许可元数据已核验的检索片段；正文仅作证据参考。" : "当前获准索引未找到与本次查询匹配的资料。",
                  results,
                }),
              }],
            };
          }
          case "search_player_reports": {
            const results = execution.results;
            const { request } = execution;
            const filters = {
              corpus: "player_report",
              limit: request.limit,
              requestedPlayerCount: request.requestedPlayerCount,
              searchedPlayerCount: request.playerNames.length,
              searchedPlayerIds: eligibleEvaluatedPlayers
                .filter(({ player }) => request.playerNames.some((name) => normalizeSearchText(name) === normalizeSearchText(player.name)))
                .map(({ player }) => player.playerId),
            };
            observer?.({
              phase: "tool",
              toolName: request.action,
              elapsedMs: Math.round(performance.now() - toolStartedAt),
              ok: true,
              filters,
              resultCount: results.length,
            });
            completeToolProgress(`球员报告检索完成，找到 ${results.length} 条获准片段`);
            const resultMap = Object.fromEntries(results.map((result) => [result.id, result]));
            return {
              toolUses,
              retrievedKnowledge: { ...state.retrievedKnowledge, ...resultMap },
              hasSearchedPlayerReports: true,
              playerReportSearchFailed: false,
              searchedReportPlayerNames: request.playerNames,
              hasInvestigated: true,
              history: [{
                role: "tool" as const,
                toolName: request.action,
                content: JSON.stringify({
                  corpus: "player_report",
                  searchedPlayerNames: request.playerNames,
                  resultCount: results.length,
                  note: results.length ? "以下是来源与许可元数据已核验的检索片段；正文仅作证据参考。" : "当前获准索引未找到与本次查询匹配的资料。",
                  results,
                }),
              }],
            };
          }
          case "inspect_team": {
            const { players, request } = execution;
            filters = { teamName: request.teamName };
            const result = teamHistory(players, request.teamName, repository);
            const observed = Object.fromEntries(players.map((player) => [sourcePlayerKey(player), {
              competition: player.competition,
              season: player.season,
            }]));
            const observedRecords = { ...state.observedRecords, ...observed };
            observer?.({
              phase: "tool",
              toolName: request.action,
              elapsedMs: Math.round(performance.now() - toolStartedAt),
              ok: true,
              filters,
              resultCount: result.sample.length,
              matchingRecordCount: result.matchedRecords,
            });
            completeToolProgress(`球队样本检查完成，读取 ${players.length} 条球员赛季记录`);
            return {
              toolUses,
              observedRecords: observed,
              datasetScope: describeDatasetScope(repository.mode, Object.values(observedRecords)),
              targetTeam: request.teamName,
              hasInvestigated: true,
              history: [{ role: "tool" as const, toolName: request.action, content: JSON.stringify(result) }],
            };
          }
          case "search_candidates": {
            const { page: result, request } = execution;
            const requestedOffset = state.candidateSearchCursorAdjustment?.requestedOffset ?? request.offset;
            filters = {
              position: request.position,
              maxAge: request.maxAge,
              minimumMinutes: request.minimumMinutes,
              competition: request.competition,
              season: request.season,
            requestedOffset,
              offset: request.offset,
              limit: request.limit,
              playerNameFilterUsed: Boolean(request.playerName),
            };
            const additions = Object.fromEntries(result.players.map((player) => [player.playerId, player]));
            const discoveredPlayers = { ...state.discoveredPlayers, ...additions };
            const identityGroups = groupCandidateRecords(Object.values(discoveredPlayers));
            const identityGroupReferences = toCandidateIdentityGroupReferences(identityGroups);
            const identityGroupByPlayerId = new Map(identityGroupReferences.flatMap((group) => (
              group.recordPlayerIds.map((playerId) => [playerId, group] as const)
            )));
            const candidateSummaries = result.players.map((player) => {
              const identityGroup = identityGroupByPlayerId.get(player.playerId);
              return {
              playerId: player.playerId,
              name: player.name,
              team: player.team,
              position: player.position,
              age: player.age,
              competition: player.competition,
              season: player.season,
              minutes: player.minutes,
              source: player.source,
              sourceIdentity: player.sourceIdentity ? {
                provider: player.sourceIdentity.provider,
                sourceRecordId: player.sourceIdentity.playerId,
                competitionId: player.sourceIdentity.competitionId ?? null,
                seasonId: player.sourceIdentity.seasonId ?? null,
                retrievedAt: player.sourceIdentity.retrievedAt,
              } : null,
              identityResolution: identityGroup?.status ?? "missing_source_identity",
              sameIdentitySourceRecordIds: identityGroup?.status === "resolved"
                ? identityGroup.recordPlayerIds.filter((recordId) => recordId !== player.playerId)
                : [],
            };
            });
            filters.nextOffset = result.nextOffset;
            filters.candidateIds = candidateSummaries.map((candidate) => candidate.playerId);
            observer?.({
              phase: "tool",
              toolName: request.action,
              elapsedMs: Math.round(performance.now() - toolStartedAt),
              ok: true,
              filters,
              resultCount: candidateSummaries.length,
              ...(result.totalRecords === null ? {} : { matchingRecordCount: result.totalRecords }),
            });
            completeToolProgress(result.nextOffset === null
              ? `候选搜索完成，本页发现 ${candidateSummaries.length} 人，已到当前数据范围末页`
              : `候选搜索完成，本页发现 ${candidateSummaries.length} 人，仍有后续数据页`);
            const observed = Object.fromEntries(result.players.map((player) => [sourcePlayerKey(player), {
              competition: player.competition,
              season: player.season,
            }]));
            const observedRecords = { ...state.observedRecords, ...observed };
            const reportScope = RecruitmentSearchScopeSchema.parse({
              position: request.position,
              maxAge: request.maxAge,
              minimumMinutes: request.minimumMinutes,
              competition: request.competition,
              season: request.season,
              source: intent.position
                ? request.maxAge === null && request.minimumMinutes === 0 && request.competition === null && request.season === null
                  ? "user_confirmed"
                  : "mixed"
                : "agent_interpreted",
            });
            const searchObservation: CandidateSearchObservation = {
              request: { ...request, offset: requestedOffset },
              appliedFilters: result.appliedFilters,
              actualOffset: result.offset,
              nextOffset: result.nextOffset,
              matchingRecordCount: result.totalRecords,
              discoveredSourceRecordIds: result.players.map(sourcePlayerKey),
              reportScope,
            };
            return {
              toolUses,
              datasetScope: describeDatasetScope(repository.mode, Object.values(observedRecords)),
              observedRecords: observed,
              candidateSearchObservations: [searchObservation],
              candidateSearchFailure: null,
              candidateSearchSucceededThisTurn: true,
              discoveredPlayers: additions,
              candidateIdentityGroups: identityGroupReferences,
              hasInvestigated: true,
              ...(state.confirmedPosition && request.position === state.confirmedPosition
                ? {
                  confirmedPositionSearchObservationIndex: state.candidateSearchObservations.length,
                }
                : {}),
              history: [{ role: "tool" as const, toolName: request.action, content: JSON.stringify({
                candidates: candidateSummaries,
                matchingRecords: result.totalRecords,
                matchingRecordCountKnown: result.totalRecords !== null,
                appliedFilters: result.appliedFilters,
                offset: result.offset,
                nextOffset: result.nextOffset,
                requestedOffset,
                paginationNote: result.nextOffset === null
                  ? "当前筛选已到最后一页。请评估已经发现的候选人，或在用户允许时调整筛选；不要重复读取此页。"
                  : `本次实际读取 offset=${result.offset}。若需要更多候选，下一页必须使用返回的 nextOffset=${result.nextOffset}，不要重复或跳过页码。`,
                ...(result.totalRecords === null ? { totalCountNote: "数据源未提供精确匹配总数；matchingRecords 为 null，不代表没有其他匹配球员。" } : {}),
                identityNote: "只有同一稳定 Reep ID 的精确映射才表示这些来源记录属于同一候选人；其他状态的记录保持独立。已关联的来源记录仍分别评估和引用，不会混合不同来源的指标。",
              }) }],
            };
          }
          case "evaluate_candidates": {
            const { batch, request } = execution;
            const result = batch.evaluations;
            filters = {
              requestedPlayerCount: request.playerIds.length,
              evidenceAvailability: evidenceEvaluator.availability,
            };
            filters.evaluatedPlayerIds = Object.keys(result);
            filters.evaluatedMetricKeys = [...new Set(Object.values(result).flatMap(({ evidence }) => (
              evidence.map(({ key }) => key)
            )))];
            filters.evaluatedMetricValueCount = Object.values(result).reduce((count, candidate) => (
              count + candidate.evidence.length
            ), 0);
            observer?.({
              phase: "tool",
              toolName: request.action,
              elapsedMs: Math.round(performance.now() - toolStartedAt),
              ok: true,
              filters,
              resultCount: Object.keys(result).length,
            });
            completeToolProgress(
              evidenceEvaluator.availability === "experimentally_withheld"
                ? `实验对照组已屏蔽表现评估证据；保留 ${Object.keys(result).length} 名候选身份，不表示零分`
                : `表现评估完成，已评估 ${Object.keys(result).length} 名候选球员`,
            );
            const missing = request.playerIds.filter((id) => !result[id]);
            const toolResult = {
              evaluations: Object.values(result).map(({ player, evidence }) => ({
                playerId: player.playerId,
                name: player.name,
                position: player.position,
                competition: player.competition,
                season: player.season,
                minutes: player.minutes,
                source: player.source,
                metrics: evidence,
              })),
              missingPlayerIds: missing,
              evidenceAvailability: evidenceEvaluator.availability,
              note: evidenceEvaluator.availability === "experimentally_withheld"
                ? "本实验控制组有意屏蔽了候选表现评估器。未返回指标、百分位或能力评分；这不是 0 值，也不表示来源缺字段或球员没有该项能力。"
                : "只返回可观察比赛产出。缺失事件文件时不会把动作记为零；没有传球尝试时省略传球成功率。百分位仅在同位置、同赛事、同赛季至少 5 个完整样本时提供。",
            };
            const observed = Object.fromEntries(batch.observedPlayers.map((player) => [sourcePlayerKey(player), {
              competition: player.competition,
              season: player.season,
            }]));
            const observedRecords = { ...state.observedRecords, ...observed };
            return {
              toolUses,
              evaluatedPlayers: result,
              evidenceEvaluationWithheld: evidenceEvaluator.availability === "experimentally_withheld",
              observedRecords: observed,
              datasetScope: describeDatasetScope(repository.mode, Object.values(observedRecords)),
              hasInvestigated: true,
              history: [{ role: "tool" as const, toolName: request.action, content: JSON.stringify(toolResult) }],
            };
          }
          default: {
            const exhaustive: never = execution;
            throw new Error(`Unsupported recruitment tool result: ${JSON.stringify(exhaustive)}`);
          }
        }
      } catch (error) {
        throwIfTurnCancelled(config.signal);
        if (error instanceof RecruitmentTurnCancelledError) throw error;
        observer?.({
          phase: "tool",
          toolName: action.action,
          elapsedMs: Math.round(performance.now() - toolStartedAt),
          ok: false,
          filters,
          resultCount: 0,
        });
        completeToolProgress("这项查询没有成功，Agent 正在判断是否有其他调查路径", "notice");
        const failure = safeToolFailure(error);
        const { message, code } = failure;
        return {
          toolUses,
          hasInvestigated: true,
          ...(action.action === "search_methodology" ? { hasSearchedMethodology: true, methodologySearchFailed: true } : {}),
          ...(action.action === "search_player_reports" ? { hasSearchedPlayerReports: true, playerReportSearchFailed: true } : {}),
          ...(action.action === "search_player_reports" ? { searchedReportPlayerNames: reportNames } : {}),
          ...(["fbref", "fpl", "premier_league", "asa", "understat", "mosaic"].includes(repository.mode) && (code === "blocked" || code === "rate_limit")
            ? { sourceAccessFailure: { code, message } }
            : {}),
          ...(action.action === "search_candidates" ? { candidateSearchFailure: failure } : {}),
          history: [{ role: "tool" as const, toolName: action.action, content: JSON.stringify({
            error: message,
            ...(code ? { errorCode: code } : {}),
          }) }],
        };
      }
    })
    .addNode("wait_for_user", (state: State) => {
      const pendingQuestion = state.pendingQuestion;
      if (!pendingQuestion) {
        return new Command({ goto: "choose_next_action" });
      }
      const answer = interrupt({ question: pendingQuestion.question, reason: pendingQuestion.reason });
      const answerText = String(answer);
      const answerIntent = resolvedCandidateSearchIntent({
        ...state,
        history: [...state.history, { role: "user", content: answerText }],
      }, answerText);
      const positionChange = answerIntent.latestPositionChange;
      const searchScopeChanged = hasCandidateSearchScopeChanged(state.history, answerText, state.confirmedPosition);
      const priorCandidateSearchIndex = !searchScopeChanged && positionChange.changed && answerIntent.position !== null
        ? candidateSearchObservationIndexForIntent(answerIntent, state.candidateSearchObservations)
        : null;
      const answeredEmptyPositionQuestion = state.confirmedPositionNoMatchQuestionAsked;
      return new Command({
        update: {
          history: [{ role: "user" as const, content: answerText }],
          candidateSearchTurnStartIndex: state.candidateSearchObservations.length,
          candidateSearchScopeChanged: searchScopeChanged,
          pendingQuestion: null,
          responseMessage: "",
          decisionSteps: 0,
          toolUses: emptyToolUseCounts(),
          confirmedPositionSearchObservationIndex: positionChange.changed
            ? priorCandidateSearchIndex
            : state.confirmedPositionSearchObservationIndex,
          confirmedPositionNoMatchQuestionAsked: positionChange.changed ? false : state.confirmedPositionNoMatchQuestionAsked,
          confirmedPositionNoMatchDeclined: answeredEmptyPositionQuestion && !positionChange.changed,
          candidateSearchSucceededThisTurn: false,
          positionBroadeningApproved: answeredEmptyPositionQuestion && positionChange.changed
            ? true
            : positionChange.changed ? false : state.positionBroadeningApproved,
          ...(positionChange.changed ? { confirmedPosition: positionChange.position } : {}),
        },
        goto: "choose_next_action",
      });
    })
    .addNode("review_recommendation", (state: State, config: LangGraphRunnableConfig) => {
      const reviewStartedAt = performance.now();
      const recordReview = (event: Omit<Extract<RecruitmentTraceEvent, { phase: "review" }>, "elapsedMs">) => {
        observer?.({ ...event, elapsedMs: Math.round(performance.now() - reviewStartedAt) });
      };
      if (reviewerMode === "bypassed") {
        emitProgress(config, {
          stage: "review",
          status: "notice",
          message: "当前评测实验臂跳过确定性证据复核",
          completedSteps: state.decisionSteps,
        });
        recordReview({ phase: "review", mode: reviewerMode, outcome: "bypassed" });
        return { reviewResult: "bypassed" as const };
      }

      emitProgress(config, { stage: "review", message: "正在核对推荐是否有对应的数据证据", completedSteps: state.decisionSteps });
      const alignment = alignRecommendationEvidenceToRequestedCapabilities({
        action: state.action,
        userMessages: userMessages(state.history),
        evaluatedPlayers: state.evaluatedPlayers,
      });
      const problems = validateConclusion({
        action: alignment.action,
        confirmedPosition: state.confirmedPosition,
        userMessages: userMessages(state.history),
        evaluatedPlayers: state.evaluatedPlayers,
        retrievedKnowledge: state.retrievedKnowledge,
        candidateIdentityGroups: state.candidateIdentityGroups,
      });
      if (!problems.length) {
        emitProgress(config, {
          stage: "review",
          status: "completed",
          message: alignment.repairedReferenceCount > 0
            ? "已将推荐证据对齐到本轮观察到的相关指标，复核通过"
            : "证据复核通过，推荐内容与本轮已评估资料相符",
          completedSteps: state.decisionSteps,
        });
        recordReview({
          phase: "review",
          mode: reviewerMode,
          outcome: "passed",
          problemCount: 0,
          repairedEvidenceReferenceCount: alignment.repairedReferenceCount,
        });
        return { action: alignment.action, reviewResult: "valid" as const };
      }
      if (state.reviewAttempts < 1) {
        emitProgress(config, {
          stage: "review",
          status: "notice",
          message: "证据复核发现需要补查的部分，Agent 将再调查一次",
          completedSteps: state.decisionSteps,
        });
        recordReview({
          phase: "review",
          mode: reviewerMode,
          outcome: "retry",
          problemCount: problems.length,
          repairedEvidenceReferenceCount: alignment.repairedReferenceCount,
        });
        return {
          action: alignment.action,
          reviewAttempts: state.reviewAttempts + 1,
          reviewResult: "retry" as const,
          history: [{ role: "tool" as const, toolName: "evidence_review", content: JSON.stringify({ problems }) }],
        };
      }
      emitProgress(config, {
        stage: "review",
        status: "notice",
        message: "补查后仍存在证据缺口，最终报告会收窄推荐并说明限制",
        completedSteps: state.decisionSteps,
      });
      recordReview({
        phase: "review",
        mode: reviewerMode,
        outcome: "exhausted",
        problemCount: problems.length,
        repairedEvidenceReferenceCount: alignment.repairedReferenceCount,
      });
      return { action: alignment.action, reviewResult: "exhausted" as const };
    })
    .addNode("enrich_external_signals", async (state: State, config: LangGraphRunnableConfig) => {
      if (!playerEloSetup.client || state.action?.action !== "finish") {
        return { externalSignalCoverage: disabledPlayerEloCoverage };
      }
      const eligibleEvaluatedPlayers = evaluatedPlayersForConstraint(state);
      const players = state.action.recommendations.flatMap(({ playerId }) => {
        const candidate = eligibleEvaluatedPlayers[playerId];
        return candidate ? [candidate.player] : [];
      });
      if (!players.length) return { externalSignalCoverage: disabledPlayerEloCoverage };

      emitProgress(config, {
        stage: "external_signal",
        message: `正在核对 ${players.length} 名推荐球员的独立外部表现信号`,
        completedSteps: state.decisionSteps,
      });
      const result = await enrichPlayerEloSignals(playerEloSetup.client, players, { signal: config.signal });
      throwIfTurnCancelled(config.signal);
      const successfulLookups = result.checkedCandidates - result.failedCandidates;
      emitProgress(config, {
        stage: "external_signal",
        status: result.failedCandidates ? "notice" : "completed",
        message: `外部表现信号核对完成，匹配到 ${result.matchedCandidates} 名候选${result.failedCandidates ? `，另有 ${result.failedCandidates} 次查询未成功` : ""}`,
        completedSteps: state.decisionSteps,
      });
      return {
        externalSignals: result.signalsByPlayerId,
        externalSignalCoverage: {
          status: result.failedCandidates === 0 ? "complete" : successfulLookups > 0 ? "partial" : "failed",
          disabledReason: null,
          identityUnavailableCandidates: result.identityUnavailableCandidates,
          directIdentityCandidates: result.directIdentityCandidates,
          crosswalkIdentityCandidates: result.crosswalkIdentityCandidates,
          checkedCandidates: result.checkedCandidates,
          matchedCandidates: result.matchedCandidates,
          failedCandidates: result.failedCandidates,
        } satisfies ExternalSignalCoverage,
      };
    })
    .addNode("enrich_historical_archive", async (state: State, config: LangGraphRunnableConfig) => {
      if (repository.mode === "wyscout") {
        return {
          historicalArchiveCoverage: {
            ...historicalArchiveSetup.coverage,
            status: "disabled" as const,
            disabledReason: "primary_source_is_archive" as const,
          },
        };
      }
      if (historicalArchiveSetup.status !== "ready" || state.action?.action !== "finish") {
        return { historicalArchiveCoverage: historicalArchiveSetup.coverage };
      }
      const eligibleEvaluatedPlayers = evaluatedPlayersForConstraint(state);
      const players = Object.values(eligibleEvaluatedPlayers).map(({ player }) => player);
      if (!players.length) return { historicalArchiveCoverage: historicalArchiveSetup.coverage };

      emitProgress(config, {
        stage: "historical_archive",
        message: `正在用 Reep 精确身份映射核对 ${players.length} 名候选的 Wyscout 历史样本`,
        completedSteps: state.decisionSteps,
      });
      const result = await historicalArchiveSetup.enrich(players);
      throwIfTurnCancelled(config.signal);
      const historicalSampleCount = Object.values(result.samplesByPlayerId).reduce((count, samples) => count + samples.length, 0);
      emitProgress(config, {
        stage: "historical_archive",
        status: result.coverage.status === "complete" ? "completed" : "notice",
        message: `跨来源历史样本核对完成，找到 ${historicalSampleCount} 条可追溯记录`,
        completedSteps: state.decisionSteps,
      });
      return {
        historicalArchiveSamplesByPlayerId: result.samplesByPlayerId,
        historicalArchiveCoverage: result.coverage,
      };
    })
    .addNode("deliver_recommendation", (state: State) => {
      const action = state.action?.action === "finish" ? state.action : emptyDecision(state.targetTeam);
      const eligibleEvaluatedPlayers = evaluatedPlayersForConstraint(state);
      const candidateIdentityGroups = candidateIdentityGroupReferencesFor(state);
      const candidateIdentityCoverage = summarizeCandidateIdentityGroupReferences(candidateIdentityGroups);
      const identityGroupForPlayer = (playerId: string) => candidateIdentityGroups.find((group) => group.recordPlayerIds.includes(playerId));
      const discoveredForConstraint = discoveredPlayersForConstraint(state);
      const discoveredForConstraintIds = new Set(discoveredForConstraint.map(({ playerId }) => playerId));
      const evaluatedForConstraintById = new Map(Object.values(eligibleEvaluatedPlayers).map((candidate) => [candidate.player.playerId, candidate]));
      const requestedEvidenceAreas = requestedCapabilityEvidenceAreas(userMessages(state.history));
      const recommendations = state.reviewResult === "exhausted" ? [] : action.recommendations
        .filter((item) => Object.hasOwn(eligibleEvaluatedPlayers, item.playerId))
        .map((item) => {
        const evaluated = eligibleEvaluatedPlayers[item.playerId]!;
        const identityGroup = identityGroupForPlayer(item.playerId);
        const sourceRecordIds = identityGroup?.recordPlayerIds ?? [item.playerId];
        const sourceEvidenceRecords = sourceRecordIds
          .filter((sourceRecordId) => sourceRecordId !== item.playerId && discoveredForConstraintIds.has(sourceRecordId))
          .flatMap((sourceRecordId) => {
            const sourcePlayer = state.discoveredPlayers[sourceRecordId];
            if (!sourcePlayer) return [];
            const sourceEvaluation = evaluatedForConstraintById.get(sourceRecordId);
            return [{
              sourceRecordId: sourcePlayer.sourceIdentity?.playerId ?? sourcePlayer.playerId,
              source: sourcePlayer.source,
              provider: sourcePlayer.sourceIdentity?.provider ?? sourcePlayer.source,
              team: sourcePlayer.team,
              competition: sourcePlayer.competition,
              season: sourcePlayer.season,
              retrievedAt: sourcePlayer.sourceIdentity?.retrievedAt ?? null,
              minutes: sourcePlayer.minutes,
              evaluated: Boolean(sourceEvaluation),
              ...(sourcePlayer.sourceUrl ? { sourceUrl: sourcePlayer.sourceUrl } : {}),
              evidence: sourceEvaluation?.evidence ?? [],
            }];
          });
        const focusEvidence = evaluated.evidence.filter((evidence) => item.evidenceKeys.includes(evidence.key));
        const tradeoffs = [
          ...(evaluated.player.minutes < minimumMinutesForPercentileComparison
            || evaluated.evidence.some((evidence) => evidence.minutes !== null
              && evidence.minutes < minimumMinutesForPercentileComparison)
            ? [`部分出场或指标样本少于 ${minimumMinutesForPercentileComparison} 分钟，每 90 分钟数据可能受小样本影响；对应指标不显示百分位。`]
            : []),
          ...(evaluated.evidence.some((evidence) => evidence.peerPercentileUnavailableReason === "insufficient_peer_group")
            ? [`部分指标达到 ${minimumMinutesForPercentileComparison} 分钟门槛的同位置、同赛事、同赛季比较组不足 5 人，无法显示百分位。`]
            : []),
          ...(evaluated.evidence.some((evidence) => evidence.peerPercentileUnavailableReason === "candidate_sample_unknown")
            ? ["部分指标的来源样本分钟未知，无法核实百分位比较门槛。"]
            : []),
          ...requestedEvidenceAreas.flatMap((area) => evaluated.evidence.some((evidence) => area.metricKeys.includes(evidence.key))
            ? []
            : [`该候选缺少用户要求的“${area.name}”对应指标；当前依据不表示其已具备该项能力。`]),
          ...(repository.mode === "demo" ? ["虚构演示数据不能支持真实引援判断。"] : []),
          "事件统计不能替代完整比赛录像、角色背景和球探复核。",
        ];
        return {
          player: evaluated.player,
          identityResolution: {
            status: identityGroup?.status ?? "missing_source_identity" as const,
            releaseStamp: identityGroup?.releaseStamp ?? null,
            sourceRecordCount: sourceRecordIds.length,
          },
          sourceEvidenceRecords,
          rationale: `本轮重点依据：${focusEvidence.map((evidence) => evidenceEvaluator.describe(evidence)).join(" ")}这表示建议继续研究，不代表已验证适合转会。`,
          strengths: focusEvidence.map((evidence) => evidenceEvaluator.describe(evidence)),
          tradeoffs,
          focusEvidenceKeys: item.evidenceKeys,
          evidence: evaluated.evidence,
          externalSignals: state.externalSignals[item.playerId] ? [state.externalSignals[item.playerId]!] : [],
          historicalArchiveSamples: state.historicalArchiveSamplesByPlayerId[item.playerId] ?? [],
          reportObservations: action.reportObservations.filter((observation) => observation.playerId === item.playerId
            && Object.hasOwn(eligibleEvaluatedPlayers, observation.playerId)).flatMap((observation) => {
            const document = Object.values(state.retrievedKnowledge).find((candidate) => candidate.documentId === observation.documentId);
            if (!document) return [];
            return [{
              summary: observation.summary,
              verificationStatus: observation.linkedMetricKeys.length ? "linked_to_match_data" as const : "unverified" as const,
              linkedMetricKeys: observation.linkedMetricKeys,
              source: {
                sourceId: document.sourceId,
                sourceName: document.sourceName,
                title: document.title,
                url: document.url,
                author: document.author,
                publisher: document.publisher,
                publishedAt: document.publishedAt,
                license: document.license,
                attribution: document.attribution,
              },
            }];
          }),
        };
      });
      const recommendedPlayerIds = new Set(recommendations.map(({ player }) => player.playerId));
      const historicalArchiveCandidates = Object.entries(state.historicalArchiveSamplesByPlayerId).flatMap(([playerId, samples]) => {
        const evaluated = eligibleEvaluatedPlayers[playerId];
        if (!evaluated || recommendedPlayerIds.has(playerId) || samples.length === 0) return [];
        return [{ player: evaluated.player, samples }];
      });
      const retrievedDocuments = Object.values(state.retrievedKnowledge);
      const requestedCapabilityCoverage = summarizeRequestedCapabilityCoverage({
        userMessages: userMessages(state.history),
        evaluatedPlayers: Object.values(eligibleEvaluatedPlayers),
        candidateIdentityGroups,
      });
      const evaluatedIdentityKeys = new Set(Object.values(eligibleEvaluatedPlayers).map(({ player }) => (
        identityGroupForPlayer(player.playerId)?.identityKey ?? `source:${sourcePlayerKey(player)}`
      )));
      const lowSampleIdentityKeys = new Set(Object.values(eligibleEvaluatedPlayers).filter(hasLowSampleEvidence).map(({ player }) => (
        identityGroupForPlayer(player.playerId)?.identityKey ?? `source:${sourcePlayerKey(player)}`
      )));
      const limitedPeerGroupIdentityKeys = new Set(Object.values(eligibleEvaluatedPlayers).filter((candidate) => candidate.evidence.some(
        (evidence) => evidence.peerPercentileUnavailableReason === "insufficient_peer_group",
      )).map(({ player }) => identityGroupForPlayer(player.playerId)?.identityKey ?? `source:${sourcePlayerKey(player)}`));
      const searchScopes = [...new Map(state.candidateSearchObservations.map(({ reportScope }) => (
        [JSON.stringify(reportScope), reportScope] as const
      ))).values()];
      const report = RecruitmentReportSchema.parse({
        targetTeam: action.targetTeam ?? state.targetTeam,
        needSummary: state.candidateSearchFailure && !state.candidateSearchSucceededThisTurn
          ? `${repository.sourceName} 候选查询最近一次失败，当前无法确认匹配结果。`
          : action.needSummary,
        capabilityProfile: action.capabilityProfile,
        requestedCapabilityCoverage: state.evidenceEvaluationWithheld ? [] : requestedCapabilityCoverage,
        searchScopes,
        evidenceCoverage: (() => {
          const evaluated = Object.values(eligibleEvaluatedPlayers);
          const reportedEvaluations = state.evidenceEvaluationWithheld ? [] : evaluated;
          return {
            evidenceAvailability: state.evidenceEvaluationWithheld ? "experimentally_withheld" : "available",
            evaluatedCandidateCount: state.evidenceEvaluationWithheld ? 0 : evaluatedIdentityKeys.size,
            evaluatedSourceRecordCount: reportedEvaluations.length,
            availableMetricValues: reportedEvaluations.reduce((total, item) => total + item.evidence.length, 0),
            expectedMetricValues: reportedEvaluations.reduce((sum, candidate) => sum + evidenceEvaluator.coverage(candidate).expectedMetricCount, 0),
            lowSampleCandidates: state.evidenceEvaluationWithheld ? 0 : lowSampleIdentityKeys.size,
            limitedPeerGroupCandidates: state.evidenceEvaluationWithheld ? 0 : limitedPeerGroupIdentityKeys.size,
          };
        })(),
        externalSignalCoverage: state.externalSignalCoverage,
        historicalArchiveCoverage: state.historicalArchiveCoverage,
        historicalArchiveCandidates,
        candidateIdentityCoverage,
        knowledgeCoverage: {
          methodologyChunksRetrieved: retrievedDocuments.filter((document) => document.corpus === "methodology").length,
          methodologySearchFailed: state.methodologySearchFailed,
          methodologySources: collectMethodologySourceReferences(retrievedDocuments),
          playerReportSearchPerformed: state.hasSearchedPlayerReports,
          playerReportSearchFailed: state.playerReportSearchFailed,
          playerReportChunksRetrieved: retrievedDocuments.filter((document) => document.corpus === "player_report").length,
        },
        recommendations,
        limitations: limitationsFor(state, repository, action, evidenceEvaluator),
        dataSource: repository.sourceName,
        datasetMode: repository.mode,
        datasetScope: state.datasetScope ?? describeDatasetScope(repository.mode),
      });
      const responseMessage = state.sourceAccessFailure
        ? `${repository.sourceName} 的数据请求被拒绝（${state.sourceAccessFailure.code === "blocked" ? "HTTP 403" : "HTTP 429"}）。本轮无法读取球员数据；这不代表没有符合条件的球员。`
        : state.candidateSearchFailure && !state.candidateSearchSucceededThisTurn
          ? `${repository.sourceName} 候选查询最近一次失败，当前无法确认是否有符合条件的球员；这不代表没有匹配球员。`
        : recommendations.length
          ? "已完成一轮调查。名单顺序表示 Agent 建议优先继续考察的顺序，不是经过验证的综合能力排名。"
          : "已完成一轮调查，但当前证据不足以支持具体候选推荐。";
      return { report, responseMessage, pendingQuestion: null };
    })
    .addEdge(START, "record_user_turn")
    .addEdge("record_user_turn", "choose_next_action")
    .addConditionalEdges("choose_next_action", (state: State) => {
      if (state.forcedLimitReached || state.policyLoopStopped) return "review";
      if (state.policyBlocked) return "replan";
      if (state.action?.action === "ask_user" || state.action?.action === "finish") {
        if (!state.hasInvestigated) return "replan";
        return state.action.action === "ask_user" ? "ask" : "review";
      }
      return "tool";
    }, { ask: "wait_for_user", replan: "choose_next_action", review: "review_recommendation", tool: "execute_tool" })
    .addEdge("execute_tool", "choose_next_action")
    .addConditionalEdges("review_recommendation", (state: State) => {
      if (state.reviewResult === "retry") return "retry";
      if ((state.reviewResult === "valid" || state.reviewResult === "bypassed")
        && state.action?.action === "finish"
        && state.action.recommendations.length > 0) {
        return playerEloSetup.client ? "enrich_external" : "enrich_archive";
      }
      return "deliver";
    }, {
      retry: "choose_next_action",
      enrich_external: "enrich_external_signals",
      enrich_archive: "enrich_historical_archive",
      deliver: "deliver_recommendation",
    })
    .addEdge("enrich_external_signals", "enrich_historical_archive")
    .addEdge("enrich_historical_archive", "deliver_recommendation")
    .addEdge("deliver_recommendation", END)
    .compile({ checkpointer: input.checkpointer ?? new MemorySaver() });

  const recursionLimit = maxDecisionsPerTurn * 5 + 10;
  const turn = createRecruitmentTurnRuntime({
    assertTurnAllowed: () => assertRepositoryModelProcessingAllowed(repository),
    createExpiredStateError: () => new RecruitmentCaseStateExpiredError(),
    graph: {
      async getCheckpoint(threadId) {
        const snapshot = await workflow.getState({
          configurable: { thread_id: threadId },
          recursionLimit,
        });
        const state = snapshot.values as State | undefined;
        return {
          values: state ? {
            pendingQuestion: state.pendingQuestion,
            responseMessage: state.responseMessage,
            report: state.report,
          } : undefined,
          tasks: snapshot.tasks.map((task) => ({ interrupts: task.interrupts })),
        };
      },
      async run({ threadId, message, resume, signal }) {
        const streamOptions = {
          configurable: { thread_id: threadId },
          recursionLimit,
          version: "v3" as const,
          streamMode: ["custom"] as ("custom")[],
          transformers: [recruitmentProgressTransformer] as const,
          ...(signal ? { signal } : {}),
        };
        if (resume) {
          const graphStream = await workflow.streamEvents(new Command({ resume: message }), streamOptions);
          return graphStream;
        }
        const graphStream = await workflow.streamEvents({ userMessage: message }, streamOptions);
        return graphStream;
      },
    },
  });
  return { turn };
}

export interface ConfiguredRecruitmentConversationOptions {
  repository: PlayerRepository;
  knowledgeBase?: KnowledgeRepository;
  observer?: RecruitmentTraceObserver;
  checkpointer?: BaseCheckpointSaver;
  experimentalReviewerMode?: RecruitmentReviewerMode;
  experimentalAskUserMode?: RecruitmentAskUserMode;
  plannerFactory?: () => RecruitmentPlanner;
  evidenceEvaluator?: RecruitmentEvidenceEvaluator;
}

export function configuredRecruitmentConversation(
  options: ConfiguredRecruitmentConversationOptions,
): RecruitmentConversation {
  const {
    repository,
    knowledgeBase,
    observer,
    checkpointer,
    experimentalReviewerMode = "enabled",
    experimentalAskUserMode = "enabled",
    plannerFactory = createRecruitmentPlanner,
    evidenceEvaluator,
  } = options;
  try {
    return createRecruitmentConversation({
      repository,
      planner: plannerFactory(),
      candidateIdentityGrouper: groupCandidatesWithConfiguredReepIndex,
      knowledgeBase,
      observer,
      checkpointer,
      experimentalReviewerMode,
      experimentalAskUserMode,
      ...(evidenceEvaluator ? { evidenceEvaluator } : {}),
    });
  } catch (error) {
    if (error instanceof RecruitmentModelUnavailableError) return unavailableRecruitmentConversation();
    throw error;
  }
}

export function unavailableRecruitmentConversation(): RecruitmentConversation {
  return {
    async turn() {
      throw new RecruitmentModelUnavailableError();
    },
  };
}
