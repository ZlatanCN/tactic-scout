import path from "node:path";
import { fileURLToPath } from "node:url";
import { CuratedDatasetRepository } from "../dataset/curated-repository.js";
import { AmericanSoccerAnalysisPlayerRepository } from "./asa-provider.js";
import { DemoPlayerRepository } from "./demo-provider.js";
import { FbrefPlayerRepository, FbrefProviderError } from "./fbref-provider.js";
import { MultiSourceCurrentPlayerRepository, MultiSourceProviderError } from "./multi-source-provider.js";
import { type PlayerRepository, withLocalQueries } from "./player-repository.js";
import { PremierLeagueFantasyPlayerRepository } from "./premier-league-fantasy-provider.js";
import { PremierLeaguePlayerRepository, PremierLeagueProviderError } from "./premier-league-provider.js";
import { SkillCornerPlayerRepository } from "./skillcorner-provider.js";
import { SportmonksPlayerRepository, SportmonksProviderError } from "./sportmonks-provider.js";
import { StatsBombRepository } from "./statsbomb-provider.js";
import { UnderstatPlayerRepository, UnderstatProviderError } from "./understat-provider.js";
import { SqliteUnderstatSnapshotStore } from "./understat-data-gateway.js";
import { WyscoutPlayerRepository } from "./wyscout-provider.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function getConfiguredDataMode(): string {
  return (process.env.TACTISCOUT_DATA_MODE ?? "demo").trim().toLowerCase();
}

export function createRepository(): PlayerRepository {
  const mode = getConfiguredDataMode();
  if (mode === "fbref") {
    const cacheLifetimeText = process.env.TACTISCOUT_FBREF_CACHE_TTL_MS;
    const cacheTtlMs = cacheLifetimeText === undefined || cacheLifetimeText.trim() === ""
      ? undefined
      : Number(cacheLifetimeText);
    if (cacheLifetimeText !== undefined && cacheLifetimeText.trim() !== "" && !Number.isFinite(cacheTtlMs)) {
      throw new FbrefProviderError("invalid_configuration", "TACTISCOUT_FBREF_CACHE_TTL_MS must be a non-negative number of milliseconds.");
    }
    return withLocalQueries(new FbrefPlayerRepository({ ...(cacheTtlMs === undefined ? {} : { cacheTtlMs }) }));
  }
  if (mode === "fpl") {
    const cacheLifetimeText = process.env.TACTISCOUT_FPL_CACHE_TTL_MS;
    const cacheTtlMs = cacheLifetimeText === undefined || cacheLifetimeText.trim() === ""
      ? undefined
      : Number(cacheLifetimeText);
    if (cacheLifetimeText !== undefined && cacheLifetimeText.trim() !== "" && !Number.isFinite(cacheTtlMs)) {
      throw new Error("TACTISCOUT_FPL_CACHE_TTL_MS must be a non-negative number of milliseconds.");
    }
    return withLocalQueries(new PremierLeagueFantasyPlayerRepository({ ...(cacheTtlMs === undefined ? {} : { cacheTtlMs }) }));
  }
  if (mode === "premier_league") {
    const cacheLifetimeText = process.env.TACTISCOUT_PREMIER_LEAGUE_CACHE_TTL_MS;
    const cacheTtlMs = cacheLifetimeText === undefined || cacheLifetimeText.trim() === ""
      ? undefined
      : Number(cacheLifetimeText);
    if (cacheLifetimeText !== undefined && cacheLifetimeText.trim() !== "" && !Number.isFinite(cacheTtlMs)) {
      throw new PremierLeagueProviderError("invalid_configuration", "TACTISCOUT_PREMIER_LEAGUE_CACHE_TTL_MS must be a non-negative number of milliseconds.");
    }
    const seasonId = process.env.TACTISCOUT_PREMIER_LEAGUE_SEASON_ID?.trim();
    return withLocalQueries(new PremierLeaguePlayerRepository({
      ...(cacheTtlMs === undefined ? {} : { cacheTtlMs }),
      ...(seasonId ? { seasonId } : {}),
    }));
  }
  if (mode === "asa") {
    const cacheLifetimeText = process.env.TACTISCOUT_ASA_CACHE_TTL_MS;
    const cacheTtlMs = cacheLifetimeText === undefined || cacheLifetimeText.trim() === ""
      ? undefined
      : Number(cacheLifetimeText);
    if (cacheLifetimeText !== undefined && cacheLifetimeText.trim() !== "" && !Number.isFinite(cacheTtlMs)) {
      throw new Error("TACTISCOUT_ASA_CACHE_TTL_MS must be a non-negative number of milliseconds.");
    }
    return withLocalQueries(new AmericanSoccerAnalysisPlayerRepository({ ...(cacheTtlMs === undefined ? {} : { cacheTtlMs }) }));
  }
  if (mode === "understat") {
    const cacheLifetimeText = process.env.TACTISCOUT_UNDERSTAT_CACHE_TTL_MS;
    const cacheTtlMs = cacheLifetimeText === undefined || cacheLifetimeText.trim() === ""
      ? undefined
      : Number(cacheLifetimeText);
    if (cacheLifetimeText !== undefined && cacheLifetimeText.trim() !== "" && !Number.isFinite(cacheTtlMs)) {
      throw new UnderstatProviderError("invalid_configuration", "TACTISCOUT_UNDERSTAT_CACHE_TTL_MS must be a non-negative number of milliseconds.");
    }
    return withLocalQueries(new UnderstatPlayerRepository({ snapshotStore: new SqliteUnderstatSnapshotStore(), ...(cacheTtlMs === undefined ? {} : { cacheTtlMs }) }));
  }
  if (mode === "mosaic") {
    const asaCacheText = process.env.TACTISCOUT_ASA_CACHE_TTL_MS;
    const asaCacheTtlMs = asaCacheText === undefined || asaCacheText.trim() === "" ? undefined : Number(asaCacheText);
    if (asaCacheTtlMs !== undefined && !Number.isFinite(asaCacheTtlMs)) {
      throw new MultiSourceProviderError("source_error", "TACTISCOUT_ASA_CACHE_TTL_MS must be a non-negative number of milliseconds.");
    }
    const understatCacheText = process.env.TACTISCOUT_UNDERSTAT_CACHE_TTL_MS;
    const understatCacheTtlMs = understatCacheText === undefined || understatCacheText.trim() === "" ? undefined : Number(understatCacheText);
    if (understatCacheTtlMs !== undefined && !Number.isFinite(understatCacheTtlMs)) {
      throw new MultiSourceProviderError("source_error", "TACTISCOUT_UNDERSTAT_CACHE_TTL_MS must be a non-negative number of milliseconds.");
    }
    return withLocalQueries(new MultiSourceCurrentPlayerRepository({
      understat: new UnderstatPlayerRepository({ snapshotStore: new SqliteUnderstatSnapshotStore(), ...(understatCacheTtlMs === undefined ? {} : { cacheTtlMs: understatCacheTtlMs }) }),
      asa: new AmericanSoccerAnalysisPlayerRepository({ ...(asaCacheTtlMs === undefined ? {} : { cacheTtlMs: asaCacheTtlMs }) }),
    }));
  }
  if (mode === "statsbomb") {
    return withLocalQueries(new StatsBombRepository());
  }
  if (mode === "demo") return withLocalQueries(new DemoPlayerRepository());
  if (mode === "sportmonks") {
    const cacheLifetimeText = process.env.TACTISCOUT_SPORTMONKS_CACHE_TTL_MS;
    const cacheTtlMs = cacheLifetimeText === undefined || cacheLifetimeText.trim() === ""
      ? undefined
      : Number(cacheLifetimeText);
    if (cacheLifetimeText !== undefined && cacheLifetimeText.trim() !== "" && !Number.isFinite(cacheTtlMs)) {
      throw new SportmonksProviderError("invalid_configuration", "TACTISCOUT_SPORTMONKS_CACHE_TTL_MS must be a non-negative number of milliseconds.");
    }
    return withLocalQueries(new SportmonksPlayerRepository({
      token: process.env.SPORTMONKS_API_TOKEN ?? "",
      seasonIds: (process.env.TACTISCOUT_SPORTMONKS_SEASON_IDS ?? "").split(","),
      coveredStatisticTypeIds: (process.env.TACTISCOUT_SPORTMONKS_COVERED_STATISTIC_TYPE_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map(Number),
      allowModelProcessing: process.env.TACTISCOUT_SPORTMONKS_AI_PROCESSING_ALLOWED === "true",
      ...(cacheTtlMs === undefined ? {} : { cacheTtlMs }),
    }));
  }
  if (mode === "skillcorner") {
    return withLocalQueries(new SkillCornerPlayerRepository({
      aggregatesDirectory: process.env.TACTISCOUT_SKILLCORNER_AGGREGATES_DIR
        ?? path.join(projectRoot, ".data", "skillcorner-open-data", "aggregates"),
      allowLocalStorage: process.env.TACTISCOUT_SKILLCORNER_LOCAL_STORAGE_ALLOWED === "true",
      allowModelProcessing: process.env.TACTISCOUT_SKILLCORNER_AI_PROCESSING_ALLOWED === "true",
      allowReportDisplay: process.env.TACTISCOUT_SKILLCORNER_REPORT_DISPLAY_ALLOWED === "true",
    }));
  }
  if (mode === "wyscout") {
    return withLocalQueries(new WyscoutPlayerRepository({
      dataDirectory: process.env.TACTISCOUT_WYSCOUT_DIR
        ?? path.join(projectRoot, ".data", "wyscout-open-data"),
      allowModelProcessing: process.env.TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED === "true",
      competitionIds: (process.env.TACTISCOUT_WYSCOUT_COMPETITION_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    }));
  }
  if (mode === "curated") {
    return withLocalQueries(new CuratedDatasetRepository({
      filePath: process.env.TACTISCOUT_DATASET_FILE
        ? path.resolve(process.env.TACTISCOUT_DATASET_FILE)
        : path.join(projectRoot, ".data", "tactiscout-datasets", "latest.json"),
      allowModelProcessing: process.env.TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED === "true",
    }));
  }
  throw new SportmonksProviderError("invalid_configuration", `Unknown TACTISCOUT_DATA_MODE: ${mode}.`);
}

export { DemoPlayerRepository } from "./demo-provider.js";
export { inspectTeamPlayers, loadAllPlayers, loadComparisonPlayers, loadPlayersByIds, searchPlayerPage } from "./player-repository.js";
export type { PlayerRepository, PlayerSearchFilter, PlayerSearchPage, PlayerSearchQuery } from "./player-repository.js";
export { StatsBombRepository } from "./statsbomb-provider.js";
