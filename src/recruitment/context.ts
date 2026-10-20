import type { ConversationHistoryEntry } from "./planner-context.js";
import { DEFAULT_CONTEXT_COMPACTION_RATIO, DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS } from "./chat-model.js";
import { createHash } from "node:crypto";

export type RecruitmentContextStage = "understand" | "investigate" | "expand" | "expand_recovery" | "reorient" | "conclude";

export interface RecruitmentContextManifest {
  version: 5;
  stage: RecruitmentContextStage;
  requestBytes: number;
  componentBytes: { system: number; payload: number; schema: number; framing: number };
  requestFingerprint: string;
  promptFingerprint: string;
  payloadFingerprint: string;
  schemaFingerprint: string;
  caseRevisionFingerprint: string | null;
  includedHistoryEventIds: string[];
  omittedHistoryEventIds: string[];
  estimatedInputTokens: number;
  estimateMethod: "wire-utf8-bytes-divided-by-three-plus-15-percent" | "codex-gpt-6-luna-stage-calibrated-v1";
  /** Configured hard input limit after output and safety reserves; null when unknown. */
  hardInputLimitTokens: number | null;
  /** @deprecated Telemetry compatibility alias for hardInputLimitTokens. */
  inputBudgetTokens: number | null;
  compactionThresholdTokens: number | null;
  compactionRatio: number;
  outputBudgetTokens: number;
  safetyMarginTokens: number;
  contextWindowTokens: number | null;
  status: "within_budget" | "over_budget" | "unknown";
  budgetStrategy: "assembled" | "conclusion_candidate_batch" | "planner_protocol_retry";
  exceedsVerifiedWindow: boolean;
  exceedsCompactionThreshold: boolean;
  /** @deprecated Alias of exceedsCompactionThreshold. */
  exceedsSoftTarget: boolean;
  omittedHistoryEntries: number;
  protectedQuoteCount: number;
  actualTokenUsage?: {
    status: "reported" | "partial" | "unavailable";
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
}

export interface BuildRecruitmentContextInput {
  stage: RecruitmentContextStage;
  systemInstructions: string;
  payload: unknown;
  responseSchema: unknown;
  outputBudgetTokens: number;
  contextWindowTokens?: number;
  compactionRatio?: number;
  safetyMarginTokens?: number;
  omittedHistoryEntries?: number;
  protectedQuoteCount?: number;
  contextRevision?: string;
  includedHistoryEventIds?: readonly string[];
  omittedHistoryEventIds?: readonly string[];
  budgetStrategy?: RecruitmentContextManifest["budgetStrategy"];
}

export interface RecruitmentContextRequest {
  messages: [{ role: "system"; content: string }, { role: "human"; content: string }];
  manifest: RecruitmentContextManifest;
}

export class RecruitmentContextCapacityError extends Error {
  constructor(
    readonly stage: RecruitmentContextStage,
    readonly estimatedInputTokens: number,
    readonly inputBudgetTokens: number | null,
    readonly contextWindowTokens: number | null,
    readonly outputBudgetTokens: number,
    readonly safetyMarginTokens: number,
    readonly providerRejectedAfterCompaction = false,
  ) {
    const hardLimit = inputBudgetTokens === null ? "未配置有效的模型上下文窗口" : `硬输入限额约 ${inputBudgetTokens} token`;
    const cause = providerRejectedAfterCompaction
      ? "模型服务在自动整理对话后仍拒绝了请求"
      : `自动整理后请求仍超出${hardLimit}`;
    const runtimeWindow = contextWindowTokens === null ? "运行实例没有配置模型上下文窗口"
      : `运行实例配置的上下文窗口为 ${contextWindowTokens} token`;
    super(`${stage} 任务暂时无法继续：${cause}（输入估算约 ${estimatedInputTokens} token；${runtimeWindow}，预留输出 ${outputBudgetTokens} token、误差余量 ${safetyMarginTokens} token）。案件进度和原始对话已保留；可以在同一案件继续，无需删除案件或从头开始。`);
    this.name = "RecruitmentContextCapacityError";
  }
}

export function assertRecruitmentContextFits(request: RecruitmentContextRequest): void {
  if (request.manifest.exceedsVerifiedWindow) {
    throw new RecruitmentContextCapacityError(
      request.manifest.stage,
      request.manifest.estimatedInputTokens,
      request.manifest.inputBudgetTokens,
      request.manifest.contextWindowTokens,
      request.manifest.outputBudgetTokens,
      request.manifest.safetyMarginTokens,
    );
  }
}

/**
 * A deliberately conservative, provider-neutral estimate. It is diagnostic,
 * not a claim to reproduce any model tokenizer. Provider usage remains the
 * source of truth when available.
 */
export function estimateRecruitmentInputTokens(value: string): number {
  const rawEstimate = Buffer.byteLength(value, "utf8") / 3;
  return Math.ceil(rawEstimate * 1.15) + 8;
}

export function withContextModelUsage(
  manifest: RecruitmentContextManifest,
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
): RecruitmentContextManifest {
  const reported = [usage.inputTokens, usage.outputTokens, usage.totalTokens].map(value =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);
  const presentCount = reported.filter(value => value !== null).length;
  return {
    ...manifest,
    actualTokenUsage: {
      status: presentCount === 3 ? "reported" : presentCount > 0 ? "partial" : "unavailable",
      inputTokens: reported[0]!,
      outputTokens: reported[1]!,
      totalTokens: reported[2]!,
    },
  };
}

export function buildRecruitmentContext(input: BuildRecruitmentContextInput): RecruitmentContextRequest {
  const payload = JSON.stringify(input.payload);
  const schema = JSON.stringify(input.responseSchema);
  const humanContent = `案件上下文（${input.stage}）：\n${payload}`;
  const messages: RecruitmentContextRequest["messages"] = [
    { role: "system", content: input.systemInstructions },
    { role: "human", content: humanContent },
  ];
  const wireView = JSON.stringify([...messages, { response_schema: schema }]);
  const requestBytes = Buffer.byteLength(wireView, "utf8");
  const systemBytes = serializedContentBytes(input.systemInstructions);
  const payloadBytes = serializedContentBytes(payload);
  const schemaBytes = serializedContentBytes(schema);
  // The provider receives the response schema/tool definitions with the
  // messages. They consume model context even though they are not chat turns.
  const baseEstimatedInputTokens = estimateRecruitmentInputTokens(wireView);
  const usesMeasuredLunaCalibration = process.env.OPENAI_MODEL?.trim().toLowerCase() === "codex/gpt-6-luna";
  const estimatedInputTokens = usesMeasuredLunaCalibration
    ? Math.ceil(baseEstimatedInputTokens * measuredStageCalibrationFactor(input.stage))
    : baseEstimatedInputTokens;
  const outputBudgetTokens = Math.max(0, Math.floor(input.outputBudgetTokens));
  const safetyMarginTokens = input.safetyMarginTokens ?? DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS;
  const hardInputLimitTokens = input.contextWindowTokens === undefined
    ? null
    : Math.max(0, input.contextWindowTokens - outputBudgetTokens - safetyMarginTokens);
  const compactionRatio = input.compactionRatio ?? DEFAULT_CONTEXT_COMPACTION_RATIO;
  const compactionThresholdTokens = hardInputLimitTokens === null
    ? null
    : Math.floor(hardInputLimitTokens * compactionRatio);
  const exceedsCompactionThreshold = compactionThresholdTokens !== null && estimatedInputTokens >= compactionThresholdTokens;
  const exceedsVerifiedWindow = input.contextWindowTokens !== undefined
    && estimatedInputTokens + outputBudgetTokens + safetyMarginTokens > input.contextWindowTokens;

  return {
    messages,
    manifest: {
      version: 5,
      stage: input.stage,
      requestBytes,
      componentBytes: {
        system: systemBytes,
        payload: payloadBytes,
        schema: schemaBytes,
        framing: requestBytes - systemBytes - payloadBytes - schemaBytes,
      },
      requestFingerprint: fingerprint(wireView),
      promptFingerprint: fingerprint(input.systemInstructions),
      payloadFingerprint: fingerprint(payload),
      schemaFingerprint: fingerprint(schema),
      caseRevisionFingerprint: input.contextRevision ? fingerprint(input.contextRevision) : null,
      includedHistoryEventIds: [...new Set([...(input.includedHistoryEventIds ?? []), ...collectHistoryEventIds(input.payload)])],
      omittedHistoryEventIds: [...new Set(input.omittedHistoryEventIds ?? [])],
      estimatedInputTokens,
      estimateMethod: usesMeasuredLunaCalibration
        ? "codex-gpt-6-luna-stage-calibrated-v1"
        : "wire-utf8-bytes-divided-by-three-plus-15-percent",
      hardInputLimitTokens,
      inputBudgetTokens: hardInputLimitTokens,
      compactionThresholdTokens,
      compactionRatio,
      outputBudgetTokens,
      safetyMarginTokens,
      contextWindowTokens: input.contextWindowTokens ?? null,
      status: hardInputLimitTokens === null ? "unknown"
        : estimatedInputTokens <= hardInputLimitTokens ? "within_budget" : "over_budget",
      budgetStrategy: input.budgetStrategy ?? "assembled",
      exceedsVerifiedWindow,
      exceedsCompactionThreshold,
      exceedsSoftTarget: exceedsCompactionThreshold,
      omittedHistoryEntries: input.omittedHistoryEntries ?? 0,
      protectedQuoteCount: input.protectedQuoteCount ?? 0,
    },
  };
}

function measuredStageCalibrationFactor(stage: RecruitmentContextStage): number {
  // A 20-turn codex/gpt-6-luna runtime probe measured actual/estimated P95
  // ratios of 0.546 (understand, n=23) and 0.712 (expand, n=8). A follow-up
  // run found a higher understand ratio (0.982, n=8), so use 1.5 there; the factors leave
  // roughly 15–18% headroom at the latest observed P95. Investigate, reorient,
  // and conclude already had conservative observed estimates.
  if (stage === "understand") return 1.5;
  if (stage === "expand" || stage === "expand_recovery") return 1.6;
  return 1;
}

function serializedContentBytes(value: string): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8") - 2;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function collectHistoryEventIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectHistoryEventIds);
  const record = value as Record<string, unknown>;
  const found = typeof record.eventId === "string" && /^evt\.[a-f0-9]{16}\.(?:user\.\d+|question\.\d+\.\d+)$/.test(record.eventId)
    ? [record.eventId]
    : [];
  return [...found, ...Object.values(record).flatMap(collectHistoryEventIds)];
}

export interface ProjectedRecruitmentHistory {
  entries: ConversationHistoryEntry[];
  userEventIds: string[];
  manifest: {
    omittedEntryCount: number;
    protectedQuoteCount: number;
    includedEventIds: string[];
    omittedEventIds: string[];
    protectedQuoteReferences: Array<{ quote: string; eventId: string }>;
  };
}

export interface ProjectedRecruitmentDialogueEntry {
  role: "user" | "assistant";
  content: string;
  eventId?: string;
}

export function selectTransmittedHistoryEventIds(input: {
  retainedEventIds: readonly string[];
  legacyUserEventIds?: readonly string[];
  projectedDialogueEventIds?: readonly string[];
  protectedQuoteEventIds?: readonly string[];
  currentMessageEventId?: string;
  clarificationQuestionEventId?: string;
}): string[] {
  const transmitted = new Set([
    ...(input.legacyUserEventIds ?? []),
    ...(input.projectedDialogueEventIds ?? []),
    ...(input.protectedQuoteEventIds ?? []),
    ...(input.currentMessageEventId ? [input.currentMessageEventId] : []),
    ...(input.clarificationQuestionEventId ? [input.clarificationQuestionEventId] : []),
  ]);
  return input.retainedEventIds.filter(eventId => transmitted.has(eventId));
}

/**
 * Select recent conversational turns without changing the authoritative
 * checkpoint history. Quotes cited by the active brief can reach back beyond
 * the recent window, and answered clarifications keep their question/answer.
 */
export function projectRecruitmentHistory(
  history: readonly ConversationHistoryEntry[],
  options: {
    caseId?: string;
    recentUserTurns?: number;
    protectedQuotes?: readonly string[];
  } = {},
): ProjectedRecruitmentHistory {
  const userIndices = history.flatMap((entry, index) => entry.role === "user" ? [index] : []);
  const caseKey = fingerprint(options.caseId ?? "unscoped");
  const eventIdByIndex = new Map<number, string>();
  const userIdByIndex = new Map<number, string>();
  let userNumber = 0;
  const questionCountByUser = new Map<number, number>();
  let latestUserNumber = userNumber;
  history.forEach((entry, index) => {
    if (entry.role === "user") {
      const existingEvent = entry.eventId?.match(new RegExp(`^evt\\.${caseKey}\\.user\\.(\\d+)$`));
      const existingTurn = existingEvent ? Number(existingEvent[1]) : undefined;
      const turnNumber = existingTurn === undefined ? userNumber + 1 : existingTurn;
      userNumber = Math.max(userNumber, turnNumber);
      latestUserNumber = turnNumber;
      const eventId = existingTurn === undefined ? `evt.${caseKey}.user.${turnNumber}` : entry.eventId!;
      eventIdByIndex.set(index, eventId);
      userIdByIndex.set(index, eventId);
      return;
    }
    if (entry.role !== "assistant" || !isAskUserEntry(entry.content)) return;
    const parentNumber = latestUserNumber;
    const questionNumber = (questionCountByUser.get(parentNumber) ?? 0) + 1;
    questionCountByUser.set(parentNumber, questionNumber);
    const eventId = entry.eventId?.match(new RegExp(`^evt\\.${caseKey}\\.question\\.\\d+\\.\\d+$`))
      ? entry.eventId
      : `evt.${caseKey}.question.${parentNumber}.${questionNumber}`;
    eventIdByIndex.set(index, eventId);
  });
  const protectedQuotes = [...new Set((options.protectedQuotes ?? []).filter(quote => quote.trim().length > 0))];
  const keep = new Set<number>();
  const recentTurns = Math.max(1, Math.floor(options.recentUserTurns ?? 3));
  const recentIndices = new Set(userIndices.slice(-recentTurns));
  for (const index of recentIndices) keep.add(index);

  const userEventIds: string[] = [];
  userIndices.forEach(index => {
    const content = history[index]!.content;
    if (recentIndices.has(index) || protectedQuotes.some(quote => content.includes(quote))) {
      keep.add(index);
      userEventIds.push(userIdByIndex.get(index)!);
    }
  });

  // Preserve the relevant question with its answer, plus any unanswered latest question.
  history.forEach((entry, index) => {
    if (entry.role !== "assistant" || !isAskUserEntry(entry.content)) return;
    const nextUserIndex = userIndices.find(userIndex => userIndex > index);
    const isLatestQuestion = !history.slice(index + 1).some(candidate => candidate.role === "user");
    if ((nextUserIndex !== undefined && keep.has(nextUserIndex)) || isLatestQuestion) keep.add(index);
  });

  // Keep the latest action marker and latest result per tool. Their contents
  // are separately projected by stage-specific callers where required.
  let latestAssistantAction = -1;
  const latestToolIndices = new Map<string, number>();
  history.forEach((entry, index) => {
    if (entry.role === "assistant" && isActionEntry(entry.content)) latestAssistantAction = index;
    if (entry.role === "tool") latestToolIndices.set(entry.toolName ?? "tool", index);
  });
  if (latestAssistantAction >= 0) keep.add(latestAssistantAction);
  for (const index of latestToolIndices.values()) keep.add(index);

  const entries = history.flatMap((entry, index) => keep.has(index)
    ? [{ ...entry, ...(eventIdByIndex.has(index) ? { eventId: eventIdByIndex.get(index)! } : {}) }]
    : []);
  const protectedQuoteReferences = protectedQuotes.flatMap(quote => {
    const sourceIndex = [...userIndices].reverse().find(index => history[index]!.content.includes(quote));
    const eventId = sourceIndex === undefined ? undefined : userIdByIndex.get(sourceIndex);
    return eventId ? [{ quote, eventId }] : [];
  });
  const includedEventIds = history.flatMap((_entry, index) => keep.has(index) && eventIdByIndex.has(index) ? [eventIdByIndex.get(index)!] : []);
  const omittedEventIds = history.flatMap((_entry, index) => !keep.has(index) && eventIdByIndex.has(index) ? [eventIdByIndex.get(index)!] : []);
  return {
    entries,
    userEventIds,
    manifest: {
      omittedEntryCount: history.length - entries.length,
      protectedQuoteCount: protectedQuotes.filter(quote => history.some((entry, index) => entry.role === "user" && keep.has(index) && entry.content.includes(quote))).length,
      includedEventIds,
      omittedEventIds,
      protectedQuoteReferences,
    },
  };
}

/**
 * Keep the last user-turn window as readable dialogue. The current user
 * message is supplied separately to requirement understanding, while an
 * assistant clarification is kept only with a retained answer.
 */
export function projectRecentRecruitmentDialogue(
  history: readonly ConversationHistoryEntry[],
  recentUserTurns = 3,
): ProjectedRecruitmentDialogueEntry[] {
  const userEntries = history.filter(entry => entry.role === "user");
  const retainedUserIds = new Set(userEntries.slice(-Math.max(1, Math.floor(recentUserTurns)))
    .flatMap(entry => entry.eventId ? [entry.eventId] : []));
  const latestUserId = userEntries.at(-1)?.eventId;
  return history.flatMap<ProjectedRecruitmentDialogueEntry>((entry, index) => {
    if (entry.role === "user") {
      return entry.eventId && retainedUserIds.has(entry.eventId) && entry.eventId !== latestUserId
        ? [{ role: "user" as const, content: entry.content, eventId: entry.eventId }]
        : [];
    }
    if (entry.role !== "assistant") return [];
    let action: { action?: unknown; question?: unknown };
    try { action = JSON.parse(entry.content) as typeof action; }
    catch { return []; }
    if (action.action !== "ask_user" || typeof action.question !== "string") return [];
    const answer = history.slice(index + 1).find(candidate => candidate.role === "user");
    if (!answer?.eventId || !retainedUserIds.has(answer.eventId)) return [];
    return [{ role: "assistant" as const, content: action.question, ...(entry.eventId ? { eventId: entry.eventId } : {}) }];
  });
}

function isActionEntry(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { action?: unknown };
    return typeof parsed.action === "string";
  } catch {
    return false;
  }
}

function isAskUserEntry(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { action?: unknown };
    return parsed.action === "ask_user";
  } catch {
    return false;
  }
}
