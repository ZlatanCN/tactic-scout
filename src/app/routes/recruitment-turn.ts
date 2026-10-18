import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ConversationTurnRequestSchema } from "../../domain/requirements.js";
import { recruitmentTurnHttpError } from "../recruitment-turn-service.js";
import { openRecruitmentEventStream } from "./recruitment-sse.js";
import type { RecruitmentRouteContext } from "./recruitment-types.js";

export function registerRecruitmentTurnRoute(app: FastifyInstance, context: RecruitmentRouteContext): void {
  const { recruitmentTurnService, recruitmentProgressByCase } = context;

  app.post<{ Params: { caseId: string } }>("/api/v1/recruitment/cases/:caseId/turns", async (request, reply) => {
    const caseId = request.params.caseId.trim();
    const parsed = ConversationTurnRequestSchema.safeParse(request.body);
    if (!caseId || caseId.length > 128 || !parsed.success) {
      return reply.code(400).send({ error: "请提供有效的案件编号，以及消息或位置选择。" });
    }
    try {
      return await recruitmentTurnService.execute({
        caseId,
        request: parsed.data,
        logger: request.log,
      });
    } catch (error) {
      const failure = recruitmentTurnHttpError(error);
      return reply.code(failure.statusCode).send({ error: failure.message });
    }
  });

  app.post<{ Params: { caseId: string } }>("/api/v1/recruitment/cases/:caseId/turns/stream", async (request, reply) => {
    const caseId = request.params.caseId.trim();
    const parsed = ConversationTurnRequestSchema.safeParse(request.body);
    if (!caseId || caseId.length > 128 || !parsed.success) {
      return reply.code(400).send({ error: "请提供有效的案件编号，以及消息或位置选择。" });
    }

    const requestId = parsed.data.requestId ?? randomUUID();
    const turnRequest = { ...parsed.data, requestId };
    let emittedRequestId = requestId;
    const eventStream = openRecruitmentEventStream(reply);
    const pingTimer = setInterval(() => eventStream.ping(), 15_000);
    try {
      const replayedProgress = recruitmentProgressByCase.get(caseId);
      if (replayedProgress?.requestId === requestId && replayedProgress.active) {
        eventStream.send({ type: "progress", requestId, progress: replayedProgress });
      }
      const response = await recruitmentTurnService.execute({
        caseId,
        request: turnRequest,
        logger: request.log,
        onProgress: (progress) => {
          if (progress.requestId && progress.requestId !== emittedRequestId) emittedRequestId = progress.requestId;
          if (progress.requestId) eventStream.send({ type: "progress", requestId: progress.requestId, progress });
        },
        onCandidates: (candidatesEvent) => {
          eventStream.send({ type: "candidates", requestId: emittedRequestId, ...candidatesEvent });
        },
      });
      eventStream.send({ type: "result", requestId: emittedRequestId, response });
    } catch (error) {
      const failure = recruitmentTurnHttpError(error);
      eventStream.send({
        type: "error",
        requestId: emittedRequestId,
        statusCode: failure.statusCode,
        message: failure.message,
      });
    } finally {
      eventStream.close();
      clearInterval(pingTimer);
    }
  });
}
