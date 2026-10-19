import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { estimateRecruitmentInputTokens } from "../context.js";
import type { CaseSummaryGenerator } from "../case-summary.js";
import { caseSummaryEvents } from "../case-summary.js";
import type { RecruitmentTraceObserver } from "./contracts.js";
import { emitProgress } from "./progress.js";
import type { State } from "./state.js";
import { throwIfTurnCancelled } from "../turn-cancellation.js";

export type ContextManagementMode = "legacy" | "unified" | "summarized";

export function createContextCompactionNode(input: {
  mode: ContextManagementMode;
  generator?: CaseSummaryGenerator;
  observer?: RecruitmentTraceObserver;
}) {
  return async (state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> => {
    if (input.mode !== "summarized" || !input.generator) return {};
    const userTurnCount = state.history.filter(entry => entry.role === "user").length;
    const throughUserTurnCount = Math.max(0, userTurnCount - 3);
    const covered = Math.max(state.caseSummary?.coveredUserTurnCount ?? 0, state.caseSummaryAttemptedThrough);
    if (userTurnCount < 12 || throughUserTurnCount <= covered) return {};
    const events = caseSummaryEvents(state.history, {
      coveredUserTurnCount: state.caseSummary?.coveredUserTurnCount ?? 0,
      throughUserTurnCount,
    });
    const estimatedInputTokens = estimateRecruitmentInputTokens(JSON.stringify({
      previousSummary: state.caseSummary?.text ?? null,
      events,
    }));
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
        previousSummary: state.caseSummary?.text ?? null,
        events,
        ...(config.signal ? { signal: config.signal } : {}),
        onUsage: usage => input.observer?.({
          phase: "summary_usage",
          elapsedMs: Math.round(performance.now() - startedAt),
          ...usage,
        }),
      });
      throwIfTurnCancelled(config.signal);
      const coveredEventIds = [...(state.caseSummary?.coveredEventIds ?? []), ...result.coveredEventIds];
      emitProgress(config, {
        stage: "context_compaction",
        status: "completed",
        message: "较早的对话进展已整理，当前需求仍以最新确认内容为准",
        completedSteps: state.decisionSteps,
      });
      return {
        caseSummary: {
          version: 1,
          text: result.summary,
          coveredUserTurnCount: throughUserTurnCount,
          coveredEventIds,
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
