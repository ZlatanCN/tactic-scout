import type { FastifyInstance } from "fastify";

export function registerRetiredRoutes(app: FastifyInstance): void {
  app.post("/api/v1/requirements/parse", async (_request, reply) => {
    return reply.code(410).send({
      error: "独立需求解析接口已停用，请直接通过自然语言招募案件开始调查。",
      replacement: {
        method: "POST",
        path: "/api/v1/recruitment/cases/:caseId/turns",
      },
    });
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
}
