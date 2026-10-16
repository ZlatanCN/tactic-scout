import type { FastifyInstance } from "fastify";
import { PlayerObservationNotFoundError, type PlayerObservationLibrary } from "../../observations/library.js";
import { PlayerObservationInputSchema, PlayerObservationListSchema, PlayerObservationSchema } from "../../observations/schemas.js";

export function registerPlayerObservationRoutes(app: FastifyInstance, playerObservationLibrary: PlayerObservationLibrary): void {
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
}
