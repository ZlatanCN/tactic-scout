import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod/v4";
import { ConversationTurnResponseSchema, RecruitmentProgressSchema, TeamRosterContextSchema, type ConversationTurnResponse, type RecruitmentProgress, type RecruitmentProgressEventStatus } from "../../domain/conversation.js";
import { ConversationTurnRequestSchema } from "../../domain/requirements.js";
import { RecruitmentPositionAnswerError } from "../../recruitment/conversation-turn-runtime.js";
import { RecruitmentCaseStateExpiredError, RecruitmentModelTimeoutError, RecruitmentModelUnavailableError } from "../../recruitment/conversation.js";
import { RecruitmentTurnCancelledError } from "../../recruitment/turn-cancellation.js";
import { RecruitmentTurnCapacityError, RecruitmentTurnIdConflictError } from "../../recruitment/turn-coordinator.js";
import { positionSelectionLabel } from "../../domain/position-selection.js";
import { THESPORTSDB_SOURCE_URL } from "../../sources/thesportsdb/roster.js";
import type { RecruitmentRouteContext } from "./recruitment-types.js";

export function registerRecruitmentTurnRoute(app: FastifyInstance, context: RecruitmentRouteContext): void {
  const {
    recruitmentConversation,
    recruitmentProgressByCase,
    recruitmentProgressEmitters,
    recruitmentTurnCoordinator,
    teamRosterEnrichment,
    teamRosterEnrichmentConfigured,
  } = context;
  app.post<{ Params: { caseId: string } }>("/api/v1/recruitment/cases/:caseId/turns", async (request, reply) => {
    const caseId = request.params.caseId.trim();
    const parsed = ConversationTurnRequestSchema.safeParse(request.body);
    if (!caseId || caseId.length > 128 || !parsed.success) {
      return reply.code(400).send({ error: "请提供有效的案件编号，以及消息或位置选择。" });
    }

    const turnPositions = parsed.data.positionAnswer?.positions ?? parsed.data.positionUpdate;
    const turnMessage = parsed.data.message || (turnPositions ? `已选择：${positionSelectionLabel(turnPositions)}` : parsed.data.playerIdentityAnswer ? "确认参考球员身份" : "");
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
        message: turnMessage,
        ...(parsed.data.positionAnswer ? { positionAnswer: parsed.data.positionAnswer } : {}),
        ...(parsed.data.playerIdentityAnswer ? { playerIdentityAnswer: parsed.data.playerIdentityAnswer } : {}),
        ...(parsed.data.positionUpdate ? { positionUpdate: parsed.data.positionUpdate } : {}),
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
            message: turnMessage,
            ...(parsed.data.positionAnswer ? { positionAnswer: parsed.data.positionAnswer } : {}),
            ...(parsed.data.playerIdentityAnswer ? { playerIdentityAnswer: parsed.data.playerIdentityAnswer } : {}),
            ...(parsed.data.positionUpdate ? { positionUpdate: parsed.data.positionUpdate } : {}),
            expectsExistingState: parsed.data.expectsExistingState,
            signal,
            onProgress: (update) => updateProgress(update, !["waiting_for_user", "completed", "cancelled", "failed"].includes(update.status)),
          });
          const reportTeam = result.status === "completed" ? result.report?.targetTeam?.trim() || null : null;
          let teamRosterContext: ConversationTurnResponse["teamRosterContext"];
          if (reportTeam) {
            if (teamRosterEnrichmentConfigured) updateProgress({
              stage: "team_roster_context",
              message: `正在补充 ${reportTeam} 的公开球队背景`,
              completedSteps: Math.max(0, recruitmentProgressByCase.get(caseId)?.completedSteps ?? 0),
              status: "started",
            });
            try {
              teamRosterContext = await teamRosterEnrichment.lookupTeamRosterSample(
                reportTeam,
                teamRosterEnrichmentConfigured ? signal : undefined,
              );
              if (teamRosterEnrichmentConfigured) updateProgress({
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
      if (error instanceof RecruitmentPositionAnswerError) return reply.code(409).send({ error: error.message });
      if (error instanceof RecruitmentTurnIdConflictError) return reply.code(409).send({ error: error.message });
      if (error instanceof RecruitmentTurnCapacityError) return reply.code(503).send({ error: error.message });
      const message = error instanceof Error ? error.message : "招募对话暂时无法继续。";
      if (error instanceof RecruitmentModelUnavailableError) return reply.code(503).send({ error: message });
      if (error instanceof RecruitmentCaseStateExpiredError) return reply.code(409).send({ error: message });
      if (error instanceof RecruitmentModelTimeoutError) return reply.code(504).send({ error: message });
      return reply.code(502).send({ error: message });
    }
  });
}
