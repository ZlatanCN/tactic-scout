import Fastify from "fastify";
import type { ConversationTurnResponse, RecruitmentProgress, RecruitmentProgressEventStatus } from "./domain/conversation.js";
import { registerLoopbackRequestGuard } from "./app/security.js";
import { registerPlayerObservationRoutes } from "./app/routes/player-observations.js";
import { registerRetiredRoutes } from "./app/routes/retired.js";
import { registerRecruitmentProgressRoutes } from "./app/routes/recruitment-progress.js";
import { registerRecruitmentTurnRoute } from "./app/routes/recruitment-turn.js";
import { registerSystemRoutes } from "./app/routes/system.js";
import type { RecruitmentRouteContext } from "./app/routes/recruitment-types.js";
import { registerRecruitmentPreferenceRoutes } from "./app/routes/recruitment-preferences.js";
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
import { SQLiteBaseStore } from "./recruitment/preferences/sqlite-base-store.js";
import { RecruitmentPreferencesService } from "./recruitment/preferences/service.js";

export function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: true });
  const playerRepository = options.playerRepository ?? createRepository();
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
  const preferenceStore = options.preferenceStore ?? new SQLiteBaseStore(options.preferenceStorePath);
  const recruitmentPreferences = new RecruitmentPreferencesService(preferenceStore);
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
      store: preferenceStore,
    })
    : configuredRecruitmentConversation({
      repository: playerRepository,
      ...(options.teamRosterEnrichment ? { teamRosterEnrichment: options.teamRosterEnrichment } : {}),
      knowledgeBase: recruitmentKnowledge,
      ...(checkpointer ? { checkpointer } : {}),
      store: preferenceStore,
    }));
  const recruitmentTurnService = new RecruitmentTurnService({
    recruitmentConversation,
    recruitmentTurnCoordinator,
    recruitmentProgressByCase,
    recruitmentProgressEmitters,
    teamRosterEnrichment,
    teamRosterEnrichmentConfigured: Boolean(options.teamRosterEnrichment),
    recruitmentPreferences,
  });
  registerLoopbackRequestGuard(app);
  let safeToCloseStores = true;
  app.addHook("preClose", async () => {
    const drain = await recruitmentTurnService.drain(30_000);
    safeToCloseStores = drain.status === "drained";
    if (drain.status === "timeout") {
      app.log.warn({ activeTurns: drain.activeTurns }, "Recruitment service drain timed out; leaving stores open for active graph runs");
    } else {
      app.log.info({ activeTurns: drain.activeTurns }, "Recruitment service drained to durable graph boundaries");
    }
  });

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
  registerRecruitmentPreferenceRoutes(app, recruitmentPreferences);
  registerPlayerObservationRoutes(app, playerObservationLibrary);
  registerRecruitmentProgressRoutes(app, recruitmentRouteContext);
  registerRecruitmentTurnRoute(app, recruitmentRouteContext);
  registerRetiredRoutes(app);

  app.addHook("onClose", async () => {
    if (!safeToCloseStores) return;
    checkpointStore?.close();
    if (playerRepository.close) playerRepository.close();
    await preferenceStore.stop();
    app.log.info("Recruitment SQLite checkpoint and preference stores closed after drain");
  });

  return app;
}
