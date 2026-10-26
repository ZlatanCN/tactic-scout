import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { z } from "zod/v4";

import type { CandidateSourceRecord } from "./contracts.js";
import type { FmReadResult } from "./football-manager.js";
import {
  createLocalDataError,
  isLocalDataError,
  isLocalDataFailure,
  resolveDataPath,
} from "./shared.js";
import type { UnderstatReadResult } from "./understat.js";

type ReepRecordResolution = {
  status: "resolved" | "unresolved" | "ambiguous";
  canonicalIdentityId: string | null;
};

type ApiFootballFmBridgeResolution = {
  canonicalIdentityId: string | null;
  fmIds: string[];
  status: "resolved" | "unresolved" | "ambiguous";
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

const releaseStampRowSchema = z.object({
  value: z.string(),
});

const reepBridgeRowSchema = z.object({
  canonical_reep_id: z.string().nullable(),
  redirect_status: z.string(),
});

const searchRecordReferences = (
  provider: CandidateSourceRecord["provider"],
  result: UnderstatReadResult | FmReadResult | null
): SearchRecordReference[] => {
  if (result === null || result.status === "unavailable") {
    return [];
  }

  const references: SearchRecordReference[] = [];

  for (const record of result.records) {
    if (
      provider === "understat" &&
      "sourcePlayerId" in record &&
      record.sourcePlayerId.length > 0
    ) {
      references.push({
        identitySourceId: record.sourcePlayerId,
        name: record.player,
        provider,
        recordId: record.sourcePlayerId,
      });
    } else if (
      provider === "fm" &&
      "identitySourceId" in record &&
      record.identitySourceId.length > 0 &&
      record.sourceRecordId.length > 0
    ) {
      references.push({
        identitySourceId: record.identitySourceId,
        name: record.player,
        provider,
        recordId: record.sourceRecordId,
      });
    }
  }

  return references;
};

const openIdentityRegistry = (databasePath: string): DatabaseSync | null => {
  if (!existsSync(databasePath)) {
    return null;
  }

  let database: DatabaseSync | undefined;

  try {
    database = new DatabaseSync(databasePath, { readOnly: true });

    const releaseStamp = releaseStampRowSchema.safeParse(
      database
        .prepare("SELECT value FROM metadata WHERE key = 'release_stamp'")
        .get()
    );

    if (!releaseStamp.success || releaseStamp.data.value.length === 0) {
      database.close();
      throw createLocalDataError("Reep 身份注册表格式无法读取。");
    }

    return database;
  } catch (error) {
    database?.close();

    if (error instanceof Error && isLocalDataError(error)) {
      throw error;
    }

    if (error instanceof Error && isLocalDataFailure(error)) {
      throw createLocalDataError("Reep 身份注册表无法读取。");
    }

    throw error;
  }
};

const resolveReepRecord = (
  database: DatabaseSync,
  provider: CandidateSourceRecord["provider"],
  sourceId: string
): ReepRecordResolution => {
  const rows = z.array(reepBridgeRowSchema).parse(
    database
      .prepare(
        `SELECT canonical_reep_id, redirect_status
     FROM bridges
     WHERE provider = ? AND namespace = 'player' AND external_id = ?`
      )
      .all(provider, sourceId)
  );

  if (!rows.length) {
    return { canonicalIdentityId: null, status: "unresolved" };
  }

  const canonicalIds = new Set<string>();
  let hasBlockedBridge = false;

  for (const row of rows) {
    if (row.redirect_status !== "resolved") {
      hasBlockedBridge = true;
      continue;
    }

    if (row.canonical_reep_id !== null) {
      canonicalIds.add(row.canonical_reep_id);
    }
  }

  const [canonicalIdentityId] = canonicalIds;

  if (
    canonicalIds.size === 1 &&
    !hasBlockedBridge &&
    canonicalIdentityId !== undefined &&
    canonicalIdentityId.length > 0
  ) {
    return { canonicalIdentityId, status: "resolved" };
  }

  const status =
    rows.length > 1 || canonicalIds.size > 1 ? "ambiguous" : "unresolved";

  return {
    canonicalIdentityId: null,
    status,
  };
};

const resolveApiFootballPlayerFmIds = (
  apiFootballPlayerId: string
): ApiFootballFmBridgeResolution => {
  const registryPath = resolveDataPath(
    process.env.TACTISCOUT_REEP_IDENTITY_DB_PATH,
    ".data/reep/identity-with-fm.sqlite"
  );

  const registry = openIdentityRegistry(registryPath);

  if (registry === null) {
    return {
      canonicalIdentityId: null,
      fmIds: [],
      status: "unresolved",
    };
  }

  try {
    const apiRows = z.array(reepBridgeRowSchema).parse(
      registry
        .prepare(
          `SELECT canonical_reep_id, redirect_status
           FROM bridges
           WHERE provider = 'api_football' AND namespace = 'player'
             AND external_id = ?`
        )
        .all(apiFootballPlayerId)
    );

    const canonicalIds = new Set<string>();
    let hasBlockedBridge = false;

    for (const row of apiRows) {
      if (row.redirect_status !== "resolved") {
        hasBlockedBridge = true;
      } else if (row.canonical_reep_id !== null) {
        canonicalIds.add(row.canonical_reep_id);
      }
    }

    const [canonicalIdentityId] = canonicalIds;

    if (
      canonicalIds.size !== 1 ||
      hasBlockedBridge ||
      canonicalIdentityId === undefined
    ) {
      return {
        canonicalIdentityId: null,
        fmIds: [],
        status:
          canonicalIds.size > 1 || apiRows.length > 1
            ? "ambiguous"
            : "unresolved",
      };
    }

    const fmRows = z.array(z.object({ external_id: z.string() })).parse(
      registry
        .prepare(
          `SELECT DISTINCT external_id
           FROM bridges
           WHERE provider = 'fm' AND namespace = 'player'
             AND redirect_status = 'resolved' AND canonical_reep_id = ?
           ORDER BY external_id`
        )
        .all(canonicalIdentityId)
    );

    return {
      canonicalIdentityId,
      fmIds: fmRows.map((row) => row.external_id),
      status: "resolved",
    };
  } catch (error) {
    if (error instanceof Error && isLocalDataError(error)) {
      throw error;
    }

    if (error instanceof Error && isLocalDataFailure(error)) {
      throw createLocalDataError("Reep 身份注册表无法读取。");
    }

    throw error;
  } finally {
    registry.close();
  }
};

const resolveSearchIdentityGroups = (
  understatResult: UnderstatReadResult | null,
  fmResult: FmReadResult | null
) => {
  const records = [
    ...searchRecordReferences("understat", understatResult),
    ...searchRecordReferences("fm", fmResult),
  ];

  if (records.length === 0) {
    return {
      canonicalGroups: [],
      registryStatus: "not_needed",
      unlinkedRecords: [],
    };
  }

  const registryPath = resolveDataPath(
    process.env.TACTISCOUT_REEP_IDENTITY_DB_PATH,
    ".data/reep/identity-with-fm.sqlite"
  );

  const unavailable = () => ({
    canonicalGroups: [],
    registryStatus: "unavailable",
    unlinkedRecords: records.map((record) => ({
      ...record,
      reason: "registry_unavailable",
    })),
  });

  let registry: DatabaseSync | null;

  try {
    registry = openIdentityRegistry(registryPath);
  } catch (error) {
    if (
      error instanceof Error &&
      (isLocalDataError(error) || isLocalDataFailure(error))
    ) {
      return unavailable();
    }

    throw error;
  }

  if (registry === null) {
    return unavailable();
  }

  try {
    const groups = new Map<string, SearchIdentityGroup>();

    const unlinkedRecords: (SearchRecordReference & { reason: string })[] = [];

    for (const record of records) {
      const identity = resolveReepRecord(
        registry,
        record.provider,
        record.identitySourceId
      );

      if (
        identity.status !== "resolved" ||
        identity.canonicalIdentityId === null
      ) {
        unlinkedRecords.push({ ...record, reason: identity.status });
        continue;
      }

      const group = groups.get(identity.canonicalIdentityId);

      if (group === undefined) {
        groups.set(identity.canonicalIdentityId, {
          canonicalIdentityId: identity.canonicalIdentityId,
          name: record.name,
          records: [record],
        });
      } else if (
        !group.records.some(
          (item) =>
            item.provider === record.provider &&
            item.recordId === record.recordId
        )
      ) {
        group.records.push(record);
      }
    }

    return {
      canonicalGroups: [...groups.values()],
      registryStatus: "available",
      unlinkedRecords,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (isLocalDataError(error) || isLocalDataFailure(error))
    ) {
      return unavailable();
    }

    throw error;
  } finally {
    registry.close();
  }
};

export {
  openIdentityRegistry,
  resolveApiFootballPlayerFmIds,
  resolveReepRecord,
  resolveSearchIdentityGroups,
};

export type { ReepRecordResolution, SearchIdentityGroup };
