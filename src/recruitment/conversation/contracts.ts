import { type ConversationTurnResponse } from "../../domain/conversation.js";
import { type PlayerIdentityQuestion, type PositionSelectionQuestion } from "../../domain/position-contracts.js";
import { type RecruitmentTurnInput } from "../conversation-turn-runtime.js";
import { type ToolActionName } from "../recruitment-actions.js";
import { type RecruitmentPlannerUsageObservation } from "../recruitment-planner.js";
import type { RecruitmentContextManifest } from "../context.js";
import type { RecruitmentBriefValidationCode } from "../brief.js";

type RecruitmentTraceFilterValue = string | number | boolean | null | string[] | string[][];

export type RecruitmentTraceEvent =
  | { phase: "brief_failure"; failureKind: string; failureCode?: string; failureStatus?: number; outputLimitTokens?: number; validationCode?: RecruitmentBriefValidationCode; validationFailure?: string; issuePaths?: string[] }
  | { phase: "brief_usage"; elapsedMs: number; outcome: "response" | "failed"; gatewayAttempts?: number; inputTokens?: number; outputTokens?: number; totalTokens?: number; contextChars?: number; estimatedInputTokens?: number; inputBudgetTokens?: number | null; contextStatus?: "within_budget" | "over_budget" | "unknown"; omittedHistoryEntries?: number; contextManifest?: RecruitmentContextManifest }
  | { phase: "identity_usage"; elapsedMs: number; outcome: "response" | "failed"; gatewayAttempts?: number; inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedInputTokens?: number; contextManifest?: RecruitmentContextManifest }
  | ({ phase: "model_usage" } & RecruitmentPlannerUsageObservation)
  | { phase: "tool_reuse"; toolName: "search_methodology"; resultCount: number; reason: "successful_same_turn_query" }
  | { phase: "report_generation"; elapsedMs: number; gatewayAttempts: number; decisionMode: "investigate" | "expand" | "expand_recovery" | "reorient" | "conclude"; plannerFallback?: "expansion_timeout" | "expansion_output_limit" | "conclusion_timeout" | "conclusion_output_limit" }
  | { phase: "report_projection"; elapsedMs: number; citationCount: number; recommendationCount: number }
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
    gatewayAttempts?: number;
    targetTeam?: string | null;
  }
  | {
    phase: "tool";
    toolName: ToolActionName;
    elapsedMs: number;
    ok: boolean;
    errorCode?: string;
    filters: Record<string, RecruitmentTraceFilterValue>;
    resultCount: number;
    matchingRecordCount?: number;
    rankingMode?: "hybrid" | "full_text" | "dense_vector" | "gateway_reranked" | "local_cross_encoder" | "hybrid_degraded" | null;
    rankingGatewayAttempts?: number;
    rankingInputTokens?: number | null;
    rankingOutputTokens?: number | null;
    ragSubqueryCount?: number;
    ragRound?: 1 | 2;
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

export interface RecruitmentEvaluationEvidenceScope {
  corpus: "methodology" | "player_report";
  query: string;
  subjects: Array<{ subjectId: string; displayName: string; aliases: string[] }>;
  sampleFrom?: string;
  sampleTo?: string;
  sampleSeasons: string[];
  /** Evaluation-only: bypass recruitment interpretation and answer as a knowledge question. */
  knowledgeQa?: boolean;
}

export interface RecruitmentConversation {
  turn(input: RecruitmentTurnInput): Promise<ConversationTurnResponse>;
  inspectCaseRun?(input: { threadId: string; limit?: number }): Promise<import("./case-run-inspection.js").CaseRunInspection>;
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
