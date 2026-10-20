import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { RunControl } from "@langchain/langgraph";
import {
  ConversationTurnResponseSchema,
  type RecruitmentCandidatesEvent,
  RecruitmentProgressSchema,
  TeamRosterContextSchema,
  type ConversationTurnResponse,
  type RecruitmentProgress,
  type RecruitmentProgressEventStatus,
} from "../domain/conversation.js";
import { positionSelectionLabel } from "../domain/position-selection.js";
import type { ConversationTurnRequest } from "../domain/requirements.js";
import { type RecruitmentTurnRuntimeEvents, RecruitmentGraphNodeFailureError, RecruitmentPositionAnswerError, RecruitmentServiceDrainingError } from "../recruitment/conversation-turn-runtime.js";
import {
  RecruitmentCaseStateExpiredError,
  RecruitmentModelTimeoutError,
  RecruitmentModelUnavailableError,
  type RecruitmentConversation,
} from "../recruitment/conversation.js";
import { RecruitmentTurnCancelledError } from "../recruitment/turn-cancellation.js";
import {
  RecruitmentTurnCapacityError,
  RecruitmentTurnIdConflictError,
  type RecruitmentTurnCoordinator,
} from "../recruitment/turn-coordinator.js";
import { THESPORTSDB_SOURCE_URL, type TeamRosterEnrichmentProvider } from "../sources/thesportsdb/roster.js";
import type { RecruitmentProgressEmitter } from "./routes/recruitment-types.js";
import type { RecruitmentPreferencesService } from "../recruitment/preferences/service.js";

export class RecruitmentServiceDrainingStateError extends Error {
  constructor() {
    super("球探服务正在停止接收新调查，请在服务重启后继续。");
    this.name = "RecruitmentServiceDrainingStateError";
  }
}

export type RecruitmentTurnServiceError = {
  statusCode: 409 | 502 | 503 | 504;
  message: string;
};

export class RecruitmentTurnService {
  private draining = false;
  private readonly activeControls = new Set<RunControl>();
  private readonly activeTurns = new Set<Promise<unknown>>();

  constructor(private readonly dependencies: {
    recruitmentConversation: RecruitmentConversation;
    recruitmentTurnCoordinator: RecruitmentTurnCoordinator<ConversationTurnResponse>;
    recruitmentProgressByCase: Map<string, RecruitmentProgress>;
    recruitmentProgressEmitters: Map<string, RecruitmentProgressEmitter>;
    teamRosterEnrichment: TeamRosterEnrichmentProvider;
    teamRosterEnrichmentConfigured: boolean;
    recruitmentPreferences?: RecruitmentPreferencesService;
  }) {}

  async drain(timeoutMs: number): Promise<{ status: "drained" | "timeout"; activeTurns: number }> {
    this.draining = true;
    for (const control of this.activeControls) control.requestDrain("service_shutdown");
    const active = [...this.activeTurns];
    if (!active.length) return { status: "drained", activeTurns: 0 };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      Promise.allSettled(active).then(() => "drained" as const),
      new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); }),
    ]);
    if (timer) clearTimeout(timer);
    return { status: result, activeTurns: this.activeTurns.size };
  }

  async execute(input: {
    caseId: string;
    request: ConversationTurnRequest;
    logger: FastifyBaseLogger;
    onProgress?: (progress: RecruitmentProgress) => void;
    onCandidates?: RecruitmentTurnRuntimeEvents["onCandidates"];
  }): Promise<ConversationTurnResponse> {
    const { caseId, request, logger, onProgress, onCandidates } = input;
    if (this.draining) throw new RecruitmentServiceDrainingStateError();
    const requestId = request.requestId ?? randomUUID();
    const progressEvents: RecruitmentProgress["events"] = [];
    const stageOccurrences = new Map<RecruitmentProgress["stage"], number>();
    let progressSequence = 0;
    const updateProgress = (
      update: Pick<RecruitmentProgress, "stage" | "message" | "completedSteps"> & { status?: RecruitmentProgressEventStatus },
      active = true,
    ) => {
      const current = this.dependencies.recruitmentProgressByCase.get(caseId);
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
      const progress = RecruitmentProgressSchema.parse({
        requestId,
        ...progressState,
        active,
        updatedAt,
        events: progressEvents,
      });
      this.dependencies.recruitmentProgressByCase.set(caseId, progress);
      onProgress?.(progress);
    };

    const turnPositions = request.positionAnswer?.positions ?? request.positionUpdate;
    const turnMessage = request.message || (turnPositions ? `已选择：${positionSelectionLabel(turnPositions)}` : request.playerIdentityAnswer ? "确认参考球员身份" : "");
    const progressKey = JSON.stringify([caseId, requestId]);
    try {
      const coordinatedTurn = this.dependencies.recruitmentTurnCoordinator.run({
        caseId,
        requestId,
        message: turnMessage,
        ...(request.positionAnswer ? { positionAnswer: request.positionAnswer } : {}),
        ...(request.playerIdentityAnswer ? { playerIdentityAnswer: request.playerIdentityAnswer } : {}),
        ...(request.positionUpdate ? { positionUpdate: request.positionUpdate } : {}),
        expectsExistingState: request.expectsExistingState,
      }, async (signal) => {
        if (this.draining) throw new RecruitmentServiceDrainingStateError();
        const runControl = new RunControl();
        this.activeControls.add(runControl);
        if (this.draining) runControl.requestDrain("service_shutdown");
        for (const [knownCaseId, progress] of this.dependencies.recruitmentProgressByCase) {
          if (Date.now() - Date.parse(progress.updatedAt) > 30 * 60 * 1000) this.dependencies.recruitmentProgressByCase.delete(knownCaseId);
        }
        while (this.dependencies.recruitmentProgressByCase.size >= 250) {
          const oldestCaseId = this.dependencies.recruitmentProgressByCase.keys().next().value;
          if (!oldestCaseId) break;
          this.dependencies.recruitmentProgressByCase.delete(oldestCaseId);
        }
        this.dependencies.recruitmentProgressEmitters.set(progressKey, updateProgress);
        updateProgress({ stage: "starting", message: "已启动本轮球探调查", completedSteps: 0, status: "started" });
        try {
          const result = await this.dependencies.recruitmentConversation.turn({
            threadId: caseId,
            message: turnMessage,
            ...(request.positionAnswer ? { positionAnswer: request.positionAnswer } : {}),
            ...(request.playerIdentityAnswer ? { playerIdentityAnswer: request.playerIdentityAnswer } : {}),
            ...(request.positionUpdate ? { positionUpdate: request.positionUpdate } : {}),
            expectsExistingState: request.expectsExistingState,
            signal,
            runControl,
            ...(request.memoryOwnerId && this.dependencies.recruitmentPreferences ? {
              runtimeContext: {
                userPreferences: await this.readPreferences(request.memoryOwnerId, logger),
              },
            } : {}),
            onProgress: (update) => updateProgress(update, !["waiting_for_user", "completed", "cancelled", "failed"].includes(update.status)),
            ...(onCandidates ? { onCandidates } : {}),
          });
          const reportTeam = result.status === "completed" ? result.report?.targetTeam?.trim() || null : null;
          let teamRosterContext: ConversationTurnResponse["teamRosterContext"];
          if (reportTeam) {
            if (this.dependencies.teamRosterEnrichmentConfigured) updateProgress({
              stage: "team_roster_context",
              message: `正在补充 ${reportTeam} 的公开球队背景`,
              completedSteps: Math.max(0, this.dependencies.recruitmentProgressByCase.get(caseId)?.completedSteps ?? 0),
              status: "started",
            });
            try {
              teamRosterContext = await this.dependencies.teamRosterEnrichment.lookupTeamRosterSample(
                reportTeam,
                this.dependencies.teamRosterEnrichmentConfigured ? signal : undefined,
              );
              if (this.dependencies.teamRosterEnrichmentConfigured) updateProgress({
                stage: "team_roster_context",
                message: teamRosterContext.notice,
                completedSteps: Math.max(0, this.dependencies.recruitmentProgressByCase.get(caseId)?.completedSteps ?? 0),
                status: teamRosterContext.status === "unavailable" ? "notice" : "completed",
              }, false);
            } catch (error) {
              if (signal.aborted) {
                updateProgress({
                  stage: "team_roster_context",
                  message: "报告已完成；可选的球队背景补充已停止",
                  completedSteps: Math.max(0, this.dependencies.recruitmentProgressByCase.get(caseId)?.completedSteps ?? 0),
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
                logger.warn({ caseId, errorName: error instanceof Error ? error.name : "UnknownError" }, "Optional TheSportsDB roster context failed");
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
                  completedSteps: Math.max(0, this.dependencies.recruitmentProgressByCase.get(caseId)?.completedSteps ?? 0),
                  status: "notice",
                }, false);
              }
            }
          }
          const latestProgress = this.dependencies.recruitmentProgressByCase.get(caseId);
          const terminalStage = result.status === "needs_input" ? "asking_user"
            : result.status === "cancelled" ? "cancelled" : "completed";
          const terminalStatus = result.status === "needs_input" ? "waiting_for_user"
            : result.status === "cancelled" ? "cancelled" : "completed";
          if (latestProgress?.stage !== terminalStage || latestProgress.active) updateProgress({
            stage: terminalStage,
            status: terminalStatus,
            message: result.message,
            completedSteps: latestProgress?.completedSteps ?? 0,
          }, false);
          const progress = this.dependencies.recruitmentProgressByCase.get(caseId);
          return ConversationTurnResponseSchema.parse({
            ...result,
            ...(teamRosterContext ? { teamRosterContext } : {}),
            ...(request.requestId && progress?.requestId === requestId ? { progressEvents: progress.events } : {}),
          });
        } catch (error) {
          const progress = this.dependencies.recruitmentProgressByCase.get(caseId);
          if (error instanceof RecruitmentTurnCancelledError) {
            if (progress?.requestId === requestId && progress.events.at(-1)?.status !== "cancelled") {
              updateProgress({
                stage: "cancelled",
                status: "cancelled",
                message: "本轮已停止，没有生成新的报告",
                completedSteps: progress.completedSteps,
              }, false);
            } else if (progress?.requestId === requestId) {
              this.dependencies.recruitmentProgressByCase.set(caseId, RecruitmentProgressSchema.parse({ ...progress, active: false }));
            }
          } else if (error instanceof RecruitmentServiceDrainingError) {
            if (progress?.requestId === requestId) updateProgress({
              stage: "service_draining",
              status: "notice",
              message: "服务正在安全停止；案件已保存，可在服务重启后继续",
              completedSteps: progress.completedSteps,
            }, false);
          } else if (progress?.requestId === requestId) {
            if (progress.events.at(-1)?.status !== "failed") updateProgress({
              stage: "failed",
              status: "failed",
              message: "本轮调查遇到问题，详情见下方错误信息",
              completedSteps: progress.completedSteps,
            }, false);
            else this.dependencies.recruitmentProgressByCase.set(caseId, RecruitmentProgressSchema.parse({ ...progress, active: false }));
          }
          if (!(error instanceof RecruitmentModelUnavailableError)
            && !(error instanceof RecruitmentCaseStateExpiredError)
            && !(error instanceof RecruitmentModelTimeoutError)
            && !(error instanceof RecruitmentServiceDrainingError)
            && !(error instanceof RecruitmentTurnCancelledError)) {
            logger.error({ err: error, caseId }, "Recruitment conversation failed");
          }
          throw error;
        } finally {
          this.activeControls.delete(runControl);
          if (this.dependencies.recruitmentProgressEmitters.get(progressKey) === updateProgress) {
            this.dependencies.recruitmentProgressEmitters.delete(progressKey);
          }
        }
      }, (completedResponse) => completedResponse.teamRosterContext
        && completedResponse.teamRosterContext.status !== "not_configured"
        ? { ...completedResponse, teamRosterContext: undefined }
        : completedResponse);
      this.activeTurns.add(coordinatedTurn);
      void coordinatedTurn.finally(() => this.activeTurns.delete(coordinatedTurn)).catch(() => undefined);
      let response = await coordinatedTurn;
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
        const progress = this.dependencies.recruitmentProgressByCase.get(caseId);
        return ConversationTurnResponseSchema.parse({
          threadId: caseId,
          status: "cancelled",
          message: "本轮调查已停止，没有生成新的报告。你可以修改需求后重新开始。",
          question: null,
          report: null,
          ...(request.requestId && progress?.requestId === requestId ? { progressEvents: progress.events } : {}),
        });
      }
      if (error instanceof RecruitmentServiceDrainingError || error instanceof RecruitmentServiceDrainingStateError) throw error;
      throw error;
    }
  }

  private async readPreferences(memoryOwnerId: string, logger: FastifyBaseLogger) {
    try {
      return await this.dependencies.recruitmentPreferences!.list(memoryOwnerId);
    } catch (error) {
      logger.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Recruitment preferences unavailable; continuing without browser preferences");
      return [];
    }
  }
}

export function recruitmentTurnHttpError(error: unknown): RecruitmentTurnServiceError {
  const message = error instanceof Error ? error.message : "招募对话暂时无法继续。";
  if (error instanceof RecruitmentPositionAnswerError
    || error instanceof RecruitmentTurnIdConflictError
    || error instanceof RecruitmentCaseStateExpiredError) return { statusCode: 409, message };
  if (error instanceof RecruitmentTurnCapacityError || error instanceof RecruitmentModelUnavailableError) return { statusCode: 503, message };
  if (error instanceof RecruitmentServiceDrainingError || error instanceof RecruitmentServiceDrainingStateError) return { statusCode: 503, message };
  if (error instanceof RecruitmentModelTimeoutError) return { statusCode: 504, message };
  if (error instanceof RecruitmentGraphNodeFailureError) return { statusCode: error.category === "timeout" ? 504 : 502, message };
  return { statusCode: 502, message };
}
