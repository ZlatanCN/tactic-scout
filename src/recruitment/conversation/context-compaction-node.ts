import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { estimateRecruitmentInputTokens } from "../context.js";
import type { CaseSummaryGenerator } from "../case-summary.js";
import { caseSummaryEvents, renderCaseSummaryClaims } from "../case-summary.js";
import type { RecruitmentTraceObserver } from "./contracts.js";
import { emitProgress } from "./progress.js";
import type { State } from "./state.js";
import { throwIfTurnCancelled } from "../turn-cancellation.js";

export type ContextManagementMode = "legacy" | "projection" | "evidence" | "unified" | "summarized";

export function contextManagementFeatures(mode: ContextManagementMode) {
  return {
    historyProjection: mode === "projection" || mode === "unified" || mode === "summarized",
    evidenceReads: mode === "evidence" || mode === "unified" || mode === "summarized",
    summaries: mode === "summarized",
  };
}

export function createContextCompactionNode(input: {
  mode: ContextManagementMode;
  generator?: CaseSummaryGenerator;
  observer?: RecruitmentTraceObserver;
}) {
  return async (state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> => {
    if (!contextManagementFeatures(input.mode).summaries || !input.generator) return {};
    const userTurnCount = state.history.filter(entry => entry.role === "user").length;
    const throughUserTurnCount = Math.max(0, userTurnCount - 3);
    const verifiedSummary = state.caseSummary?.version === 2 ? state.caseSummary : null;
    const covered = Math.max(verifiedSummary?.coveredUserTurnCount ?? 0, state.caseSummaryAttemptedThrough);
    if (userTurnCount < 12 || throughUserTurnCount <= covered) return {};
    const caseId = typeof config.configurable?.thread_id === "string" ? config.configurable.thread_id : "unscoped";
    const events = caseSummaryEvents(state.history, {
      caseId,
      coveredUserTurnCount: verifiedSummary?.coveredUserTurnCount ?? 0,
      throughUserTurnCount,
    });
    const estimatedInputTokens = estimateRecruitmentInputTokens(JSON.stringify({ events }));
    // Summaries add a model call; only use them when older user dialogue is a
    // material share of the request. Candidate facts and evidence are excluded.
    if (estimatedInputTokens < 2_048 || !events.length) return {};

    emitProgress(config, {
      stage: "context_compaction",
      message: "正在整理较早的对话进展",
      completedSteps: state.decisionSteps,
    });
    const startedAt = performance.now();
    try {
      const result = await input.generator.summarize({
        events,
        contextRevision: JSON.stringify([caseId, userTurnCount]),
        ...(config.signal ? { signal: config.signal } : {}),
        onUsage: usage => input.observer?.({
          phase: "summary_usage",
          elapsedMs: Math.round(performance.now() - startedAt),
          ...usage,
        }),
      });
      throwIfTurnCancelled(config.signal);
      const claims = [...(verifiedSummary?.claims ?? []), ...result.claims];
      while (claims.length > 0 && renderCaseSummaryClaims(claims).length > 2_000) claims.shift();
      emitProgress(config, {
        stage: "context_compaction",
        status: "completed",
        message: "较早的对话进展已整理，当前需求仍以最新确认内容为准",
        completedSteps: state.decisionSteps,
      });
      return {
        caseSummary: {
          version: 2,
          text: renderCaseSummaryClaims(claims),
          claims,
          coveredUserTurnCount: throughUserTurnCount,
        },
        caseSummaryAttemptedThrough: throughUserTurnCount,
      };
    } catch (error) {
      throwIfTurnCancelled(config.signal);
      input.observer?.({ phase: "summary_failure", failureKind: error instanceof Error ? error.name : "unknown" });
      emitProgress(config, {
        stage: "context_compaction",
        status: "notice",
        message: "较早对话摘要未能生成，继续按当前需求和已保留记录调查",
        completedSteps: state.decisionSteps,
      });
      return { caseSummaryAttemptedThrough: throughUserTurnCount };
    }
  };
}
