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
import { resolveReepSourceIdentities } from "./player-data/reep-registry.js";
import { normalizeLatinNameSpelling } from "./player-data/shared.js";
import { readUnderstatBySourceIds } from "./player-data/understat.js";

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

const stableHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

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

export {
  findRememberedPlayerIdentity,
  rememberPlayerIdentity,
  rememberRosterIdentity,
};

export type { PlayerMemoryLookupResult, RosterIdentityConfirmation };
