import type { FastifyInstance } from "fastify";
import { MemoryOwnerIdSchema, RecruitmentPreferenceKeySchema, RecruitmentPreferenceListSchema, RecruitmentPreferenceSchema, RecruitmentPreferenceWriteSchema } from "../../recruitment/preferences/schemas.js";
import { RecruitmentPreferencesService } from "../../recruitment/preferences/service.js";

export function registerRecruitmentPreferenceRoutes(app: FastifyInstance, preferences: RecruitmentPreferencesService): void {
  app.get<{ Params: { memoryOwnerId: string } }>("/api/v1/users/:memoryOwnerId/preferences", async (request, reply) => {
    const owner = MemoryOwnerIdSchema.safeParse(request.params.memoryOwnerId);
    if (!owner.success) return reply.code(400).send({ error: "浏览器记忆身份无效。" });
    return RecruitmentPreferenceListSchema.parse(await preferences.list(owner.data));
  });

  app.put<{ Params: { memoryOwnerId: string } }>("/api/v1/users/:memoryOwnerId/preferences", async (request, reply) => {
    const owner = MemoryOwnerIdSchema.safeParse(request.params.memoryOwnerId);
    const input = RecruitmentPreferenceWriteSchema.safeParse(request.body);
    if (!owner.success || !input.success) return reply.code(400).send({ error: "偏好无效或尚未明确确认保存。" });
    return reply.code(200).send(RecruitmentPreferenceSchema.parse(await preferences.save(owner.data, input.data)));
  });

  app.delete<{ Params: { memoryOwnerId: string; key: string } }>("/api/v1/users/:memoryOwnerId/preferences/:key", async (request, reply) => {
    const owner = MemoryOwnerIdSchema.safeParse(request.params.memoryOwnerId);
    const key = RecruitmentPreferenceKeySchema.safeParse(request.params.key);
    if (!owner.success || !key.success) return reply.code(400).send({ error: "浏览器记忆身份或偏好键无效。" });
    if (!(await preferences.delete(owner.data, key.data))) return reply.code(404).send({ error: "找不到这条偏好。" });
    return reply.code(204).send();
  });

  app.delete<{ Params: { memoryOwnerId: string } }>("/api/v1/users/:memoryOwnerId/preferences", async (request, reply) => {
    const owner = MemoryOwnerIdSchema.safeParse(request.params.memoryOwnerId);
    if (!owner.success) return reply.code(400).send({ error: "浏览器记忆身份无效。" });
    await preferences.clear(owner.data);
    return reply.code(204).send();
  });
}
