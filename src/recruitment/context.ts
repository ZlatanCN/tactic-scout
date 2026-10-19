import type { ConversationHistoryEntry } from "./planner-context.js";
import { DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS, DEFAULT_CONTEXT_SOFT_INPUT_BUDGET_TOKENS } from "./chat-model.js";
import { createHash } from "node:crypto";

export type RecruitmentContextStage = "understand" | "investigate" | "expand" | "expand_recovery" | "reorient" | "conclude" | "summarize";

export interface RecruitmentContextManifest {
  version: 3;
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
  evidenceRefs: string[];
  estimatedInputTokens: number;
  estimateMethod: "utf8-bytes-divided-by-three-plus-15-percent";
  inputBudgetTokens: number;
  outputBudgetTokens: number;
  safetyMarginTokens: number;
  contextWindowTokens: number | null;
  status: "within_budget" | "over_budget";
  budgetStrategy: "assembled" | "conclusion_history_reduced" | "conclusion_candidate_batch";
  exceedsVerifiedWindow: boolean;
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
  softInputBudgetTokens?: number;
  safetyMarginTokens?: number;
  omittedHistoryEntries?: number;
  protectedQuoteCount?: number;
  contextRevision?: string;
  includedHistoryEventIds?: readonly string[];
  omittedHistoryEventIds?: readonly string[];
  evidenceRefs?: readonly string[];
  budgetStrategy?: RecruitmentContextManifest["budgetStrategy"];
}

export interface RecruitmentContextRequest {
  messages: [{ role: "system"; content: string }, { role: "human"; content: string }];
  manifest: RecruitmentContextManifest;
}

export class RecruitmentContextCapacityError extends Error {
  constructor(readonly stage: RecruitmentContextStage, readonly estimatedInputTokens: number, readonly inputBudgetTokens: number) {
    super(`${stage} 请求预计需要约 ${estimatedInputTokens} 个输入 token，超过已配置的 ${inputBudgetTokens} token 上限；案件已保留，请缩小本轮范围后重试。`);
    this.name = "RecruitmentContextCapacityError";
  }
}

export function assertRecruitmentContextFits(request: RecruitmentContextRequest): void {
  if (request.manifest.exceedsVerifiedWindow) {
    throw new RecruitmentContextCapacityError(
      request.manifest.stage,
      request.manifest.estimatedInputTokens,
      request.manifest.inputBudgetTokens,
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
  const wireView = JSON.stringify([
    { role: "system", content: input.systemInstructions },
    { role: "human", content: humanContent },
    { response_schema: schema },
  ]);
  const requestBytes = Buffer.byteLength(wireView, "utf8");
  const systemBytes = serializedContentBytes(input.systemInstructions);
  const payloadBytes = serializedContentBytes(payload);
  const schemaBytes = serializedContentBytes(schema);
  const evidenceRefs = [...new Set([...(input.evidenceRefs ?? []), ...collectEvidenceRefs(input.payload)])];
  const estimatedInputTokens = estimateRecruitmentInputTokens(wireView);
  const outputBudgetTokens = Math.max(0, Math.floor(input.outputBudgetTokens));
  const safetyMarginTokens = input.safetyMarginTokens ?? DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS;
  const softBudget = input.softInputBudgetTokens ?? DEFAULT_CONTEXT_SOFT_INPUT_BUDGET_TOKENS;
  const inputBudgetTokens = input.contextWindowTokens === undefined
    ? softBudget
    : Math.max(0, Math.min(softBudget, input.contextWindowTokens - outputBudgetTokens - safetyMarginTokens));
  const exceedsSoftTarget = estimatedInputTokens > softBudget;
  const exceedsVerifiedWindow = input.contextWindowTokens !== undefined
    && estimatedInputTokens + outputBudgetTokens + safetyMarginTokens > input.contextWindowTokens;

  return {
    messages: [
      { role: "system", content: input.systemInstructions },
      { role: "human", content: humanContent },
    ],
    manifest: {
      version: 3,
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
      evidenceRefs,
      estimatedInputTokens,
      estimateMethod: "utf8-bytes-divided-by-three-plus-15-percent",
      inputBudgetTokens,
      outputBudgetTokens,
      safetyMarginTokens,
      contextWindowTokens: input.contextWindowTokens ?? null,
      status: estimatedInputTokens <= inputBudgetTokens ? "within_budget" : "over_budget",
      budgetStrategy: input.budgetStrategy ?? "assembled",
      exceedsVerifiedWindow,
      exceedsSoftTarget,
      omittedHistoryEntries: input.omittedHistoryEntries ?? 0,
      protectedQuoteCount: input.protectedQuoteCount ?? 0,
    },
  };
}

function serializedContentBytes(value: string): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8") - 2;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function collectEvidenceRefs(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectEvidenceRefs);
  const record = value as Record<string, unknown>;
  const found = [record.ref, record.metricEvidenceRef]
    .filter((ref): ref is string => typeof ref === "string" && /^ev\.[a-f0-9]{12}\.[a-f0-9]{12}\.(?:player_metrics|player_report|methodology)\.[a-f0-9]{16}\.[a-f0-9]{16}$/.test(ref));
  return [...found, ...Object.values(record).flatMap(collectEvidenceRefs)];
}

function collectHistoryEventIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectHistoryEventIds);
  const record = value as Record<string, unknown>;
  const summaryClaims = Array.isArray(record.claimEventIds)
    ? record.claimEventIds.filter((eventId): eventId is string => typeof eventId === "string" && /^evt\.[a-f0-9]{16}\.(?:user\.\d+|question\.\d+\.\d+)$/.test(eventId))
    : [];
  const found = typeof record.eventId === "string" && /^evt\.[a-f0-9]{16}\.(?:user\.\d+|question\.\d+\.\d+)$/.test(record.eventId)
    ? [record.eventId]
    : [];
  return [...found, ...summaryClaims, ...Object.entries(record)
    .filter(([key]) => key !== "coveredEventIds")
    .flatMap(([, nested]) => collectHistoryEventIds(nested))];
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
  options: { caseId?: string; recentUserTurns?: number; protectedQuotes?: readonly string[]; preserveAllTools?: boolean } = {},
): ProjectedRecruitmentHistory {
  const userIndices = history.flatMap((entry, index) => entry.role === "user" ? [index] : []);
  const caseKey = fingerprint(options.caseId ?? "unscoped");
  const eventIdByIndex = new Map<number, string>();
  const userIdByIndex = new Map<number, string>();
  let userNumber = 0;
  const questionCountByUser = new Map<number, number>();
  let latestUserNumber = 0;
  history.forEach((entry, index) => {
    if (entry.role === "user") {
      userNumber += 1;
      latestUserNumber = userNumber;
      const eventId = `evt.${caseKey}.user.${userNumber}`;
      eventIdByIndex.set(index, eventId);
      userIdByIndex.set(index, eventId);
      return;
    }
    if (entry.role !== "assistant" || !isAskUserEntry(entry.content)) return;
    const parentNumber = latestUserNumber;
    const questionNumber = (questionCountByUser.get(parentNumber) ?? 0) + 1;
    questionCountByUser.set(parentNumber, questionNumber);
    eventIdByIndex.set(index, `evt.${caseKey}.question.${parentNumber}.${questionNumber}`);
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
  if (options.preserveAllTools) {
    history.forEach((entry, index) => { if (entry.role === "tool") keep.add(index); });
  } else {
    for (const index of latestToolIndices.values()) keep.add(index);
  }

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
