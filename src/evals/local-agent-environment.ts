import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type PlayerRepository } from "../data/player-repository.js";
import type { UnderstatPlayerSection } from "../data/understat-research.js";
import { createRepository, getConfiguredDataMode } from "../data/provider.js";
import { localAgentEvaluationScenarios, understatLocalAgentEvaluationScenario } from "./harness-scenarios.js";

export const configuredDataMode = getConfiguredDataMode();

export const configuredScenarios = configuredDataMode === "understat"
  ? [understatLocalAgentEvaluationScenario]
  : configuredDataMode === "mosaic"
    ? [localAgentEvaluationScenarios.find(({ id }) => id === "bayern-kane-replacement")!]
    : [...localAgentEvaluationScenarios];

export const defaultScenario = configuredScenarios[0]!;

let repositoryInstance: PlayerRepository | undefined;
let repositoryCacheTtlMs: number | undefined;

const UNDERSTAT_EXPERIMENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function getDataRepository(options: { minimumUnderstatCacheTtlMs?: number } = {}): PlayerRepository {
  if (!repositoryInstance) {
    const minimumTtl = options.minimumUnderstatCacheTtlMs;
    if (configuredDataMode === "understat" && minimumTtl !== undefined) {
      const originalTtl = process.env.TACTISCOUT_UNDERSTAT_CACHE_TTL_MS;
      const existingTtl = originalTtl?.trim() ? Number(originalTtl) : 30 * 60 * 1000;
      if (!Number.isFinite(existingTtl) || existingTtl < 0) {
        throw new Error("TACTISCOUT_UNDERSTAT_CACHE_TTL_MS 必须是非负毫秒数，才能建立可复用的 Understat 实验快照。");
      }
      repositoryCacheTtlMs = Math.max(existingTtl, minimumTtl);
      process.env.TACTISCOUT_UNDERSTAT_CACHE_TTL_MS = String(repositoryCacheTtlMs);
      try {
        repositoryInstance = createRepository();
      } finally {
        if (originalTtl === undefined) delete process.env.TACTISCOUT_UNDERSTAT_CACHE_TTL_MS;
        else process.env.TACTISCOUT_UNDERSTAT_CACHE_TTL_MS = originalTtl;
      }
    } else {
      if (configuredDataMode === "understat") {
        const configuredTtl = process.env.TACTISCOUT_UNDERSTAT_CACHE_TTL_MS?.trim();
        repositoryCacheTtlMs = configuredTtl ? Number(configuredTtl) : 30 * 60 * 1000;
      }
      repositoryInstance = createRepository();
    }
  }
  return repositoryInstance;
}

export async function prepareUnderstatResearchSnapshot() {
  const repository = getDataRepository({ minimumUnderstatCacheTtlMs: UNDERSTAT_EXPERIMENT_CACHE_TTL_MS });
  if (repository.mode !== "understat" || !repository.loadPlayers || !repository.searchCandidates || !repository.inspectCandidateGroup) {
    throw new Error("Understat 消融需要可读取五大联赛目录及球员原始资料的 Understat 数据仓库。");
  }
  const position = understatLocalAgentEvaluationScenario.kind === "shortlist"
    ? understatLocalAgentEvaluationScenario.expectedBroadPosition ?? "ATT"
    : "ATT";
  const players = await repository.loadPlayers();
  const page = await repository.searchCandidates({
    playerName: null,
    position,
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 12,
  });
  if (page.players.length < 2) throw new Error(`Understat 首轮 ${position} 候选样本少于 2 人，无法运行固定资料组消融。`);
  const sections: readonly UnderstatPlayerSection[] = ["positions", "history", "recent", "shotProfile"];
  const insights = await repository.inspectCandidateGroup(page.players.map(({ playerId }) => playerId), sections);
  const catalogSha256 = createHash("sha256")
    .update(JSON.stringify([...players].sort((left, right) => left.playerId.localeCompare(right.playerId))))
    .digest("hex");
  const cohortDetailSha256 = createHash("sha256")
    .update(JSON.stringify([...insights].sort((left, right) => left.playerId.localeCompare(right.playerId))))
    .digest("hex");
  const retrievedAtValues = [...new Set(insights.map(({ retrievedAt }) => retrievedAt))].sort();
  return {
    source: repository.sourceName,
    createdAt: new Date().toISOString(),
    cacheTtlMs: repositoryCacheTtlMs ?? UNDERSTAT_EXPERIMENT_CACHE_TTL_MS,
    catalogPlayerCount: players.length,
    position,
    pinnedCohortSize: page.players.length,
    prewarmedProfileCount: insights.length,
    sections,
    catalogSha256,
    cohortDetailSha256,
    snapshotSha256: createHash("sha256").update(`${catalogSha256}:${cohortDetailSha256}`).digest("hex"),
    sourceRetrievedAtRange: retrievedAtValues.length ? [retrievedAtValues[0], retrievedAtValues.at(-1)] : [],
  };
}

export function safeEndpoint(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return "invalid URL";
  }
}

export async function curatedDatasetSha256(): Promise<string | null> {
  const dataRepository = getDataRepository();
  if (dataRepository.mode !== "curated") return null;
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const snapshotPath = process.env.TACTISCOUT_DATASET_FILE?.trim()
    ? path.resolve(process.env.TACTISCOUT_DATASET_FILE)
    : path.join(projectRoot, ".data", "tactiscout-datasets", "latest.json");
  const bytes = await readFile(snapshotPath);
  return createHash("sha256").update(bytes).digest("hex");
}
