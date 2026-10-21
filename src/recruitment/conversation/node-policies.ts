import {
  Command,
  isNodeTimeoutError,
  type NodeError,
  type RetryPolicy,
} from "@langchain/langgraph";
import { openAIRequestTimeoutMs } from "../chat-model.js";
import type { State } from "./state.js";
import { isTransientModelFailure } from "../chat-model.js";

export type RecruitmentFailureCategory = "timeout" | "unavailable" | "internal";
export type RecruitmentFailureNode = "understand_request" | "plan_decision" | "execute_tool" | "review_recommendation";

export type RecruitmentRuntimeFailure = {
  node: RecruitmentFailureNode;
  category: RecruitmentFailureCategory;
};

/**
 * A deliberately small marker for an idempotent read whose transport adapter
 * has already exhausted its own retry budget. The graph gets one final retry;
 * no provider message or response body is retained.
 */
export class TransientRecruitmentReadError extends Error {
  constructor() {
    super("A transient network error interrupted an idempotent recruitment read.");
    this.name = "TransientRecruitmentReadError";
  }
}

export function recruitmentFailureCategory(error: unknown): RecruitmentFailureCategory {
  if (error instanceof TransientRecruitmentReadError) return "unavailable";
  if (isNodeTimeoutError(error)) return "timeout";
  if (isTransientModelFailure(error)) return "unavailable";
  if (error instanceof Error && /timeout/i.test(error.name)) return "timeout";
  if (error instanceof Error && /unavailable|network|fetch|rate.?limit|servererror/i.test(error.name)) return "unavailable";
  return "internal";
}

function safeFailureHandler(node: RecruitmentFailureNode) {
  return (_state: State, error: NodeError) => new Command({
    update: {
      runtimeFailure: { node, category: recruitmentFailureCategory(error.error) },
    },
    goto: "record_runtime_failure",
  });
}

const nativeReadRetryPolicy: RetryPolicy = {
  maxAttempts: 2,
  initialInterval: 120,
  backoffFactor: 1,
  maxInterval: 120,
  jitter: false,
  logWarning: false,
  retryOn: error => error instanceof TransientRecruitmentReadError,
};

const modelDeadline = openAIRequestTimeoutMs() + 15_000;

/** One reviewable table for graph-level recovery; transport retries stay in adapters. */
export const recruitmentNodePolicies = {
  understand_request: {
    timeout: modelDeadline * 3,
    cachePolicy: false,
    errorHandler: safeFailureHandler("understand_request"),
  },
  plan_decision: {
    // A decision may compact once, repair a structured response, and use one bounded transport retry.
    timeout: modelDeadline * 3,
    cachePolicy: false,
    errorHandler: safeFailureHandler("plan_decision"),
  },
  execute_tool: {
    timeout: 90_000,
    retryPolicy: nativeReadRetryPolicy,
    cachePolicy: false,
    errorHandler: safeFailureHandler("execute_tool"),
  },
  review_recommendation: {
    timeout: 10_000,
    cachePolicy: false,
    errorHandler: safeFailureHandler("review_recommendation"),
  },
  enrichment: {
    timeout: 45_000,
    cachePolicy: false,
  },
} as const;

export const graphNodePolicyReference = {
  understand_request: "model request; no graph retry",
  plan_decision: "model request; planner fallback owns known timeout/output-limit cases",
  execute_tool: "one graph retry for typed idempotent reads only",
  review_recommendation: "deterministic evidence review; no retry",
  enrichment: "optional read; downstream coverage records failure",
} as const;
