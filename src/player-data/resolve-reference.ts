import type { DatabaseSync } from "node:sqlite";

import type {
  CandidateSourceRecord,
  ReferenceCandidate,
  ReferenceLookupResult,
} from "./contracts.js";
import { readFmReferenceRecords } from "./football-manager.js";
import { openIdentityRegistry, resolveReepRecord } from "./reep-registry.js";
import { assertModelProcessingAllowed, resolveDataPath } from "./shared.js";
import { readUnderstatReferenceRecords } from "./understat.js";

type ReferenceIdentityLookup = (
  mention: string
) => Promise<ReferenceLookupResult> | ReferenceLookupResult;

const limitReferenceCandidates = (candidates: ReferenceCandidate[]) => ({
  candidateCount: candidates.length,
  candidates: candidates.slice(0, 8),
  candidatesTruncated: candidates.length > 8,
});

const toReferenceSourceRecord = (
  record: CandidateSourceRecord
): ReferenceCandidate["records"][number] => ({
  competition: record.competition,
  name: record.name,
  provider: record.provider,
  season: record.season,
  sourceId: record.sourceId,
  team: record.team,
});

const groupReferenceCandidates = (
  records: CandidateSourceRecord[],
  registry: DatabaseSync | null | undefined
): ReferenceCandidate[] => {
  const groups = new Map<string, ReferenceCandidate>();

  for (const record of records) {
    const identity = registry
      ? resolveReepRecord(registry, record.provider, record.sourceId)
      : { canonicalIdentityId: null, status: "unresolved" as const };

    const canonicalIdentityId =
      identity.status === "resolved" ? identity.canonicalIdentityId : null;

    const candidateId =
      canonicalIdentityId === null
        ? `source:${record.provider}:${record.sourceId}`
        : `reep:${canonicalIdentityId}`;

    const candidate = groups.get(candidateId);

    if (candidate !== undefined) {
      if (
        !candidate.records.some(
          (existing) =>
            existing.provider === record.provider &&
            existing.sourceId === record.sourceId &&
            existing.season === record.season &&
            existing.competition === record.competition
        )
      ) {
        candidate.records.push(toReferenceSourceRecord(record));
      }

      candidate.exactNameMatch ||= record.exactNameMatch;

      if (identity.status !== "resolved") {
        candidate.identityVerified = false;
      }

      continue;
    }

    groups.set(candidateId, {
      candidateId,
      canonicalIdentityId,
      exactNameMatch: record.exactNameMatch,
      identityVerified: canonicalIdentityId !== null,
      name: record.name,
      records: [toReferenceSourceRecord(record)],
    });
  }

  return [...groups.values()].toSorted(
    (left, right) =>
      Number(right.records.some((record) => record.provider === "understat")) -
        Number(
          left.records.some((record) => record.provider === "understat")
        ) ||
      Number(right.exactNameMatch) - Number(left.exactNameMatch) ||
      left.name.localeCompare(right.name)
  );
};

const resolvePlayerReference = (mention: string): ReferenceLookupResult => {
  assertModelProcessingAllowed("both");

  const records = [
    ...readUnderstatReferenceRecords(mention),
    ...readFmReferenceRecords(mention),
  ];

  if (!records.length) {
    return {
      candidateCount: 0,
      candidates: [],
      candidatesTruncated: false,
      canonicalIdentityId: null,
      clarificationMessage: `我没能在本地资料中找到“${mention}”。请提供完整姓名或球队线索。`,
      mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "not_found",
    };
  }

  const registryPath = resolveDataPath(
    process.env.TACTISCOUT_REEP_IDENTITY_DB_PATH,
    ".data/reep/identity-with-fm.sqlite"
  );

  const registry = openIdentityRegistry(registryPath);

  if (registry === null) {
    const limited = limitReferenceCandidates(
      groupReferenceCandidates(records, null)
    );

    return {
      canonicalIdentityId: null,
      clarificationMessage:
        "本地身份注册表不可用，不能安全地跨来源确认这个球员。请指定一个来源记录或提供更多身份信息。",
      mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "registry_unavailable",
      ...limited,
    };
  }

  try {
    const allCandidates = groupReferenceCandidates(records, registry);
    const limited = limitReferenceCandidates(allCandidates);

    const candidate = allCandidates.find(
      (item) => item.exactNameMatch && item.identityVerified
    );

    if (
      candidate !== undefined &&
      allCandidates.length === 1 &&
      candidate.exactNameMatch &&
      candidate.identityVerified
    ) {
      return {
        canonicalIdentityId: candidate.canonicalIdentityId,
        clarificationMessage: null,
        mention,
        selectedCandidateId: candidate.candidateId,
        selectedName: candidate.name,
        status: "resolved",
        ...limited,
      };
    }

    let clarificationMessage: string;

    if (limited.candidatesTruncated) {
      clarificationMessage = `“${mention}”匹配到 ${limited.candidateCount} 个身份，候选太多。请补充完整姓名或球队线索。`;
    } else if (allCandidates.length > 1) {
      clarificationMessage = `“${mention}”匹配到多个身份，请选择一个。`;
    } else {
      clarificationMessage = `“${mention}”不是唯一的完整姓名匹配，请确认候选是否正确。`;
    }

    return {
      canonicalIdentityId: null,
      clarificationMessage,
      mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "needs_confirmation",
      ...limited,
    };
  } finally {
    registry.close();
  }
};

export { resolvePlayerReference };

export type { ReferenceIdentityLookup };
