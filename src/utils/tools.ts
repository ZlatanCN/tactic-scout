import { tool } from "@langchain/core/tools";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { z } from "zod/v4";
import type { ReferenceCandidate, ReferenceLookupResult } from "./state.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const searchInputSchema = z.object({
  playerName: z.string().min(2).max(100).describe("球员姓名或姓名片段"),
  source: z
    .enum(["understat", "fm", "both"])
    .default("both")
    .describe("要查询的数据来源"),
  seasonStartYear: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .optional()
    .describe("Understat 赛季起始年份；不填时使用数据库中最新赛季"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(3)
    .describe("每个来源最多返回的记录数"),
});

type PlayerSearchInput = z.output<typeof searchInputSchema>;
type PlayerSearch = (input: PlayerSearchInput) => Promise<string>;
type ReferenceIdentityLookup = (
  mention: string,
) => Promise<ReferenceLookupResult>;
type CandidateSourceRecord = ReferenceCandidate["records"][number] & {
  exactNameMatch: boolean;
};
type ReepRecordResolution = {
  status: "resolved" | "unresolved" | "ambiguous";
  canonicalIdentityId: string | null;
};
type SearchRecordReference = {
  provider: CandidateSourceRecord["provider"];
  identitySourceId: string;
  recordId: string;
  name: string;
};
type SearchIdentityGroup = {
  canonicalIdentityId: string;
  name: string;
  records: SearchRecordReference[];
};

const createTools = (search: PlayerSearch = searchPlayerRecords) => [
  tool(search, {
    name: "search_player_records",
    description:
      "按姓名查找本地 Understat 赛季表现记录和/或 Football Manager 能力画像。identityGroups 只合并身份注册表通过 canonical Reep ID 确认关联的来源记录；unlinkedRecords 不可按姓名合并。",
    schema: searchInputSchema,
  }),
];

const searchPlayerRecords: PlayerSearch = async (input) => {
  const normalizedName = normalize(input.playerName);
  if (!normalizedName)
    return JSON.stringify({ query: input.playerName, result: "empty_query" });

  assertModelProcessingAllowed(input.source);
  const sourceResults: Record<string, unknown> = {};
  let understatResult: ReturnType<typeof readUnderstat> | null = null;
  let fmResult: ReturnType<typeof readFmProfiles> | null = null;

  if (input.source === "understat" || input.source === "both") {
    understatResult = readUnderstat(input, normalizedName);
    sourceResults.understat = understatResult;
  }
  if (input.source === "fm" || input.source === "both") {
    fmResult = readFmProfiles(input, normalizedName);
    sourceResults.fm = fmResult;
  }

  return JSON.stringify({
    query: input.playerName,
    ...sourceResults,
    identityGroups: resolveSearchIdentityGroups(understatResult, fmResult),
  });
};

const resolveSearchIdentityGroups = (
  understatResult: ReturnType<typeof readUnderstat> | null,
  fmResult: ReturnType<typeof readFmProfiles> | null,
) => {
  const records = [
    ...searchRecordReferences("understat", understatResult),
    ...searchRecordReferences("fm", fmResult),
  ];
  if (!records.length) {
    return {
      registryStatus: "not_needed",
      canonicalGroups: [] as SearchIdentityGroup[],
      unlinkedRecords: [] as Array<SearchRecordReference & { reason: string }>,
    };
  }

  const registryPath = resolveDataPath(
    process.env.TACTISCOUT_REEP_IDENTITY_DB_PATH,
    ".data/reep/identity-with-fm.sqlite",
  );
  const registry = openIdentityRegistry(registryPath);
  if (!registry) {
    return {
      registryStatus: "unavailable",
      canonicalGroups: [] as SearchIdentityGroup[],
      unlinkedRecords: records.map((record) => ({
        ...record,
        reason: "registry_unavailable",
      })),
    };
  }

  try {
    const groups = new Map<string, SearchIdentityGroup>();
    const unlinkedRecords: Array<SearchRecordReference & { reason: string }> = [];
    for (const record of records) {
      const identity = resolveReepRecord(
        registry,
        record.provider,
        record.identitySourceId,
      );
      if (identity.status !== "resolved" || !identity.canonicalIdentityId) {
        unlinkedRecords.push({ ...record, reason: identity.status });
        continue;
      }

      const group = groups.get(identity.canonicalIdentityId);
      if (group) {
        if (!group.records.some((item) =>
          item.provider === record.provider && item.recordId === record.recordId
        )) group.records.push(record);
      } else {
        groups.set(identity.canonicalIdentityId, {
          canonicalIdentityId: identity.canonicalIdentityId,
          name: record.name,
          records: [record],
        });
      }
    }
    return {
      registryStatus: "available",
      canonicalGroups: [...groups.values()],
      unlinkedRecords,
    };
  } finally {
    registry.close();
  }
};

const searchRecordReferences = (
  provider: CandidateSourceRecord["provider"],
  result: ReturnType<typeof readUnderstat> | ReturnType<typeof readFmProfiles> | null,
): SearchRecordReference[] => {
  if (!result || !("records" in result) || !Array.isArray(result.records)) return [];
  return result.records.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const item = record as Record<string, unknown>;
    const identitySourceId = provider === "understat"
      ? item.sourcePlayerId
      : item.identitySourceId;
    const recordId = provider === "understat"
      ? item.sourcePlayerId
      : item.sourceRecordId;
    const name = item.player;
    return typeof identitySourceId === "string" && identitySourceId &&
      typeof recordId === "string" && recordId
      ? [{ provider, identitySourceId, recordId, name: typeof name === "string" ? name : "" }]
      : [];
  });
};

const resolvePlayerReference = async (
  mention: string,
): Promise<ReferenceLookupResult> => {
  assertModelProcessingAllowed("both");
  const records = [
    ...readUnderstatReferenceRecords(mention),
    ...readFmReferenceRecords(mention),
  ];
  if (!records.length) {
    return {
      status: "not_found",
      mention,
      selectedCandidateId: null,
      canonicalIdentityId: null,
      selectedName: null,
      candidates: [],
      candidateCount: 0,
      candidatesTruncated: false,
      clarificationMessage: `我没能在本地资料中找到“${mention}”。请提供完整姓名或球队线索。`,
    };
  }

  const registryPath = resolveDataPath(
    process.env.TACTISCOUT_REEP_IDENTITY_DB_PATH,
    ".data/reep/identity-with-fm.sqlite",
  );
  const registry = openIdentityRegistry(registryPath);
  if (!registry) {
    const limited = limitReferenceCandidates(
      groupReferenceCandidates(records, null),
    );
    return {
      status: "registry_unavailable",
      mention,
      selectedCandidateId: null,
      canonicalIdentityId: null,
      selectedName: null,
      ...limited,
      clarificationMessage:
        "本地身份注册表不可用，不能安全地跨来源确认这个球员。请指定一个来源记录或提供更多身份信息。",
    };
  }

  try {
    const allCandidates = groupReferenceCandidates(records, registry);
    const limited = limitReferenceCandidates(allCandidates);
    const exactVerified = allCandidates.filter(
      (candidate) => candidate.exactNameMatch && candidate.identityVerified,
    );
    if (exactVerified.length === 1 && allCandidates.length === 1) {
      const candidate = exactVerified[0]!;
      return {
        status: "resolved",
        mention,
        selectedCandidateId: candidate.candidateId,
        canonicalIdentityId: candidate.canonicalIdentityId,
        selectedName: candidate.name,
        ...limited,
        clarificationMessage: null,
      };
    }

    return {
      status: "needs_confirmation",
      mention,
      selectedCandidateId: null,
      canonicalIdentityId: null,
      selectedName: null,
      ...limited,
      clarificationMessage: limited.candidatesTruncated
        ? `“${mention}”匹配到 ${limited.candidateCount} 个身份，候选太多。请补充完整姓名或球队线索。`
        : allCandidates.length > 1
          ? `“${mention}”匹配到多个身份，请选择一个。`
          : `“${mention}”不是唯一的完整姓名匹配，请确认候选是否正确。`,
    };
  } finally {
    registry.close();
  }
};

const openIdentityRegistry = (databasePath: string): DatabaseSync | null => {
  if (!existsSync(databasePath)) return null;
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const releaseStamp = database
      .prepare("SELECT value FROM metadata WHERE key = 'release_stamp'")
      .get() as { value?: string } | undefined;
    if (!releaseStamp?.value) {
      database.close();
      return null;
    }
    return database;
  } catch {
    database?.close();
    return null;
  }
};

const readUnderstatReferenceRecords = (
  mention: string,
): CandidateSourceRecord[] => {
  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_UNDERSTAT_DB_PATH,
    ".data/understat/understat.sqlite",
  );
  if (!existsSync(databasePath)) return [];

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `SELECT resource_id, season_start_year, payload_json
       FROM source_snapshots
       WHERE kind = 'league'
       ORDER BY season_start_year DESC, resource_id`,
      )
      .all() as Array<{
      resource_id: string;
      season_start_year: number;
      payload_json: string;
    }>;
    const latestYear = rows.reduce(
      (latest, row) => Math.max(latest, row.season_start_year),
      0,
    );
    if (!latestYear) return [];

    const records = rows
      .filter((row) => row.season_start_year === latestYear)
      .flatMap((row) => {
        const payload = JSON.parse(row.payload_json) as {
          players?: Array<Record<string, unknown>>;
        };
        return (payload.players ?? []).flatMap((player) => {
          const name = String(player.player_name ?? "");
          const match = matchReferenceName(mention, [name]);
          return match.matches
            ? [
                {
                  provider: "understat" as const,
                  sourceId: String(player.id ?? ""),
                  name,
                  team: nullableString(player.team_title),
                  competition: row.resource_id,
                  season: `${latestYear}/${String(latestYear + 1).slice(-2)}`,
                  exactNameMatch: match.exact,
                },
              ]
            : [];
        });
      });

    return deduplicateSourceRecords(records);
  } finally {
    database.close();
  }
};

const readFmReferenceRecords = (mention: string): CandidateSourceRecord[] => {
  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_FM_PROFILES_PATH,
    ".data/fm/profiles-v2.sqlite",
  );
  if (!existsSync(databasePath)) return [];

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const pattern = `%${normalize(mention)}%`;
    const rows = database
      .prepare(
        `SELECT DISTINCT p.record_id, p.payload, a.name AS alias_name
       FROM players p
       LEFT JOIN aliases a ON a.record_id = p.record_id
       WHERE a.name LIKE ? OR LOWER(p.name) LIKE ?
       ORDER BY p.name
       LIMIT 1000`,
      )
      .all(pattern, `%${mention.toLocaleLowerCase()}%`) as Array<{
      record_id: string;
      payload: Uint8Array;
      alias_name: string | null;
    }>;

    const records = rows.flatMap(({ record_id, payload, alias_name }) => {
      const profile = JSON.parse(
        inflateRawSync(payload).toString("utf8"),
      ) as Record<string, unknown>;
      const name = String(
        profile.common_name || profile.full_name || profile.name || "",
      );
      const names = [name, nullableString(alias_name) ?? ""];
      const match = matchReferenceName(mention, names);
      const sourceId = String(profile.unique_id || record_id);
      return match.matches
        ? [
            {
              provider: "fm" as const,
              sourceId,
              name,
              team: null,
              competition: null,
              season: null,
              exactNameMatch: match.exact,
            },
          ]
        : [];
    });

    return deduplicateSourceRecords(records);
  } finally {
    database.close();
  }
};

const groupReferenceCandidates = (
  records: CandidateSourceRecord[],
  registry: DatabaseSync | null | undefined,
): ReferenceCandidate[] => {
  const groups = new Map<string, ReferenceCandidate>();
  for (const record of records) {
    const identity = registry
      ? resolveReepRecord(registry, record.provider, record.sourceId)
      : { status: "unresolved" as const, canonicalIdentityId: null };
    const candidateId =
      identity.status === "resolved" && identity.canonicalIdentityId
        ? `reep:${identity.canonicalIdentityId}`
        : `source:${record.provider}:${record.sourceId}`;
    const candidate = groups.get(candidateId);
    if (candidate) {
      if (
        !candidate.records.some(
          (existing) =>
            existing.provider === record.provider &&
            existing.sourceId === record.sourceId &&
            existing.season === record.season &&
            existing.competition === record.competition,
        )
      )
        candidate.records.push(toReferenceSourceRecord(record));
      candidate.exactNameMatch ||= record.exactNameMatch;
      if (identity.status !== "resolved") candidate.identityVerified = false;
      continue;
    }

    groups.set(candidateId, {
      candidateId,
      name: record.name,
      canonicalIdentityId:
        identity.status === "resolved" ? identity.canonicalIdentityId : null,
      identityVerified:
        identity.status === "resolved" && identity.canonicalIdentityId !== null,
      exactNameMatch: record.exactNameMatch,
      records: [toReferenceSourceRecord(record)],
    });
  }

  return [...groups.values()].sort(
    (left, right) =>
      Number(right.records.some((record) => record.provider === "understat")) -
        Number(
          left.records.some((record) => record.provider === "understat"),
        ) ||
      Number(right.exactNameMatch) - Number(left.exactNameMatch) ||
      left.name.localeCompare(right.name),
  );
};

const limitReferenceCandidates = (candidates: ReferenceCandidate[]) => ({
  candidates: candidates.slice(0, 8),
  candidateCount: candidates.length,
  candidatesTruncated: candidates.length > 8,
});

const resolveReepRecord = (
  database: DatabaseSync,
  provider: CandidateSourceRecord["provider"],
  sourceId: string,
): ReepRecordResolution => {
  const rows = database
    .prepare(
      `SELECT canonical_reep_id, redirect_status
     FROM bridges
     WHERE provider = ? AND namespace = 'player' AND external_id = ?`,
    )
    .all(provider, sourceId) as Array<{
    canonical_reep_id: string | null;
    redirect_status: string;
  }>;
  if (!rows.length) return { status: "unresolved", canonicalIdentityId: null };

  const canonicalIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.redirect_status === "resolved" && row.canonical_reep_id
          ? [row.canonical_reep_id]
          : [],
      ),
    ),
  ];
  const hasBlockedBridge = rows.some(
    (row) => row.redirect_status !== "resolved",
  );
  if (canonicalIds.length === 1 && !hasBlockedBridge) {
    return { status: "resolved", canonicalIdentityId: canonicalIds[0]! };
  }
  return {
    status:
      rows.length > 1 || canonicalIds.length > 1 ? "ambiguous" : "unresolved",
    canonicalIdentityId: null,
  };
};

const matchReferenceName = (mention: string, names: string[]) => {
  const queryTokens = tokenize(mention);
  if (!queryTokens.length || !names.length)
    return { matches: false, exact: false };

  const normalizedMention = normalize(mention);
  const exact = names.some((name) => normalize(name) === normalizedMention);
  if (exact) return { matches: true, exact: true };

  const matches = names.some((name) => {
    const nameTokens = tokenize(name);
    return queryTokens.length === 1
      ? nameTokens.includes(queryTokens[0]!)
      : hasContiguousTokens(nameTokens, queryTokens);
  });
  return { matches, exact: false };
};

const hasContiguousTokens = (source: string[], target: string[]): boolean =>
  source.some((_, index) =>
    target.every((token, offset) => source[index + offset] === token),
  );

const tokenize = (value: string): string[] =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const deduplicateSourceRecords = (
  records: CandidateSourceRecord[],
): CandidateSourceRecord[] => {
  const unique = new Map<string, CandidateSourceRecord>();
  for (const record of records) {
    const key = JSON.stringify([
      record.provider,
      record.sourceId,
      record.competition,
      record.season,
    ]);
    const previous = unique.get(key);
    if (previous) previous.exactNameMatch ||= record.exactNameMatch;
    else unique.set(key, record);
  }
  return [...unique.values()];
};

const toReferenceSourceRecord = (
  record: CandidateSourceRecord,
): ReferenceCandidate["records"][number] => ({
  provider: record.provider,
  sourceId: record.sourceId,
  name: record.name,
  team: record.team,
  competition: record.competition,
  season: record.season,
});

const readUnderstat = (input: PlayerSearchInput, normalizedName: string) => {
  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_UNDERSTAT_DB_PATH,
    ".data/understat/understat.sqlite",
  );
  if (!existsSync(databasePath))
    return { status: "unavailable", reason: "Understat 本地快照不存在。" };

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `SELECT resource_id, season_start_year, payload_json
       FROM source_snapshots
       WHERE kind = 'league'
       ORDER BY season_start_year DESC, resource_id`,
      )
      .all() as Array<{
      resource_id: string;
      season_start_year: number;
      payload_json: string;
    }>;

    const latestYear =
      input.seasonStartYear ??
      rows.reduce((latest, row) => Math.max(latest, row.season_start_year), 0);
    if (!latestYear)
      return {
        status: "unavailable",
        reason: "Understat 快照中没有联赛记录。",
      };

    const records = rows
      .filter((row) => row.season_start_year === latestYear)
      .flatMap((row) => {
        const payload = JSON.parse(row.payload_json) as {
          players?: Array<Record<string, unknown>>;
        };
        return (payload.players ?? [])
          .filter((player) =>
            normalize(String(player.player_name ?? "")).includes(
              normalizedName,
            ),
          )
          .map((player) => ({
            source: "Understat",
            sourcePlayerId: String(player.id ?? ""),
            competition: row.resource_id,
            season: `${latestYear}/${String(latestYear + 1).slice(-2)}`,
            player: String(player.player_name ?? ""),
            team: String(player.team_title ?? ""),
            position: String(player.position ?? ""),
            minutes: numeric(player.time),
            goals: numeric(player.goals),
            expectedGoals: numeric(player.xG),
            nonPenaltyExpectedGoals: numeric(player.npxG),
            assists: numeric(player.assists),
            expectedAssists: numeric(player.xA),
            shots: numeric(player.shots),
            keyPasses: numeric(player.key_passes),
          }));
      })
      .sort((left, right) => (right.minutes ?? 0) - (left.minutes ?? 0))
      .slice(0, input.limit);

    return { status: records.length ? "found" : "not_found", records };
  } finally {
    database.close();
  }
};

const readFmProfiles = (input: PlayerSearchInput, normalizedName: string) => {
  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_FM_PROFILES_PATH,
    ".data/fm/profiles-v2.sqlite",
  );
  if (!existsSync(databasePath))
    return { status: "unavailable", reason: "FM 本地画像快照不存在。" };

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const pattern = `%${normalizedName}%`;
    const rows = database
      .prepare(
        `SELECT DISTINCT p.record_id, p.payload
       FROM players p
       LEFT JOIN aliases a ON a.record_id = p.record_id
       WHERE a.name LIKE ? OR LOWER(p.name) LIKE ?
       ORDER BY p.name
       LIMIT ?`,
      )
      .all(
        pattern,
        `%${input.playerName.toLocaleLowerCase()}%`,
        input.limit,
      ) as Array<{ record_id: string; payload: Uint8Array }>;

    const records = rows.map(({ record_id, payload }) => {
      const profile = JSON.parse(
        inflateRawSync(payload).toString("utf8"),
      ) as Record<string, unknown>;
      return {
        source: "Football Manager",
        sourceRecordId: record_id,
        identitySourceId: String(profile.unique_id || record_id),
        player: String(
          profile.common_name || profile.full_name || profile.name || "",
        ),
        birthDate: nullableString(profile.birth_date),
        heightCm: numeric(profile.height_cm),
        currentAbility: numeric(profile.ability_current),
        potentialAbility: numeric(profile.ability_potential),
        naturalPositions: nullableString(profile.natural_positions),
        attributes: selectedAttributes(profile),
      };
    });

    return { status: records.length ? "found" : "not_found", records };
  } finally {
    database.close();
  }
};

const attributeKeys = [
  "finishing",
  "first_touch",
  "technique",
  "passing",
  "vision",
  "decisions",
  "off_the_ball",
  "acceleration",
  "pace",
  "strength",
] as const;

const selectedAttributes = (
  profile: Record<string, unknown>,
): Record<string, number | null> =>
  Object.fromEntries(
    attributeKeys.map((key) => [
      `${key}Raw`,
      numeric(profile[`raw_attributes_${key}`]),
    ]),
  );

const normalize = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/g, "");

const nullableString = (value: unknown): string | null =>
  typeof value === "string" && value.length ? value : null;

const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveDataPath = (
  configuredPath: string | undefined,
  defaultPath: string,
): string => path.resolve(projectRoot, configuredPath?.trim() || defaultPath);

const assertModelProcessingAllowed = (
  source: PlayerSearchInput["source"],
): void => {
  if (isLoopbackEndpoint(process.env.OPENAI_BASE_URL)) return;
  const requested = source === "both" ? ["understat", "fm"] : [source];
  const disallowed = requested.filter(
    (item) =>
      process.env[`TACTISCOUT_${item.toUpperCase()}_AI_PROCESSING_ALLOWED`] !==
      "true",
  );
  if (disallowed.length) {
    throw new Error(
      `远程模型处理未获配置许可：${disallowed.join(", ")}。请使用本机回环模型，或显式配置对应来源许可。`,
    );
  }
};

const isLoopbackEndpoint = (value: string | undefined): boolean => {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
};

export { createTools, resolvePlayerReference, searchPlayerRecords };
export type { PlayerSearch, PlayerSearchInput, ReferenceIdentityLookup };
