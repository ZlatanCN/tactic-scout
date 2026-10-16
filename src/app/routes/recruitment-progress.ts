import type { FastifyInstance } from "fastify";
import { z } from "zod/v4";
import { RecruitmentProgressSchema, RecruitmentTurnCancellationResponseSchema } from "../../domain/conversation.js";
import type { RecruitmentRouteContext } from "./recruitment-types.js";

export function registerRecruitmentProgressRoutes(app: FastifyInstance, context: RecruitmentRouteContext): void {
  const { recruitmentProgressByCase, recruitmentProgressEmitters, recruitmentTurnCoordinator } = context;
  app.get<{ Params: { caseId: string }; Querystring: { requestId?: string } }>("/api/v1/recruitment/cases/:caseId/progress", async (request, reply) => {
    const progress = recruitmentProgressByCase.get(request.params.caseId);
    if (!progress
      || Date.now() - Date.parse(progress.updatedAt) > 30 * 60 * 1000
      || (request.query.requestId && progress.requestId !== request.query.requestId)) {
      return reply.code(404).send({ error: "当前案件没有可用的进行状态。" });
    }
    return RecruitmentProgressSchema.parse(progress);
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
    if (emitProgress && progress && progress.requestId === requestId.data && progress.active
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
}
