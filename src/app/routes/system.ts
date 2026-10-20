import type { FastifyInstance } from "fastify";
import { DatasetStatusSchema } from "../../domain/datasets.js";
import { KnowledgeStatusSchema } from "../../knowledge/schemas.js";
import type { PlayerRepository } from "../../players/repository.js";
import type { AppKnowledgeBase } from "../types.js";
import { contextCompactionRatio, contextSafetyMarginTokens, modelContextWindowTokens, openAIMaxOutputTokens } from "../../recruitment/chat-model.js";

export function registerSystemRoutes(
  app: FastifyInstance,
  playerRepository: PlayerRepository,
  knowledgeBase: AppKnowledgeBase,
): void {
  app.get("/health", async () => ({ status: "ok", service: "tactiscout-api" }));
  app.get("/health/context", async () => ({
    configuredModel: process.env.OPENAI_MODEL?.trim() || null,
    configuredContextWindowTokens: modelContextWindowTokens() ?? null,
    compactionRatio: contextCompactionRatio(),
    defaultOutputBudgetTokens: openAIMaxOutputTokens(),
    safetyMarginTokens: contextSafetyMarginTokens(),
  }));
  app.get("/api/v1/dataset", async () => {
    const snapshot = await playerRepository.getDatasetStatus?.();
    return DatasetStatusSchema.parse({
      mode: playerRepository.mode,
      source: playerRepository.sourceName,
      ...(snapshot ? { snapshot } : {}),
    });
  });
  app.get("/api/v1/knowledge/status", async () => KnowledgeStatusSchema.parse(await knowledgeBase.status()));
}
