import { Annotation } from "@langchain/langgraph";
import type { PlayerRepository } from "../../players/repository.js";
import type { RecruitmentBriefInterpreter } from "../brief.js";
import type { KnowledgeRepository } from "../../knowledge/index.js";
import type { RecruitmentEvidenceEvaluator } from "../recruitment-evidence-evaluator.js";
import type { RecruitmentPlanner } from "../recruitment-planner.js";
import type { PlayerNameResolver } from "../../players/identity/name-resolver.js";
import type { CandidateIdentityGroup } from "../../players/identity/candidate-groups.js";
import type { PlayerProfile } from "../../domain/players.js";
import type { TeamRosterEnrichmentProvider } from "../../sources/thesportsdb/roster.js";
import type { RecruitmentTraceObserver } from "./contracts.js";
import type { PlanningRunState } from "./planning-run.js";
import type { ConfiguredPlayerEloClient } from "../../sources/playerelo/client.js";
import type { HistoricalArchiveSetup } from "../../sources/reep/historical-archive-enrichment.js";
import type { RecruitmentPreference } from "../preferences/schemas.js";

export type RecruitmentRuntimeContext = {
  repository: PlayerRepository;
  planner: RecruitmentPlanner;
  briefInterpreter?: RecruitmentBriefInterpreter;
  referenceNameResolver?: PlayerNameResolver;
  teamRosterEnrichment?: TeamRosterEnrichmentProvider;
  candidateIdentityGrouper: (records: readonly PlayerProfile[]) => CandidateIdentityGroup[];
  knowledgeBase: KnowledgeRepository;
  observer?: RecruitmentTraceObserver;
  evidenceEvaluator: RecruitmentEvidenceEvaluator;
  playerEloSetup?: ConfiguredPlayerEloClient;
  historicalArchiveSetup?: HistoricalArchiveSetup;
  /** Explicit, owner-scoped defaults; never copied to case state/checkpoints. */
  userPreferences?: RecruitmentPreference[];
  /** Transient per-run scratch space. It never enters the graph state. */
  planningRun?: PlanningRunState;
};

/**
 * LangGraph converts field-level Zod schemas into a context state shape. A
 * whole-object custom schema preserves the service interface, including
 * optional functions, while still validating every required runtime boundary
 * before a node can read it.
 */
/**
 * Context is a type-only LangGraph boundary, never a state channel or
 * checkpoint value. Required services are listed here so node signatures use
 * the graph's inferred context type; optional services remain on
 * `RecruitmentRuntimeContext` and pass through without being serialized.
 */
export const RecruitmentRuntimeContextSchema = Annotation.Root({
  repository: Annotation<PlayerRepository>(),
  planner: Annotation<RecruitmentPlanner>(),
  candidateIdentityGrouper: Annotation<(records: readonly PlayerProfile[]) => CandidateIdentityGroup[]>(),
  knowledgeBase: Annotation<KnowledgeRepository>(),
  evidenceEvaluator: Annotation<RecruitmentEvidenceEvaluator>(),
  userPreferences: Annotation<RecruitmentPreference[]>(),
});

export function requireRecruitmentRuntimeContext(
  context: Partial<RecruitmentRuntimeContext> | undefined,
): RecruitmentRuntimeContext {
  if (!context) {
    throw new Error("Recruitment LangGraph runtime context is missing; repository, Planner, knowledge, and evaluation services must be supplied for this run.");
  }
  if (!context.repository) {
    throw new Error("Recruitment LangGraph runtime context is missing repository.");
  }
  if (!context.planner || typeof context.planner.decide !== "function") {
    throw new Error("Recruitment LangGraph runtime context is missing planner.");
  }
  if (!context.candidateIdentityGrouper || typeof context.candidateIdentityGrouper !== "function") {
    throw new Error("Recruitment LangGraph runtime context is missing candidateIdentityGrouper.");
  }
  if (!context.knowledgeBase || typeof context.knowledgeBase.search !== "function") {
    throw new Error("Recruitment LangGraph runtime context is missing knowledgeBase.");
  }
  if (!context.evidenceEvaluator || typeof context.evidenceEvaluator.evaluate !== "function") {
    throw new Error("Recruitment LangGraph runtime context is missing evidenceEvaluator.");
  }
  return context as RecruitmentRuntimeContext;
}
