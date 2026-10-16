import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import {
  ConversationTurnRequestSchema,
  ConversationTurnResponseSchema,
  DatasetStatusSchema,
  RecruitmentProgressSchema,
  RecruitmentTurnCancellationResponseSchema,
  TeamRosterContextSchema,
  type ConversationTurnResponse,
  type RecruitmentProgress,
  type RecruitmentProgressEventStatus,
} from "./domain/schemas.js";
import { createTheSportsDbRosterEnrichment, THESPORTSDB_SOURCE_URL, type TeamRosterEnrichmentProvider } from "./data/thesportsdb-roster.js";
import { createRecruitmentCheckpointStore } from "./agent/checkpoint-store.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createRepository } from "./data/provider.js";
import { type PlayerRepository } from "./data/player-repository.js";
import { RecruitmentCaseStateExpiredError, RecruitmentModelTimeoutError, RecruitmentModelUnavailableError, configuredRecruitmentConversation, createRecruitmentConversation, type RecruitmentConversation, type RecruitmentPlanner } from "./agent/conversation.js";
import { createLocalKnowledgeBase, type KnowledgeBase, type KnowledgeRepository } from "./knowledge/index.js";
import { createWebSearchKnowledgeRepository } from "./knowledge/web-player-report-search.js";
import { KnowledgeStatusSchema } from "./knowledge/schemas.js";
import { createPlayerObservationLibrary, PlayerObservationNotFoundError, type PlayerObservationLibrary } from "./observations/library.js";
import { PlayerObservationInputSchema, PlayerObservationListSchema, PlayerObservationSchema } from "./observations/schemas.js";
import { RecruitmentTurnCancelledError } from "./agent/turn-cancellation.js";
import { RecruitmentTurnCapacityError, RecruitmentTurnCoordinator, RecruitmentTurnIdConflictError } from "./agent/turn-coordinator.js";

type AppKnowledgeBase = KnowledgeRepository & Pick<KnowledgeBase, "status" | "ingest" | "removeDocument">;

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    const host = new URL(`http://${hostHeader}`);
    return !host.username && !host.password && isLoopbackHostname(host.hostname.toLocaleLowerCase());
  } catch {
    return false;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password
      && isLoopbackHostname(url.hostname.toLocaleLowerCase());
  } catch {
    return false;
  }
}

export function createApp(options: {
  playerRepository?: PlayerRepository;
  recruitmentConversation?: RecruitmentConversation;
  recruitmentPlanner?: RecruitmentPlanner;
  knowledgeBase?: AppKnowledgeBase;
  playerObservationLibrary?: PlayerObservationLibrary;
  playerObservationsPath?: string;
  checkpointer?: BaseCheckpointSaver;
  checkpointPath?: string;
  teamRosterEnrichment?: TeamRosterEnrichmentProvider;
} = {}) {
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
  app.addHook("onRequest", async (request, reply) => {
    if (!isLoopbackHostHeader(request.headers.host)) {
      return reply.code(403).send({ error: "仅允许从本机访问 TactiScout。" });
    }
    if (request.headers.origin && !isLoopbackOrigin(request.headers.origin)) {
      return reply.code(403).send({ error: "已拒绝来自非本机网页的请求。" });
    }
    if (request.headers["sec-fetch-site"] === "cross-site") {
      return reply.code(403).send({ error: "已拒绝跨站请求。" });
    }
  });
  if (checkpointStore) app.addHook("onClose", async () => checkpointStore.close());

  app.get("/health", async () => ({ status: "ok", service: "tactiscout-api" }));
  app.get("/api/v1/dataset", async () => {
    const snapshot = await playerRepository.getDatasetStatus?.();
    return DatasetStatusSchema.parse({
      mode: playerRepository.mode,
      source: playerRepository.sourceName,
      ...(snapshot ? { snapshot } : {}),
    });
  });
  app.get("/api/v1/knowledge/status", async () => KnowledgeStatusSchema.parse(await knowledgeBase.status()));
  app.get("/api/v1/player-observations", async () => PlayerObservationListSchema.parse(await playerObservationLibrary.list()));

  app.post("/api/v1/player-observations", async (request, reply) => {
    const parsed = PlayerObservationInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "球探观察资料不完整或未同意本地保存。", details: parsed.error.flatten() });
    try {
      return reply.code(201).send(PlayerObservationSchema.parse(await playerObservationLibrary.save(null, parsed.data)));
    } catch (error) {
      request.log.error({ err: error }, "Player observation could not be saved");
      return reply.code(502).send({ error: error instanceof Error ? error.message : "球探观察暂时无法保存。" });
    }
  });

  app.put<{ Params: { observationId: string } }>("/api/v1/player-observations/:observationId", async (request, reply) => {
    const parsed = PlayerObservationInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "球探观察资料不完整或未同意本地保存。", details: parsed.error.flatten() });
    try {
      return PlayerObservationSchema.parse(await playerObservationLibrary.save(request.params.observationId, parsed.data));
    } catch (error) {
      if (error instanceof PlayerObservationNotFoundError) return reply.code(404).send({ error: error.message });
      request.log.error({ err: error }, "Player observation could not be updated");
      return reply.code(502).send({ error: error instanceof Error ? error.message : "球探观察暂时无法更新。" });
    }
  });

  app.delete<{ Params: { observationId: string } }>("/api/v1/player-observations/:observationId", async (request, reply) => {
    try {
      await playerObservationLibrary.delete(request.params.observationId);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof PlayerObservationNotFoundError) return reply.code(404).send({ error: error.message });
      request.log.error({ err: error }, "Player observation could not be deleted");
      return reply.code(502).send({ error: error instanceof Error ? error.message : "球探观察暂时无法删除。" });
    }
  });

  app.get<{ Params: { caseId: string }; Querystring: { requestId?: string } }>("/api/v1/recruitment/cases/:caseId/progress", async (request, reply) => {
    const progress = recruitmentProgressByCase.get(request.params.caseId);
    if (!progress
      || Date.now() - Date.parse(progress.updatedAt) > 30 * 60 * 1000
      || (request.query.requestId && progress.requestId !== request.query.requestId)) {
      return reply.code(404).send({ error: "当前案件没有可用的进行状态。" });
    }
    return RecruitmentProgressSchema.parse(progress);
  });

  app.post("/api/v1/requirements/parse", async (_request, reply) => {
    return reply.code(410).send({
      error: "独立需求解析接口已停用，请直接通过自然语言招募案件开始调查。",
      replacement: {
        method: "POST",
        path: "/api/v1/recruitment/cases/:caseId/turns",
      },
    });
  });

  app.post<{ Params: { caseId: string } }>("/api/v1/recruitment/cases/:caseId/turns", async (request, reply) => {
    const caseId = request.params.caseId.trim();
    const parsed = ConversationTurnRequestSchema.safeParse(request.body);
    if (!caseId || caseId.length > 128 || !parsed.success) {
      return reply.code(400).send({ error: "请提供有效的案件编号和 1–4000 字的消息。" });
    }

    const progressEvents: RecruitmentProgress["events"] = [];
    const stageOccurrences = new Map<RecruitmentProgress["stage"], number>();
    let progressSequence = 0;
    const updateProgress = (
      update: Pick<RecruitmentProgress, "stage" | "message" | "completedSteps"> & { status?: RecruitmentProgressEventStatus },
      active = true,
    ) => {
      const current = recruitmentProgressByCase.get(caseId);
      if (current?.requestId === requestId
        && (current.stage === "cancelled" || (current.stage === "cancelling" && update.stage !== "cancelled" && update.status !== "cancelled"))) return;
      const updatedAt = new Date().toISOString();
      const { status = "started", ...progressState } = update;
      progressSequence += 1;
      const occurrence = status === "started"
        ? (stageOccurrences.get(update.stage) ?? 0) + 1
        : stageOccurrences.get(update.stage) ?? 1;
      if (status === "started") stageOccurrences.set(update.stage, occurrence);
      progressEvents.push({
        sequence: progressSequence,
        occurrence,
        stage: update.stage,
        status,
        message: update.message,
        occurredAt: updatedAt,
      });
      if (progressEvents.length > 24) progressEvents.shift();
      recruitmentProgressByCase.set(caseId, RecruitmentProgressSchema.parse({
        requestId,
        ...progressState,
        active,
        updatedAt,
        events: progressEvents,
      }));
    };

    const requestId = parsed.data.requestId ?? randomUUID();
    const progressKey = JSON.stringify([caseId, requestId]);
    try {
      let response = await recruitmentTurnCoordinator.run({
        caseId,
        requestId,
        message: parsed.data.message,
        expectsExistingState: parsed.data.expectsExistingState,
      }, async (signal) => {
        for (const [knownCaseId, progress] of recruitmentProgressByCase) {
          if (Date.now() - Date.parse(progress.updatedAt) > 30 * 60 * 1000) recruitmentProgressByCase.delete(knownCaseId);
        }
        while (recruitmentProgressByCase.size >= 250) {
          const oldestCaseId = recruitmentProgressByCase.keys().next().value;
          if (!oldestCaseId) break;
          recruitmentProgressByCase.delete(oldestCaseId);
        }
        recruitmentProgressEmitters.set(progressKey, updateProgress);
        updateProgress({ stage: "starting", message: "已启动本轮球探调查", completedSteps: 0, status: "started" });
        try {
          const result = await recruitmentConversation.turn({
            threadId: caseId,
            message: parsed.data.message,
            expectsExistingState: parsed.data.expectsExistingState,
            signal,
            onProgress: (update) => updateProgress(update, !["waiting_for_user", "completed", "cancelled", "failed"].includes(update.status)),
          });
          const reportTeam = result.status === "completed" ? result.report?.targetTeam?.trim() || null : null;
          let teamRosterContext: ConversationTurnResponse["teamRosterContext"];
          if (reportTeam) {
            if (options.teamRosterEnrichment) updateProgress({
              stage: "team_roster_context",
              message: `正在补充 ${reportTeam} 的公开球队背景`,
              completedSteps: Math.max(0, recruitmentProgressByCase.get(caseId)?.completedSteps ?? 0),
              status: "started",
            });
            try {
              teamRosterContext = await teamRosterEnrichment.lookupTeamRosterSample(
                reportTeam,
                options.teamRosterEnrichment ? signal : undefined,
              );
              if (options.teamRosterEnrichment) updateProgress({
                stage: "team_roster_context",
                message: teamRosterContext.notice,
                completedSteps: Math.max(0, recruitmentProgressByCase.get(caseId)?.completedSteps ?? 0),
                status: teamRosterContext.status === "unavailable" ? "notice" : "completed",
              }, false);
            } catch (error) {
              if (signal.aborted) {
                updateProgress({
                  stage: "team_roster_context",
                  message: "报告已完成；可选的球队背景补充已停止",
                  completedSteps: Math.max(0, recruitmentProgressByCase.get(caseId)?.completedSteps ?? 0),
                  status: "cancelled",
                }, false);
                teamRosterContext = TeamRosterContextSchema.parse({
                  status: "unavailable",
                  requestedTeam: reportTeam,
                  matchedTeams: [],
                  team: null,
                  players: [],
                  returnedCount: 0,
                  resultLimit: 10,
                  possiblyTruncated: false,
                  retrievedAt: null,
                  sourceUrl: THESPORTSDB_SOURCE_URL,
                  failureKind: "cancelled",
                  notice: "核心球探报告已完成；用户停止了可选的 TheSportsDB 球队背景查询。",
                });
              } else {
                request.log.warn({ caseId, errorName: error instanceof Error ? error.name : "UnknownError" }, "Optional TheSportsDB roster context failed");
                teamRosterContext = TeamRosterContextSchema.parse({
                  status: "unavailable",
                  requestedTeam: reportTeam,
                  matchedTeams: [],
                  team: null,
                  players: [],
                  returnedCount: 0,
                  resultLimit: 10,
                  possiblyTruncated: false,
                  retrievedAt: null,
                  sourceUrl: THESPORTSDB_SOURCE_URL,
                  failureKind: "network",
                  notice: "核心球探报告已完成，但 TheSportsDB 补充查询遇到问题；没有把失败解释为空阵容。",
                });
                updateProgress({
                  stage: "team_roster_context",
                  message: teamRosterContext.notice,
                  completedSteps: Math.max(0, recruitmentProgressByCase.get(caseId)?.completedSteps ?? 0),
                  status: "notice",
                }, false);
              }
            }
          }
          const progress = recruitmentProgressByCase.get(caseId);
          return ConversationTurnResponseSchema.parse({
            ...result,
            ...(teamRosterContext ? { teamRosterContext } : {}),
            ...(parsed.data.requestId && progress?.requestId === requestId ? { progressEvents: progress.events } : {}),
          });
        } catch (error) {
          const progress = recruitmentProgressByCase.get(caseId);
          if (error instanceof RecruitmentTurnCancelledError) {
            if (progress?.requestId === requestId && progress.events.at(-1)?.status !== "cancelled") {
              updateProgress({
                stage: "cancelled",
                status: "cancelled",
                message: "本轮已停止，没有生成新的报告",
                completedSteps: progress.completedSteps,
              }, false);
            } else if (progress?.requestId === requestId) {
              recruitmentProgressByCase.set(caseId, RecruitmentProgressSchema.parse({ ...progress, active: false }));
            }
          } else if (progress?.requestId === requestId) {
            if (progress.events.at(-1)?.status !== "failed") updateProgress({
              stage: "failed",
              status: "failed",
              message: "本轮调查遇到问题，详情见下方错误信息",
              completedSteps: progress.completedSteps,
            }, false);
            else recruitmentProgressByCase.set(caseId, RecruitmentProgressSchema.parse({ ...progress, active: false }));
          }
          if (!(error instanceof RecruitmentModelUnavailableError)
            && !(error instanceof RecruitmentCaseStateExpiredError)
            && !(error instanceof RecruitmentModelTimeoutError)
            && !(error instanceof RecruitmentTurnCancelledError)) {
            request.log.error({ err: error, caseId }, "Recruitment conversation failed");
          }
          throw error;
        } finally {
          if (recruitmentProgressEmitters.get(progressKey) === updateProgress) {
            recruitmentProgressEmitters.delete(progressKey);
          }
        }
      }, (completedResponse) => completedResponse.teamRosterContext
        && completedResponse.teamRosterContext.status !== "not_configured"
        ? { ...completedResponse, teamRosterContext: undefined }
        : completedResponse);
      if (response.status === "completed" && response.report?.targetTeam && !response.teamRosterContext) {
        response = ConversationTurnResponseSchema.parse({
          ...response,
          teamRosterContext: TeamRosterContextSchema.parse({
            status: "unavailable",
            requestedTeam: response.report.targetTeam,
            matchedTeams: [],
            team: null,
            players: [],
            returnedCount: 0,
            resultLimit: 10,
            possiblyTruncated: false,
            retrievedAt: null,
            sourceUrl: THESPORTSDB_SOURCE_URL,
            failureKind: "ephemeral_replay",
            notice: "为避免保留外部球队名单，幂等重放不会复用临时背景资料；本次球探报告仍可使用。",
          }),
        });
      }
      return response;
    } catch (error) {
      if (error instanceof RecruitmentTurnCancelledError) {
        const progress = recruitmentProgressByCase.get(caseId);
        return ConversationTurnResponseSchema.parse({
          threadId: caseId,
          status: "cancelled",
          message: "本轮调查已停止，没有生成新的报告。你可以修改需求后重新开始。",
          question: null,
          report: null,
          ...(parsed.data.requestId && progress?.requestId === requestId ? { progressEvents: progress.events } : {}),
        });
      }
      if (error instanceof RecruitmentTurnIdConflictError) return reply.code(409).send({ error: error.message });
      if (error instanceof RecruitmentTurnCapacityError) return reply.code(503).send({ error: error.message });
      const message = error instanceof Error ? error.message : "招募对话暂时无法继续。";
      if (error instanceof RecruitmentModelUnavailableError) return reply.code(503).send({ error: message });
      if (error instanceof RecruitmentCaseStateExpiredError) return reply.code(409).send({ error: message });
      if (error instanceof RecruitmentModelTimeoutError) return reply.code(504).send({ error: message });
      return reply.code(502).send({ error: message });
    }
  });

  app.post<{ Params: { caseId: string; requestId: string } }>("/api/v1/recruitment/cases/:caseId/turns/:requestId/cancel", async (request, reply) => {
    const caseId = request.params.caseId.trim();
    const requestId = z.string().uuid().safeParse(request.params.requestId);
    if (!caseId || caseId.length > 128 || !requestId.success) {
      return reply.code(400).send({ error: "请提供有效的案件编号和本轮请求编号。" });
    }

    const cancellation = recruitmentTurnCoordinator.cancel(caseId, requestId.data);
    if (cancellation === "not_found") {
      return reply.code(404).send({ error: "找不到这轮调查；请恢复原请求以确认它是否已经结束。" });
    }
    if (cancellation === "already_settled") {
      return RecruitmentTurnCancellationResponseSchema.parse({ status: "already_settled" });
    }

    const progressKey = JSON.stringify([caseId, requestId.data]);
    const progress = recruitmentProgressByCase.get(caseId);
    const emitProgress = recruitmentProgressEmitters.get(progressKey);
    if (emitProgress && progress?.requestId === requestId.data && progress.active
      && progress.stage !== "cancelling" && progress.stage !== "cancelled") {
      emitProgress({
        stage: "cancelling",
        status: "started",
        message: "已收到停止请求，正在结束本轮调查",
        completedSteps: progress.completedSteps,
      });
    }
    return RecruitmentTurnCancellationResponseSchema.parse({ status: "requested" });
  });

  app.post("/api/v1/scout", async (_request, reply) => {
    return reply.code(410).send({
      error: "旧版一次性球探接口已停用，请改用自然语言招募案件。",
      replacement: {
        method: "POST",
        path: "/api/v1/recruitment/cases/:caseId/turns",
      },
    });
  });

  return app;
}
