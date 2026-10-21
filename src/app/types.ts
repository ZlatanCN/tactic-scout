import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph";
import type { RecruitmentConversation, RecruitmentPlanner } from "../recruitment/conversation.js";
import type { KnowledgeBase, KnowledgeRepository } from "../knowledge/index.js";
import type { PlayerRepository } from "../players/repository.js";
import type { PlayerObservationLibrary } from "../observations/library.js";
import type { TeamRosterEnrichmentProvider } from "../sources/thesportsdb/roster.js";
import type { KnowledgeEvidence } from "../knowledge/evidence.js";

export type AppKnowledgeBase = KnowledgeRepository & Pick<KnowledgeBase, "status" | "ingest" | "removeDocument">;

export interface CreateAppOptions {
  playerRepository?: PlayerRepository;
  recruitmentConversation?: RecruitmentConversation;
  recruitmentPlanner?: RecruitmentPlanner;
  knowledgeBase?: AppKnowledgeBase;
  knowledgeEvidence?: KnowledgeEvidence;
  playerObservationLibrary?: PlayerObservationLibrary;
  playerObservationsPath?: string;
  checkpointer?: BaseCheckpointSaver;
  checkpointPath?: string;
  preferenceStore?: BaseStore;
  preferenceStorePath?: string;
  teamRosterEnrichment?: TeamRosterEnrichmentProvider;
}
