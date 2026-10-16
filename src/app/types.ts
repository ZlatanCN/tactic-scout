import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { RecruitmentConversation, RecruitmentPlanner } from "../recruitment/conversation.js";
import type { KnowledgeBase, KnowledgeRepository } from "../knowledge/index.js";
import type { PlayerRepository } from "../players/repository.js";
import type { PlayerObservationLibrary } from "../observations/library.js";
import type { TeamRosterEnrichmentProvider } from "../sources/thesportsdb/roster.js";

export type AppKnowledgeBase = KnowledgeRepository & Pick<KnowledgeBase, "status" | "ingest" | "removeDocument">;

export interface CreateAppOptions {
  playerRepository?: PlayerRepository;
  recruitmentConversation?: RecruitmentConversation;
  recruitmentPlanner?: RecruitmentPlanner;
  knowledgeBase?: AppKnowledgeBase;
  playerObservationLibrary?: PlayerObservationLibrary;
  playerObservationsPath?: string;
  checkpointer?: BaseCheckpointSaver;
  checkpointPath?: string;
  teamRosterEnrichment?: TeamRosterEnrichmentProvider;
}
