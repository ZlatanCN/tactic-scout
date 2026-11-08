import { createHash } from "node:crypto";

import type { BaseStore, Item } from "@langchain/langgraph";
import { z } from "zod/v4";

import type {
  ReferenceCandidate,
  ReferenceLookupResult,
} from "./player-data/contracts.js";
import {
  readFmProfilesBySourceIds,
  readFmRecommendationReferenceMetadata,
} from "./player-data/football-manager.js";
import type { FmReadResult } from "./player-data/football-manager.js";
import {
  resolveApiFootballPlayerFmIds,
  resolveReepSourceIdentities,
} from "./player-data/reep-registry.js";
import {
  isLocalDataError,
  normalizeLatinNameSpelling,
} from "./player-data/shared.js";
import { readUnderstatBySourceIds } from "./player-data/understat.js";
import type { PlayerMemoryManagementTarget } from "./state.js";
import type { TeamFmProfileCandidate } from "./team-data/contracts.js";

const playerMemoryNamespace = ["tactiscout", "local-user", "player-memory"];
const maxPlayerMemoryMatches = 1000;
const maxPlayerMemoryCandidates = 8;

const memorySourceRecordSchema = z.object({
  canonicalIdentityId: z.string().nullable(),
  competition: z.string().nullable(),
  identityVerified: z.boolean(),
  name: z.string().min(1),
  provider: z.enum(["fm", "understat"]),
  season: z.string().nullable(),
  sourceId: z.string().min(1),
});

const sourceVersionsSchema = z.object({
  fmManifestSha256: z.string().nullable(),
  fmSnapshotDate: z.string().nullable(),
  identityRegistryRelease: z.string().nullable(),
  understatScopes: z.array(
    z.object({
      competition: z.string(),
      season: z.string(),
      sourceId: z.string(),
    })
  ),
});

const playerIdentityMemorySchema = z.object({
  canonicalIdentityId: z.string().nullable(),
  confirmationId: z.string().min(1),
  confirmedAt: z.iso.datetime(),
  displayName: z.string().min(1),
  identityVerified: z.boolean(),
  kind: z.literal("player_identity"),
  normalizedMention: z.string().min(1),
  originThreadId: z.string().min(1),
  originalMention: z.string().min(1),
  schemaVersion: z.literal(1),
  sourceRecords: z.array(memorySourceRecordSchema).min(1),
  sourceVersions: sourceVersionsSchema,
  stableIdentityKey: z.string().min(1),
});

const rosterIdentityMemorySchema = z.object({
  apiFootballPlayerId: z.number().int().positive(),
  confirmationId: z.string().min(1),
  confirmedAt: z.iso.datetime(),
  fmId: z.string().min(1),
  fmPlayerName: z.string().min(1),
  kind: z.literal("roster_identity"),
  originThreadId: z.string().min(1),
  rosterPlayerName: z.string().min(1),
  rosterRetrievedAt: z.iso.datetime().nullable(),
  schemaVersion: z.literal(1),
  sourceVersions: z.object({
    fmManifestSha256: z.string().nullable(),
    fmSnapshotDate: z.string().nullable(),
  }),
  stableIdentityKey: z.string().min(1),
});

type PlayerIdentityMemory = z.output<typeof playerIdentityMemorySchema>;

type RosterIdentityMemory = z.output<typeof rosterIdentityMemorySchema>;

type PlayerMemoryRecord = PlayerIdentityMemory | RosterIdentityMemory;

type MemorySourceRecord = z.output<typeof memorySourceRecordSchema>;

type PlayerMemoryLookupResult =
  | { status: "found"; resolution: ReferenceLookupResult }
  | { status: "missing" | "stale" | "unavailable" };

type RememberedRosterIdentityLookupResult =
  | { candidate: TeamFmProfileCandidate; status: "found" }
  | { candidates: TeamFmProfileCandidate[]; status: "conflict" }
  | { status: "missing" | "stale" | "unavailable" };

type PlayerMemoryValidationStatus =
  | "current"
  | "conflicting"
  | "needs_confirmation"
  | "unavailable";

type PlayerMemoryListingRecord =
  | {
      canonicalIdentityId: string | null;
      confirmedAt: string;
      confirmationId: string;
      displayName: string;
      identityVerified: boolean;
      kind: "player_identity";
      mention: string;
      originThreadId: string;
      sourceRecords: {
        canonicalIdentityId: string | null;
        identityVerified: boolean;
        provider: "fm" | "understat";
        sourceId: string;
      }[];
      validationStatus: PlayerMemoryValidationStatus;
    }
  | {
      apiFootballPlayerId: number;
      confirmedAt: string;
      confirmationId: string;
      fmId: string;
      fmPlayerName: string;
      kind: "roster_identity";
      originThreadId: string;
      rosterPlayerName: string;
      validationStatus: PlayerMemoryValidationStatus;
    };

type PlayerMemoryListResult =
  | {
      records: PlayerMemoryListingRecord[];
      status: "ready";
      truncated: boolean;
    }
  | { status: "unavailable" };

type PlayerMemoryForgetQuery = {
  apiFootballPlayerId: number | null;
  fmId: string | null;
  targetKind: "player_identity" | "roster_identity" | null;
  targetMention: string | null;
};

type PlayerMemoryForgetOption = {
  label: string;
  target: PlayerMemoryManagementTarget;
};

type PlayerMemoryForgetOptionsResult =
  | { options: PlayerMemoryForgetOption[]; status: "ready" }
  | { status: "unavailable" };

type PlayerMemoryDeleteResult =
  | { deletedCount: number; status: "forgotten" }
  | { deletedCount: number; failedCount: number; status: "partial_failure" }
  | { status: "failed" | "not_found" };

type PlayerMemoryCorrectionResult =
  | { status: "corrected" }
  | { deletedCount: number; failedCount: number; status: "partial_failure" }
  | { status: "failed" | "not_found" };

type StoredPlayerMemoryEntry = {
  key: string;
  record: PlayerMemoryRecord;
};

type StoredPlayerMemoryEntriesResult =
  | { entries: StoredPlayerMemoryEntry[]; status: "ready"; truncated: boolean }
  | { status: "unavailable" };

const stableHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const parseStoredPlayerMemoryEntry = (
  item: Item
): StoredPlayerMemoryEntry | null => {
  const playerRecord = playerIdentityMemorySchema.safeParse(item.value);

  if (playerRecord.success) {
    return { key: item.key, record: playerRecord.data };
  }

  const rosterRecord = rosterIdentityMemorySchema.safeParse(item.value);

  if (!rosterRecord.success) {
    return null;
  }

  const expectedKey = stableHash(
    JSON.stringify([
      rosterRecord.data.apiFootballPlayerId,
      rosterRecord.data.fmId,
    ])
  );

  if (
    rosterRecord.data.stableIdentityKey !== expectedKey ||
    item.key !== `v1:roster-identity:${expectedKey}`
  ) {
    return null;
  }

  return { key: item.key, record: rosterRecord.data };
};

type PlayerIdentityConfirmation = {
  candidate: ReferenceCandidate;
  mention: string;
  originThreadId: string;
  playerIndex: number;
  processedMessageId: string | null;
};

type RosterIdentityConfirmation = {
  apiFootballPlayerId: number;
  fmId: string;
  fmPlayerName: string;
  originThreadId: string;
  playerName: string;
  processedMessageId: string | null;
  rosterRetrievedAt: string | null;
  rosterIndex: number;
};

type PlayerMemoryWriteResult = { status: "saved" | "existing" | "unavailable" };

type ValidatedMemoryRecord =
  | { candidate: ReferenceCandidate; status: "valid" }
  | { status: "stale" }
  | { status: "unavailable" };

type CurrentSourceReadResult =
  | { sourceRecords: MemorySourceRecord[]; status: "ready" }
  | { status: "stale" | "unavailable" };

type FmSourceRecord = Extract<
  FmReadResult,
  { status: "found" }
>["records"][number];

type ReepSourceRecord = Extract<
  ReturnType<typeof resolveReepSourceIdentities>,
  { status: "ready" }
>["records"][number];

const fmSourceVersionsFor = (sourceIds: string[]) => {
  if (sourceIds.length === 0) {
    return { fmManifestSha256: null, fmSnapshotDate: null };
  }

  const metadata = readFmRecommendationReferenceMetadata(sourceIds);

  return {
    fmManifestSha256:
      metadata.status === "ready" ? metadata.manifestSha256 : null,
    fmSnapshotDate: metadata.status === "ready" ? metadata.snapshotDate : null,
  };
};

const normalizedMemoryMention = (mention: string): string => {
  const normalized = normalizeLatinNameSpelling(mention.normalize("NFKD"))
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replaceAll(/[\s\p{P}\p{S}]/gu, "");

  return normalized.length > 0 ? normalized : "";
};

const sourceRecordsForCandidate = (candidate: ReferenceCandidate) => {
  const sourceRecords: z.output<typeof memorySourceRecordSchema>[] = [];

  for (const record of candidate.records) {
    if (
      record.sourceId.trim().length === 0 ||
      (record.provider !== "fm" && record.provider !== "understat")
    ) {
      continue;
    }

    sourceRecords.push({
      canonicalIdentityId: record.canonicalIdentityId ?? null,
      competition: record.competition,
      identityVerified:
        record.identityVerified ??
        (candidate.identityVerified && candidate.canonicalIdentityId !== null),
      name: record.name,
      provider: record.provider,
      season: record.season,
      sourceId: record.sourceId,
    });
  }

  return sourceRecords.toSorted(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.sourceId.localeCompare(right.sourceId) ||
      (left.competition ?? "").localeCompare(right.competition ?? "") ||
      (left.season ?? "").localeCompare(right.season ?? "")
  );
};

const sourceVersionsFor = (
  sourceRecords: z.output<typeof memorySourceRecordSchema>[]
) => {
  const fmSourceIds: string[] = [];

  const understatScopes: {
    competition: string;
    season: string;
    sourceId: string;
  }[] = [];

  for (const record of sourceRecords) {
    if (record.provider === "fm") {
      fmSourceIds.push(record.sourceId);
    }

    if (
      record.provider === "understat" &&
      record.competition !== null &&
      record.season !== null
    ) {
      understatScopes.push({
        competition: record.competition,
        season: record.season,
        sourceId: record.sourceId,
      });
    }
  }

  const registry = resolveReepSourceIdentities(sourceRecords);

  return {
    ...fmSourceVersionsFor(fmSourceIds),
    identityRegistryRelease:
      registry.status === "ready" ? registry.releaseStamp : null,
    understatScopes,
  };
};

const identityKeyFor = (
  normalizedMention: string,
  candidate: ReferenceCandidate
) =>
  stableHash(
    JSON.stringify({
      canonicalIdentityId: candidate.identityVerified
        ? candidate.canonicalIdentityId
        : null,
      normalizedMention,
      sourceRecords: sourceRecordsForCandidate(candidate).map(
        ({ provider, sourceId }) => [provider, sourceId]
      ),
    })
  );

const sourceRecordKey = (record: {
  competition: string | null;
  provider: "fm" | "understat";
  season: string | null;
  sourceId: string;
}) =>
  JSON.stringify([
    record.provider,
    record.sourceId,
    record.competition,
    record.season,
  ]);

const writeMemoryRecord = async (
  store: BaseStore,
  storeKey: string,
  matchesExisting: (item: Item) => boolean,
  createRecord: () => PlayerMemoryRecord
): Promise<PlayerMemoryWriteResult> => {
  let existing;

  try {
    existing = await store.get(playerMemoryNamespace, storeKey);
  } catch {
    return { status: "unavailable" };
  }

  if (existing !== null) {
    return matchesExisting(existing)
      ? { status: "existing" }
      : { status: "unavailable" };
  }

  const record = createRecord();

  try {
    await store.put(playerMemoryNamespace, storeKey, record, false);

    return { status: "saved" };
  } catch {
    return { status: "unavailable" };
  }
};

type MemoryCandidateIdentity = {
  canonicalIdentityId: string | null;
  identityBasis: "reep_registry" | "thread_confirmed";
  identityVerified: boolean;
};

const unlinkedMemoryIdentity: MemoryCandidateIdentity = {
  canonicalIdentityId: null,
  identityBasis: "thread_confirmed",
  identityVerified: false,
};

const candidateFromMemory = (
  memory: PlayerIdentityMemory,
  records: MemorySourceRecord[],
  identity: MemoryCandidateIdentity
): ReferenceCandidate => ({
  candidateId:
    identity.canonicalIdentityId === null
      ? `memory:${memory.stableIdentityKey}`
      : `reep:${identity.canonicalIdentityId}`,
  canonicalIdentityId: identity.canonicalIdentityId,
  exactNameMatch: true,
  identityBasis: identity.identityBasis,
  identityVerified: identity.identityVerified,
  name: memory.displayName,
  records: records.map((record) => ({ ...record, team: null })),
});

const readCurrentFmSourceRecords = (
  sourceRecords: MemorySourceRecord[]
): CurrentSourceReadResult => {
  const fmSourceRecords = sourceRecords.filter(
    (record) => record.provider === "fm"
  );

  if (fmSourceRecords.length === 0) {
    return { sourceRecords: [], status: "ready" };
  }

  const fmRead = readFmProfilesBySourceIds(
    fmSourceRecords.map((record) => record.sourceId)
  );

  if (fmRead.status === "unavailable") {
    return { status: "unavailable" };
  }

  const recordsBySourceId = new Map<string, FmSourceRecord>();

  for (const record of fmRead.records) {
    recordsBySourceId.set(record.identitySourceId, record);
  }

  const currentRecords: MemorySourceRecord[] = [];

  for (const memoryRecord of fmSourceRecords) {
    const current = recordsBySourceId.get(memoryRecord.sourceId);

    if (current === undefined) {
      return { status: "stale" };
    }

    currentRecords.push({ ...memoryRecord, name: current.player });
  }

  return { sourceRecords: currentRecords, status: "ready" };
};

const readCurrentUnderstatSourceRecord = (
  memoryRecord: MemorySourceRecord
): CurrentSourceReadResult => {
  const seasonStartYear = Number(memoryRecord.season?.slice(0, 4));

  if (
    memoryRecord.competition === null ||
    memoryRecord.season === null ||
    !Number.isInteger(seasonStartYear)
  ) {
    return { status: "stale" };
  }

  const result = readUnderstatBySourceIds(
    [memoryRecord.sourceId],
    seasonStartYear
  );

  if (result.status === "unavailable") {
    return { status: "unavailable" };
  }

  const [record] = result.records;

  if (
    record === undefined ||
    record.sourcePlayerId !== memoryRecord.sourceId ||
    record.competition !== memoryRecord.competition ||
    record.season !== memoryRecord.season
  ) {
    return { status: "stale" };
  }

  return {
    sourceRecords: [{ ...memoryRecord, name: record.player }],
    status: "ready",
  };
};

const readCurrentUnderstatSourceRecords = (
  sourceRecords: MemorySourceRecord[]
): CurrentSourceReadResult => {
  const currentRecords: MemorySourceRecord[] = [];

  for (const memoryRecord of sourceRecords) {
    if (memoryRecord.provider !== "understat") {
      continue;
    }

    const current = readCurrentUnderstatSourceRecord(memoryRecord);

    if (current.status !== "ready") {
      return current;
    }

    currentRecords.push(...current.sourceRecords);
  }

  return { sourceRecords: currentRecords, status: "ready" };
};

const requiresReepRegistryValidation = (
  memory: PlayerIdentityMemory
): boolean =>
  memory.canonicalIdentityId !== null ||
  memory.identityVerified ||
  memory.sourceRecords.length > 1;

const confirmedCanonicalLinkMatches = (
  stored: MemorySourceRecord,
  current: ReepSourceRecord | undefined
): boolean =>
  current !== undefined &&
  (!stored.identityVerified ||
    (current.status === "resolved" &&
      current.canonicalIdentityId === stored.canonicalIdentityId));

const canonicalIdentityFromMemoryRecords = (
  records: MemorySourceRecord[]
):
  | {
      canonicalIdentityId: string | null;
      identityVerified: boolean;
      status: "ready";
    }
  | { status: "conflict" } => {
  const canonicalIds = new Set<string>();

  for (const record of records) {
    if (record.identityVerified && record.canonicalIdentityId !== null) {
      canonicalIds.add(record.canonicalIdentityId);
    }
  }

  if (canonicalIds.size > 1) {
    return { status: "conflict" };
  }

  const [canonicalIdentityId] = canonicalIds;

  const identityVerified =
    canonicalIdentityId !== undefined &&
    records.every(
      (record) =>
        record.identityVerified &&
        record.canonicalIdentityId === canonicalIdentityId
    );

  return {
    canonicalIdentityId: identityVerified ? canonicalIdentityId : null,
    identityVerified,
    status: "ready",
  };
};

const readCurrentSourceRecords = (
  sourceRecords: MemorySourceRecord[]
): CurrentSourceReadResult => {
  const fmRecords = readCurrentFmSourceRecords(sourceRecords);

  if (fmRecords.status !== "ready") {
    return fmRecords;
  }

  const understatRecords = readCurrentUnderstatSourceRecords(sourceRecords);

  if (understatRecords.status !== "ready") {
    return understatRecords;
  }

  const recordsByKey = new Map<string, MemorySourceRecord>();

  for (const record of [
    ...fmRecords.sourceRecords,
    ...understatRecords.sourceRecords,
  ]) {
    recordsByKey.set(sourceRecordKey(record), record);
  }

  const currentSourceRecords: MemorySourceRecord[] = [];

  for (const sourceRecord of sourceRecords) {
    const current = recordsByKey.get(sourceRecordKey(sourceRecord));

    if (current === undefined) {
      return { status: "stale" };
    }

    currentSourceRecords.push(current);
  }

  return { sourceRecords: currentSourceRecords, status: "ready" };
};

const validateCanonicalIdentity = (
  memory: PlayerIdentityMemory,
  sourceRecords: MemorySourceRecord[]
): ValidatedMemoryRecord => {
  const reepRead = resolveReepSourceIdentities(sourceRecords);

  if (reepRead.status === "unavailable") {
    if (requiresReepRegistryValidation(memory)) {
      return { status: "unavailable" };
    }

    return {
      candidate: candidateFromMemory(
        memory,
        sourceRecords,
        unlinkedMemoryIdentity
      ),
      status: "valid",
    };
  }

  const currentBySource = new Map<string, (typeof reepRead.records)[number]>();

  for (const record of reepRead.records) {
    currentBySource.set(`${record.provider}:${record.sourceId}`, record);
  }

  const validatedRecords: MemorySourceRecord[] = [];

  for (const record of sourceRecords) {
    const current = currentBySource.get(
      `${record.provider}:${record.sourceId}`
    );

    if (
      current === undefined ||
      !confirmedCanonicalLinkMatches(record, current)
    ) {
      return { status: "stale" };
    }

    validatedRecords.push({
      ...record,
      canonicalIdentityId:
        current.status === "resolved" ? current.canonicalIdentityId : null,
      identityVerified: current.status === "resolved",
    });
  }

  const identity = canonicalIdentityFromMemoryRecords(validatedRecords);

  if (identity.status === "conflict") {
    return { status: "stale" };
  }

  if (
    memory.canonicalIdentityId !== null &&
    (!identity.identityVerified ||
      memory.canonicalIdentityId !== identity.canonicalIdentityId)
  ) {
    return { status: "stale" };
  }

  return {
    candidate: candidateFromMemory(memory, validatedRecords, {
      canonicalIdentityId: identity.canonicalIdentityId,
      identityBasis: identity.identityVerified
        ? "reep_registry"
        : "thread_confirmed",
      identityVerified: identity.identityVerified,
    }),
    status: "valid",
  };
};

const validatedPlayerRecords = (
  memory: PlayerIdentityMemory
): ValidatedMemoryRecord => {
  const current = readCurrentSourceRecords(memory.sourceRecords);

  return current.status === "ready"
    ? validateCanonicalIdentity(memory, current.sourceRecords)
    : { status: current.status };
};

const groupCurrentMemoryCandidates = (
  candidates: ReferenceCandidate[]
): ReferenceCandidate[] => {
  const grouped = new Map<string, ReferenceCandidate>();

  for (const candidate of candidates) {
    const key = candidate.canonicalIdentityId ?? candidate.candidateId;
    const previous = grouped.get(key);

    if (previous === undefined) {
      grouped.set(key, candidate);
      continue;
    }

    const records = [...previous.records, ...candidate.records].filter(
      (record, index, allRecords) =>
        allRecords.findIndex(
          (other) =>
            other.provider === record.provider &&
            other.sourceId === record.sourceId &&
            other.competition === record.competition &&
            other.season === record.season
        ) === index
    );

    grouped.set(key, { ...previous, records });
  }

  return [...grouped.values()].toSorted((left, right) =>
    left.candidateId.localeCompare(right.candidateId)
  );
};

const findRememberedPlayerIdentity = async (
  store: BaseStore,
  mention: string
): Promise<PlayerMemoryLookupResult> => {
  const normalizedMention = normalizedMemoryMention(mention);

  if (!normalizedMention) {
    return { status: "missing" };
  }

  let items;

  try {
    items = await store.search(playerMemoryNamespace, {
      filter: { kind: "player_identity", normalizedMention },
      limit: maxPlayerMemoryMatches,
    });
  } catch {
    return { status: "unavailable" };
  }

  if (items.length === maxPlayerMemoryMatches) {
    return { status: "stale" };
  }

  const remembered: PlayerIdentityMemory[] = [];

  for (const item of items) {
    if (item.value.kind !== "player_identity") {
      continue;
    }

    const record = playerIdentityMemorySchema.safeParse(item.value);

    if (!record.success) {
      return { status: "unavailable" };
    }

    remembered.push(record.data);
  }

  if (remembered.length === 0) {
    return { status: "missing" };
  }

  const candidates: ReferenceCandidate[] = [];
  let hasStaleRecord = false;

  for (const record of remembered) {
    const current = validatedPlayerRecords(record);

    if (current.status === "unavailable") {
      return { status: "unavailable" };
    }

    if (current.status === "stale") {
      hasStaleRecord = true;
      continue;
    }

    candidates.push(current.candidate);
  }

  if (hasStaleRecord) {
    return { status: "stale" };
  }

  const uniqueCandidates = groupCurrentMemoryCandidates(candidates);
  const [candidate] = uniqueCandidates;

  if (candidate === undefined) {
    return { status: "stale" };
  }

  const common = {
    candidateCount: uniqueCandidates.length,
    candidates: uniqueCandidates.slice(0, maxPlayerMemoryCandidates),
    candidatesTruncated: uniqueCandidates.length > maxPlayerMemoryCandidates,
    mention,
  };

  return {
    resolution:
      uniqueCandidates.length === 1
        ? {
            ...common,
            canonicalIdentityId: candidate.canonicalIdentityId,
            clarificationMessage: null,
            selectedCandidateId: candidate.candidateId,
            selectedName: candidate.name,
            status: "resolved",
          }
        : {
            ...common,
            canonicalIdentityId: null,
            clarificationMessage: `“${mention}”有多个曾经明确确认过的身份，请选择你指的球员。`,
            selectedCandidateId: null,
            selectedName: null,
            status: "needs_confirmation",
          },
    status: "found",
  };
};

const rememberPlayerIdentity = async (
  store: BaseStore,
  confirmation: PlayerIdentityConfirmation
): Promise<PlayerMemoryWriteResult> => {
  const normalizedMention = normalizedMemoryMention(confirmation.mention);
  const sourceRecords = sourceRecordsForCandidate(confirmation.candidate);

  if (
    normalizedMention.length === 0 ||
    confirmation.originThreadId.length === 0 ||
    sourceRecords.length === 0
  ) {
    return { status: "unavailable" };
  }

  const stableIdentityKey = identityKeyFor(
    normalizedMention,
    confirmation.candidate
  );

  const storeKey = `v1:player-identity:${stableIdentityKey}`;

  return await writeMemoryRecord(
    store,
    storeKey,
    (item) => {
      const parsed = playerIdentityMemorySchema.safeParse(item.value);

      return (
        parsed.success && parsed.data.stableIdentityKey === stableIdentityKey
      );
    },
    () =>
      playerIdentityMemorySchema.parse({
        canonicalIdentityId: confirmation.candidate.identityVerified
          ? confirmation.candidate.canonicalIdentityId
          : null,
        confirmationId: stableHash(
          JSON.stringify([
            confirmation.originThreadId,
            confirmation.processedMessageId,
            confirmation.playerIndex,
            stableIdentityKey,
          ])
        ),
        confirmedAt: new Date().toISOString(),
        displayName: confirmation.candidate.name,
        identityVerified: confirmation.candidate.identityVerified,
        kind: "player_identity",
        normalizedMention,
        originThreadId: confirmation.originThreadId,
        originalMention: confirmation.mention,
        schemaVersion: 1,
        sourceRecords,
        sourceVersions: sourceVersionsFor(sourceRecords),
        stableIdentityKey,
      })
  );
};

const rememberRosterIdentity = async (
  store: BaseStore,
  confirmation: RosterIdentityConfirmation
): Promise<PlayerMemoryWriteResult> => {
  if (
    confirmation.originThreadId.length === 0 ||
    confirmation.fmId.trim().length === 0
  ) {
    return { status: "unavailable" };
  }

  const fmSourceVersions = fmSourceVersionsFor([confirmation.fmId]);

  const stableIdentityKey = stableHash(
    JSON.stringify([confirmation.apiFootballPlayerId, confirmation.fmId])
  );

  const storeKey = `v1:roster-identity:${stableIdentityKey}`;

  return await writeMemoryRecord(
    store,
    storeKey,
    (item) => {
      const parsed = rosterIdentityMemorySchema.safeParse(item.value);

      return (
        parsed.success && parsed.data.stableIdentityKey === stableIdentityKey
      );
    },
    () =>
      rosterIdentityMemorySchema.parse({
        apiFootballPlayerId: confirmation.apiFootballPlayerId,
        confirmationId: stableHash(
          JSON.stringify([
            confirmation.originThreadId,
            confirmation.processedMessageId,
            confirmation.rosterIndex,
            stableIdentityKey,
          ])
        ),
        confirmedAt: new Date().toISOString(),
        fmId: confirmation.fmId,
        fmPlayerName: confirmation.fmPlayerName,
        kind: "roster_identity",
        originThreadId: confirmation.originThreadId,
        rosterPlayerName: confirmation.playerName,
        rosterRetrievedAt: confirmation.rosterRetrievedAt,
        schemaVersion: 1,
        sourceVersions: fmSourceVersions,
        stableIdentityKey,
      })
  );
};

type RosterIdentityItemsResult =
  | { items: Item[]; status: "ready" }
  | { status: "conflict" | "missing" | "unavailable" };

type CurrentRosterProfilesResult =
  | {
      candidates: TeamFmProfileCandidate[];
      missingFmIds: string[];
      status: "ready";
    }
  | { status: "unavailable" };

type ParsedRosterIdentityItemsResult =
  | { records: RosterIdentityMemory[]; status: "ready" }
  | { status: "unavailable" };

const searchRosterIdentityItems = async (
  store: BaseStore,
  apiFootballPlayerId: number
): Promise<RosterIdentityItemsResult> => {
  let items: Item[];

  try {
    items = await store.search(playerMemoryNamespace, {
      filter: { apiFootballPlayerId, kind: "roster_identity" },
      limit: maxPlayerMemoryMatches,
    });
  } catch {
    return { status: "unavailable" };
  }

  if (items.length === 0) {
    return { status: "missing" };
  }

  if (items.length === maxPlayerMemoryMatches) {
    return { status: "conflict" };
  }

  return { items, status: "ready" };
};

const parseRosterIdentityItems = (
  items: Item[],
  apiFootballPlayerId: number
): ParsedRosterIdentityItemsResult => {
  const records: RosterIdentityMemory[] = [];

  for (const item of items) {
    const parsed = rosterIdentityMemorySchema.safeParse(item.value);

    if (!parsed.success) {
      return { status: "unavailable" };
    }

    const expectedKey = stableHash(
      JSON.stringify([apiFootballPlayerId, parsed.data.fmId])
    );

    if (
      parsed.data.apiFootballPlayerId !== apiFootballPlayerId ||
      parsed.data.stableIdentityKey !== expectedKey ||
      item.key !== `v1:roster-identity:${expectedKey}`
    ) {
      return { status: "unavailable" };
    }

    records.push(parsed.data);
  }

  return { records, status: "ready" as const };
};

const readCurrentRosterProfiles = (
  fmIds: string[]
): CurrentRosterProfilesResult => {
  const requestedFmIds = new Set(fmIds);
  const fmRead = readFmProfilesBySourceIds(fmIds);

  if (fmRead.status === "unavailable") {
    return { status: "unavailable" };
  }

  const profilesById = new Map<string, TeamFmProfileCandidate>();

  if (fmRead.status === "found") {
    for (const profile of fmRead.records) {
      if (
        requestedFmIds.has(profile.identitySourceId) &&
        !profilesById.has(profile.identitySourceId)
      ) {
        profilesById.set(profile.identitySourceId, {
          birthDate: profile.birthDate,
          currentAbility: profile.currentAbility,
          fmId: profile.identitySourceId,
          name: profile.player,
          naturalPositions: profile.naturalPositions,
          potentialAbility: profile.potentialAbility,
        });
      }
    }
  }

  const candidates = [...profilesById.values()].toSorted((left, right) =>
    left.fmId.localeCompare(right.fmId)
  );

  const missingFmIds = fmIds.filter((fmId) => !profilesById.has(fmId));

  return { candidates, missingFmIds, status: "ready" };
};

const apiBridgeConflictsWithRosterIdentity = (
  apiFootballPlayerId: number,
  fmIds: string[]
): { conflict: boolean; status: "ready" } | { status: "unavailable" } => {
  const fmIdsForBridge = new Set<string>();

  let bridge;

  try {
    bridge = resolveApiFootballPlayerFmIds(String(apiFootballPlayerId));
  } catch (error) {
    if (error instanceof Error && isLocalDataError(error)) {
      return { status: "unavailable" };
    }

    throw error;
  }

  for (const fmId of bridge.fmIds) {
    fmIdsForBridge.add(fmId);
  }

  return {
    conflict:
      bridge.status === "ambiguous" ||
      (bridge.status === "resolved" &&
        fmIds.some((fmId) => !fmIdsForBridge.has(fmId))),
    status: "ready",
  };
};

const findRememberedRosterIdentity = async (
  store: BaseStore,
  apiFootballPlayerId: number
): Promise<RememberedRosterIdentityLookupResult> => {
  const search = await searchRosterIdentityItems(store, apiFootballPlayerId);

  if (search.status !== "ready") {
    return search.status === "conflict"
      ? { candidates: [], status: "conflict" }
      : { status: search.status };
  }

  const parsed = parseRosterIdentityItems(search.items, apiFootballPlayerId);

  if (parsed.status !== "ready") {
    return parsed;
  }

  const fmIds = [
    ...new Set(parsed.records.map((record) => record.fmId)),
  ].toSorted();

  const profileRead = readCurrentRosterProfiles(fmIds);

  if (profileRead.status !== "ready") {
    return profileRead;
  }

  const bridge = apiBridgeConflictsWithRosterIdentity(
    apiFootballPlayerId,
    fmIds
  );

  if (bridge.status !== "ready") {
    return bridge;
  }

  if (
    fmIds.length > 1 ||
    profileRead.missingFmIds.length > 0 ||
    bridge.conflict
  ) {
    return { candidates: profileRead.candidates, status: "conflict" };
  }

  const [candidate] = profileRead.candidates;

  return candidate === undefined
    ? { status: "stale" }
    : { candidate, status: "found" };
};

const readPlayerMemoryEntries = async (
  store: BaseStore
): Promise<StoredPlayerMemoryEntriesResult> => {
  let items: Item[];

  try {
    items = await store.search(playerMemoryNamespace, {
      limit: maxPlayerMemoryMatches,
    });
  } catch {
    return { status: "unavailable" };
  }

  const entries: StoredPlayerMemoryEntry[] = [];

  for (const item of items) {
    const entry = parseStoredPlayerMemoryEntry(item);

    if (entry === null) {
      return { status: "unavailable" };
    }

    entries.push(entry);
  }

  return {
    entries,
    status: "ready",
    truncated: items.length === maxPlayerMemoryMatches,
  };
};

const playerIdentityValidationStatus = (
  record: PlayerIdentityMemory,
  mentionCount: number
): PlayerMemoryValidationStatus => {
  if (mentionCount > 1) {
    return "conflicting";
  }

  const validation = validatedPlayerRecords(record);

  if (validation.status === "valid") {
    return "current";
  }

  return validation.status === "stale" ? "needs_confirmation" : "unavailable";
};

const rosterValidationByPlayerId = async (
  store: BaseStore,
  entries: StoredPlayerMemoryEntry[]
) => {
  const apiFootballPlayerIds = [
    ...new Set(
      entries.flatMap((entry) =>
        entry.record.kind === "roster_identity"
          ? [entry.record.apiFootballPlayerId]
          : []
      )
    ),
  ];

  const validations = await Promise.all(
    apiFootballPlayerIds.map(async (apiFootballPlayerId) => ({
      apiFootballPlayerId,
      result: await findRememberedRosterIdentity(store, apiFootballPlayerId),
    }))
  );

  return new Map(
    validations.map(({ apiFootballPlayerId, result }) => [
      apiFootballPlayerId,
      result,
    ])
  );
};

const rosterIdentityValidationStatus = (
  record: RosterIdentityMemory,
  validation: RememberedRosterIdentityLookupResult | undefined
): PlayerMemoryValidationStatus => {
  if (validation?.status === "conflict") {
    return "conflicting";
  }

  if (validation?.status === "found") {
    return validation.candidate.fmId === record.fmId
      ? "current"
      : "conflicting";
  }

  if (validation?.status === "stale" || validation?.status === "missing") {
    return "needs_confirmation";
  }

  return "unavailable";
};

const playerMemoryListingRecord = (
  entry: StoredPlayerMemoryEntry,
  mentionCounts: Map<string, number>,
  rosterValidations: Map<number, RememberedRosterIdentityLookupResult>
): PlayerMemoryListingRecord => {
  if (entry.record.kind === "player_identity") {
    return {
      canonicalIdentityId: entry.record.canonicalIdentityId,
      confirmationId: entry.record.confirmationId,
      confirmedAt: entry.record.confirmedAt,
      displayName: entry.record.displayName,
      identityVerified: entry.record.identityVerified,
      kind: "player_identity",
      mention: entry.record.originalMention,
      originThreadId: entry.record.originThreadId,
      sourceRecords: entry.record.sourceRecords.map(
        ({ canonicalIdentityId, identityVerified, provider, sourceId }) => ({
          canonicalIdentityId,
          identityVerified,
          provider,
          sourceId,
        })
      ),
      validationStatus: playerIdentityValidationStatus(
        entry.record,
        mentionCounts.get(entry.record.normalizedMention) ?? 0
      ),
    };
  }

  return {
    apiFootballPlayerId: entry.record.apiFootballPlayerId,
    confirmationId: entry.record.confirmationId,
    confirmedAt: entry.record.confirmedAt,
    fmId: entry.record.fmId,
    fmPlayerName: entry.record.fmPlayerName,
    kind: "roster_identity",
    originThreadId: entry.record.originThreadId,
    rosterPlayerName: entry.record.rosterPlayerName,
    validationStatus: rosterIdentityValidationStatus(
      entry.record,
      rosterValidations.get(entry.record.apiFootballPlayerId)
    ),
  };
};

const comparePlayerMemoryListingRecords = (
  left: PlayerMemoryListingRecord,
  right: PlayerMemoryListingRecord
): number => {
  const kindOrder = left.kind.localeCompare(right.kind);

  if (kindOrder !== 0) {
    return kindOrder;
  }

  if (left.kind === "player_identity" && right.kind === "player_identity") {
    return left.mention.localeCompare(right.mention);
  }

  if (left.kind === "roster_identity" && right.kind === "roster_identity") {
    return (
      left.apiFootballPlayerId - right.apiFootballPlayerId ||
      left.fmId.localeCompare(right.fmId)
    );
  }

  return 0;
};

const listPlayerMemories = async (
  store: BaseStore
): Promise<PlayerMemoryListResult> => {
  const stored = await readPlayerMemoryEntries(store);

  if (stored.status !== "ready") {
    return stored;
  }

  const mentionCounts = new Map<string, number>();

  for (const entry of stored.entries) {
    if (entry.record.kind === "player_identity") {
      const count = mentionCounts.get(entry.record.normalizedMention) ?? 0;
      mentionCounts.set(entry.record.normalizedMention, count + 1);
    }
  }

  const rosterValidations = await rosterValidationByPlayerId(
    store,
    stored.entries
  );

  const records = stored.entries
    .map((entry) =>
      playerMemoryListingRecord(entry, mentionCounts, rosterValidations)
    )
    .toSorted(comparePlayerMemoryListingRecords);

  return {
    records,
    status: "ready",
    truncated: stored.truncated,
  };
};

const playerAliasForgetOption = (
  entry: StoredPlayerMemoryEntry,
  query: PlayerMemoryForgetQuery,
  normalizedTarget: string | null
): PlayerMemoryForgetOption | null => {
  if (entry.record.kind !== "player_identity") {
    return null;
  }

  if (query.apiFootballPlayerId !== null || query.fmId !== null) {
    return null;
  }

  if (query.targetKind === "roster_identity" || normalizedTarget === null) {
    return null;
  }

  const matchesAlias = entry.record.normalizedMention === normalizedTarget;

  const matchesDisplayName =
    query.targetKind === null &&
    normalizedMemoryMention(entry.record.displayName) === normalizedTarget;

  if (!matchesAlias && !matchesDisplayName) {
    return null;
  }

  return {
    label: `球员称呼“${entry.record.originalMention}” → ${entry.record.displayName}`,
    target: {
      kind: "player_identity",
      mention: entry.record.originalMention,
    },
  };
};

const rosterForgetOption = (
  entry: StoredPlayerMemoryEntry,
  query: PlayerMemoryForgetQuery,
  normalizedTarget: string | null
): PlayerMemoryForgetOption | null => {
  if (entry.record.kind !== "roster_identity") {
    return null;
  }

  if (query.targetKind === "player_identity") {
    return null;
  }

  const { record } = entry;

  const matchesApiId =
    query.apiFootballPlayerId === null ||
    query.apiFootballPlayerId === record.apiFootballPlayerId;

  const matchesFmId = query.fmId === null || query.fmId === record.fmId;

  const matchesMention =
    normalizedTarget === null ||
    normalizedMemoryMention(record.rosterPlayerName) === normalizedTarget ||
    normalizedMemoryMention(record.fmPlayerName) === normalizedTarget;

  const hasExplicitTarget =
    query.apiFootballPlayerId !== null ||
    query.fmId !== null ||
    normalizedTarget !== null;

  if (!matchesApiId || !matchesFmId || !matchesMention || !hasExplicitTarget) {
    return null;
  }

  return {
    label: `阵容映射 API-Football #${record.apiFootballPlayerId}（${record.rosterPlayerName}） → FM ${record.fmId}（${record.fmPlayerName}）`,
    target: {
      apiFootballPlayerId: record.apiFootballPlayerId,
      fmId: record.fmId,
      kind: "roster_identity",
      mention: record.rosterPlayerName,
    },
  };
};

const forgetTargetKey = (target: PlayerMemoryManagementTarget): string =>
  target.kind === "player_identity"
    ? `player_identity:${normalizedMemoryMention(target.mention)}`
    : `roster_identity:${target.apiFootballPlayerId}:${target.fmId}`;

const findPlayerMemoryForgetOptions = async (
  store: BaseStore,
  query: PlayerMemoryForgetQuery
): Promise<PlayerMemoryForgetOptionsResult> => {
  const stored = await readPlayerMemoryEntries(store);

  if (stored.status !== "ready" || stored.truncated) {
    return { status: "unavailable" };
  }

  const normalizedTarget =
    query.targetMention === null
      ? null
      : normalizedMemoryMention(query.targetMention);

  const optionsByKey = new Map<string, PlayerMemoryForgetOption>();

  for (const entry of stored.entries) {
    const option =
      playerAliasForgetOption(entry, query, normalizedTarget) ??
      rosterForgetOption(entry, query, normalizedTarget);

    if (option !== null) {
      optionsByKey.set(forgetTargetKey(option.target), option);
    }
  }

  return {
    options: [...optionsByKey.values()].toSorted((left, right) =>
      left.label.localeCompare(right.label)
    ),
    status: "ready",
  };
};

const deletePlayerMemoryTarget = async (
  store: BaseStore,
  target: PlayerMemoryManagementTarget
): Promise<PlayerMemoryDeleteResult> => {
  const stored = await readPlayerMemoryEntries(store);

  if (stored.status !== "ready" || stored.truncated) {
    return { status: "failed" };
  }

  const keys = stored.entries.flatMap((entry) => {
    if (target.kind === "player_identity") {
      return entry.record.kind === "player_identity" &&
        entry.record.normalizedMention ===
          normalizedMemoryMention(target.mention)
        ? [entry.key]
        : [];
    }

    return entry.record.kind === "roster_identity" &&
      entry.record.apiFootballPlayerId === target.apiFootballPlayerId &&
      entry.record.fmId === target.fmId
      ? [entry.key]
      : [];
  });

  if (keys.length === 0) {
    return { status: "not_found" };
  }

  const results = await Promise.all(
    keys.map(async (key) => {
      try {
        await store.delete(playerMemoryNamespace, key);

        return true;
      } catch {
        return false;
      }
    })
  );

  const deletedCount = results.filter(Boolean).length;
  const failedCount = results.length - deletedCount;

  if (failedCount === 0) {
    return { deletedCount, status: "forgotten" };
  }

  return deletedCount === 0
    ? { status: "failed" }
    : { deletedCount, failedCount, status: "partial_failure" };
};

const correctPlayerMemoryAlias = async (
  store: BaseStore,
  confirmation: PlayerIdentityConfirmation
): Promise<PlayerMemoryCorrectionResult> => {
  const stored = await readPlayerMemoryEntries(store);

  if (stored.status !== "ready" || stored.truncated) {
    return { status: "failed" };
  }

  const normalizedMention = normalizedMemoryMention(confirmation.mention);

  const previousRecords = stored.entries.filter(
    (entry) =>
      entry.record.kind === "player_identity" &&
      entry.record.normalizedMention === normalizedMention
  );

  if (previousRecords.length === 0) {
    return { status: "not_found" };
  }

  const write = await rememberPlayerIdentity(store, confirmation);

  if (write.status === "unavailable") {
    return { status: "failed" };
  }

  const replacementStoreKey = `v1:player-identity:${identityKeyFor(
    normalizedMention,
    confirmation.candidate
  )}`;

  const previousKeys = previousRecords.flatMap(({ key }) =>
    key === replacementStoreKey ? [] : [key]
  );

  const deletionResults = await Promise.all(
    previousKeys.map(async (key) => {
      try {
        await store.delete(playerMemoryNamespace, key);

        return true;
      } catch {
        return false;
      }
    })
  );

  const deletedCount = deletionResults.filter(Boolean).length;
  const failedCount = deletionResults.length - deletedCount;

  return failedCount === 0
    ? { status: "corrected" }
    : { deletedCount, failedCount, status: "partial_failure" };
};

export {
  correctPlayerMemoryAlias,
  deletePlayerMemoryTarget,
  findPlayerMemoryForgetOptions,
  findRememberedRosterIdentity,
  findRememberedPlayerIdentity,
  listPlayerMemories,
  rememberPlayerIdentity,
  rememberRosterIdentity,
};

export type {
  PlayerIdentityConfirmation,
  PlayerMemoryLookupResult,
  PlayerMemoryDeleteResult,
  PlayerMemoryCorrectionResult,
  PlayerMemoryForgetOptionsResult,
  PlayerMemoryForgetQuery,
  PlayerMemoryListResult,
  PlayerMemoryListingRecord,
  RememberedRosterIdentityLookupResult,
  RosterIdentityConfirmation,
};
