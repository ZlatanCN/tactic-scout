import Fastify from "fastify";
import type { ConversationTurnResponse, RecruitmentProgress, RecruitmentProgressEventStatus } from "./domain/conversation.js";
import { registerLoopbackRequestGuard } from "./app/security.js";
import { registerPlayerObservationRoutes } from "./app/routes/player-observations.js";
import { registerRetiredRoutes } from "./app/routes/retired.js";
import { registerRecruitmentProgressRoutes } from "./app/routes/recruitment-progress.js";
import { registerRecruitmentTurnRoute } from "./app/routes/recruitment-turn.js";
import { registerSystemRoutes } from "./app/routes/system.js";
import type { RecruitmentRouteContext } from "./app/routes/recruitment-types.js";
import type { CreateAppOptions } from "./app/types.js";
import { createTheSportsDbRosterEnrichment } from "./sources/thesportsdb/roster.js";
import { createRecruitmentCheckpointStore } from "./recruitment/checkpoint-store.js";
import { createRepository } from "./sources/registry.js";
import { configuredRecruitmentConversation, createRecruitmentConversation } from "./recruitment/conversation.js";
import { createLocalKnowledgeBase } from "./knowledge/index.js";
import { createWebSearchKnowledgeRepository } from "./knowledge/web-player-report-search.js";
import { createPlayerObservationLibrary } from "./observations/library.js";
import { RecruitmentTurnCoordinator } from "./recruitment/turn-coordinator.js";
import { RecruitmentTurnService } from "./app/recruitment-turn-service.js";

export function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: true });
  const playerRepository = options.playerRepository ?? createRepository();
  if (playerRepository.close) app.addHook("onClose", async () => playerRepository.close!());
  const knowledgeBase = options.knowledgeBase ?? createLocalKnowledgeBase();
  const recruitmentKnowledge = createWebSearchKnowledgeRepository(knowledgeBase);
  const playerObservationLibrary = options.playerObservationLibrary ?? createPlayerObservationLibrary({
    index: knowledgeBase,
    storagePath: options.playerObservationsPath,
  });
  const checkpointStore = options.recruitmentConversation || options.checkpointer
    ? undefined
    : createRecruitmentCheckpointStore(options.checkpointPath);
  const checkpointer = options.checkpointer ?? checkpointStore?.checkpointer;
  const recruitmentProgressByCase = new Map<string, RecruitmentProgress>();
  const recruitmentProgressEmitters = new Map<string, (
    update: Pick<RecruitmentProgress, "stage" | "message" | "completedSteps"> & { status?: RecruitmentProgressEventStatus },
    active?: boolean,
  ) => void>();
  const recruitmentTurnCoordinator = new RecruitmentTurnCoordinator<ConversationTurnResponse>();
  const teamRosterEnrichment = options.teamRosterEnrichment ?? createTheSportsDbRosterEnrichment({ apiKey: "", fetchEnabled: false });
  const recruitmentConversation = options.recruitmentConversation ?? (options.recruitmentPlanner
    ? createRecruitmentConversation({
      repository: playerRepository,
      ...(options.teamRosterEnrichment ? { teamRosterEnrichment: options.teamRosterEnrichment } : {}),
      planner: options.recruitmentPlanner,
      knowledgeBase: recruitmentKnowledge,
      checkpointer,
    })
    : configuredRecruitmentConversation({
      repository: playerRepository,
      ...(options.teamRosterEnrichment ? { teamRosterEnrichment: options.teamRosterEnrichment } : {}),
      knowledgeBase: recruitmentKnowledge,
      ...(checkpointer ? { checkpointer } : {}),
    }));
  const recruitmentTurnService = new RecruitmentTurnService({
    recruitmentConversation,
    recruitmentTurnCoordinator,
    recruitmentProgressByCase,
    recruitmentProgressEmitters,
    teamRosterEnrichment,
    teamRosterEnrichmentConfigured: Boolean(options.teamRosterEnrichment),
  });
  registerLoopbackRequestGuard(app);
  if (checkpointStore) app.addHook("onClose", async () => checkpointStore.close());

  const recruitmentRouteContext: RecruitmentRouteContext = {
    recruitmentConversation,
    recruitmentTurnCoordinator,
    recruitmentTurnService,
    recruitmentProgressByCase,
    recruitmentProgressEmitters,
    teamRosterEnrichment,
    teamRosterEnrichmentConfigured: Boolean(options.teamRosterEnrichment),
  };
  registerSystemRoutes(app, playerRepository, knowledgeBase);
  registerPlayerObservationRoutes(app, playerObservationLibrary);
  registerRecruitmentProgressRoutes(app, recruitmentRouteContext);
  registerRecruitmentTurnRoute(app, recruitmentRouteContext);
  registerRetiredRoutes(app);

  return app;
}
