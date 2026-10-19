import { type ConversationTurnResponse } from "../../domain/conversation.js";
import { type PlayerIdentityQuestion, type PositionSelectionQuestion } from "../../domain/position-contracts.js";
import { type RecruitmentTurnInput } from "../conversation-turn-runtime.js";
import { type ToolActionName } from "../recruitment-actions.js";
import { type RecruitmentPlannerUsageObservation } from "../recruitment-planner.js";
import type { RecruitmentContextManifest } from "../context.js";

export type RecruitmentTraceEvent =
  | { phase: "brief_failure"; failureKind: string; outputLimitTokens?: number; validationFailure?: string; issuePaths?: string[] }
  | { phase: "brief_usage"; elapsedMs: number; outcome: "response" | "failed"; inputTokens?: number; outputTokens?: number; totalTokens?: number; contextChars?: number; estimatedInputTokens?: number; inputBudgetTokens?: number; contextStatus?: "within_budget" | "over_budget"; omittedHistoryEntries?: number; contextManifest?: RecruitmentContextManifest }
  | { phase: "identity_usage"; elapsedMs: number; outcome: "response" | "failed"; inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedInputTokens?: number; contextManifest?: RecruitmentContextManifest }
  | { phase: "summary_usage"; elapsedMs: number; outcome: "response" | "failed"; inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedInputTokens?: number; contextManifest?: RecruitmentContextManifest }
  | { phase: "summary_failure"; failureKind: string }
  | ({ phase: "model_usage" } & RecruitmentPlannerUsageObservation)
  | { phase: "tool_reuse"; toolName: "search_methodology"; resultCount: number; reason: "successful_same_turn_query" }
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
    plannerFallback?: "expansion_timeout" | "expansion_output_limit" | "conclusion_timeout" | "conclusion_output_limit";
    decisionMode?: "investigate" | "expand" | "expand_recovery" | "reorient" | "conclude";
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

export type UnderstatResearchMode = "catalog_only" | "fixed_profile" | "adaptive";

export type PolicyBlockReasonCode =
  | "question_before_investigation"
  | "unspecified_competition_scope"
  | "unverified_current_affiliation"
  | "reference_player_identity"
  | "repeated_position_broadening"
  | "unavailable_player_report_claim"
  | "candidate_search_exhausted"
  | "evidence_sufficient_for_expansion"
  | "shortlist_comparison_handled"
  | "other";

export type RecruitmentTraceObserver = (event: RecruitmentTraceEvent) => void;

export interface RecruitmentConversation {
  turn(input: RecruitmentTurnInput): Promise<ConversationTurnResponse>;
}

export interface PendingQuestion {
  input?: PositionSelectionQuestion | PlayerIdentityQuestion;
  question: string;
  reason: string;
}

export class RecruitmentCaseStateExpiredError extends Error {
  constructor() {
    super("服务端找不到此案件的内部调查状态。请保留浏览器中已有报告，新建案件并重新发送原始需求；已有浏览器记录不会被覆盖。");
    this.name = "RecruitmentCaseStateExpiredError";
  }
}
