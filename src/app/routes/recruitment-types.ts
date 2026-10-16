import type { RecruitmentTurnCoordinator } from "../../recruitment/turn-coordinator.js";
import type { ConversationTurnResponse, RecruitmentProgress, RecruitmentProgressEventStatus } from "../../domain/conversation.js";
import type { RecruitmentConversation } from "../../recruitment/conversation.js";
import type { TeamRosterEnrichmentProvider } from "../../sources/thesportsdb/roster.js";

export type RecruitmentProgressEmitter = (
  update: Pick<RecruitmentProgress, "stage" | "message" | "completedSteps"> & { status?: RecruitmentProgressEventStatus },
  active?: boolean,
) => void;

export interface RecruitmentRouteContext {
  recruitmentConversation: RecruitmentConversation;
  recruitmentTurnCoordinator: RecruitmentTurnCoordinator<ConversationTurnResponse>;
  recruitmentProgressByCase: Map<string, RecruitmentProgress>;
  recruitmentProgressEmitters: Map<string, RecruitmentProgressEmitter>;
  teamRosterEnrichment: TeamRosterEnrichmentProvider;
  teamRosterEnrichmentConfigured: boolean;
}
