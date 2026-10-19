import type { ConversationHistoryEntry } from "./planner-context.js";
import { DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS, DEFAULT_CONTEXT_SOFT_INPUT_BUDGET_TOKENS } from "./chat-model.js";

export type RecruitmentContextStage = "understand" | "investigate" | "expand" | "expand_recovery" | "reorient" | "conclude" | "summarize";

export interface RecruitmentContextManifest {
  version: 1;
  stage: RecruitmentContextStage;
  requestBytes: number;
  estimatedInputTokens: number;
  estimateMethod: "utf8-bytes-divided-by-three-plus-15-percent";
  inputBudgetTokens: number;
  outputBudgetTokens: number;
  safetyMarginTokens: number;
  contextWindowTokens: number | null;
  status: "within_budget" | "over_budget";
  exceedsVerifiedWindow: boolean;
  exceedsSoftTarget: boolean;
  omittedHistoryEntries: number;
  protectedQuoteCount: number;
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
      version: 1,
      stage: input.stage,
      requestBytes,
      estimatedInputTokens,
      estimateMethod: "utf8-bytes-divided-by-three-plus-15-percent",
      inputBudgetTokens,
      outputBudgetTokens,
      safetyMarginTokens,
      contextWindowTokens: input.contextWindowTokens ?? null,
      status: estimatedInputTokens <= inputBudgetTokens ? "within_budget" : "over_budget",
      exceedsVerifiedWindow,
      exceedsSoftTarget,
      omittedHistoryEntries: input.omittedHistoryEntries ?? 0,
      protectedQuoteCount: input.protectedQuoteCount ?? 0,
    },
  };
}

export interface ProjectedRecruitmentHistory {
  entries: ConversationHistoryEntry[];
  userEventIds: string[];
  manifest: { omittedEntryCount: number; protectedQuoteCount: number };
}

/**
 * Select recent conversational turns without changing the authoritative
 * checkpoint history. Quotes cited by the active brief can reach back beyond
 * the recent window, and answered clarifications keep their question/answer.
 */
export function projectRecruitmentHistory(
  history: readonly ConversationHistoryEntry[],
  options: { recentUserTurns?: number; protectedQuotes?: readonly string[]; preserveAllTools?: boolean } = {},
): ProjectedRecruitmentHistory {
  const userIndices = history.flatMap((entry, index) => entry.role === "user" ? [index] : []);
  const protectedQuotes = [...new Set((options.protectedQuotes ?? []).filter(quote => quote.trim().length > 0))];
  const keep = new Set<number>();
  const recentTurns = Math.max(1, Math.floor(options.recentUserTurns ?? 3));
  for (const index of userIndices.slice(-recentTurns)) keep.add(index);

  const userEventIds: string[] = [];
  let userNumber = 0;
  userIndices.forEach(index => {
    userNumber += 1;
    const content = history[index]!.content;
    if (userIndices.slice(-recentTurns).includes(index) || protectedQuotes.some(quote => content.includes(quote))) {
      keep.add(index);
      userEventIds.push(`user-${userNumber}`);
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

  const entries = history.filter((_entry, index) => keep.has(index));
  return {
    entries,
    userEventIds,
    manifest: {
      omittedEntryCount: history.length - entries.length,
      protectedQuoteCount: protectedQuotes.filter(quote => history.some((entry, index) => entry.role === "user" && keep.has(index) && entry.content.includes(quote))).length,
    },
  };
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
