import type { DatabaseSync } from "node:sqlite";

import type {
  CandidateSourceRecord,
  ReferenceCandidate,
  ReferenceLookupResult,
} from "./contracts.js";
import { readFmReferenceRecords } from "./football-manager.js";
import { openIdentityRegistry, resolveReepRecord } from "./reep-registry.js";
import {
  assertModelProcessingAllowed,
  isLocalDataError,
  normalizePlayerName,
  resolveDataPath,
} from "./shared.js";
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
  record: CandidateSourceRecord,
  canonicalIdentityId: string | null,
  identityVerified: boolean
): ReferenceCandidate["records"][number] => ({
  canonicalIdentityId,
  competition: record.competition,
  identityVerified,
  name: record.name,
  provider: record.provider,
  season: record.season,
  sourceId: record.sourceId,
  team: record.team,
});

const sameSourceRecord = (
  first: ReferenceCandidate["records"][number],
  second: CandidateSourceRecord
): boolean =>
  first.provider === second.provider &&
  first.sourceId === second.sourceId &&
  first.season === second.season &&
  first.competition === second.competition;

const sortReferenceCandidates = (candidates: ReferenceCandidate[]) =>
  candidates.toSorted(
    (left, right) =>
      Number(right.records.some((record) => record.provider === "understat")) -
        Number(
          left.records.some((record) => record.provider === "understat")
        ) ||
      Number(right.exactNameMatch) - Number(left.exactNameMatch) ||
      left.name.localeCompare(right.name)
  );

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

    const identityVerified = canonicalIdentityId !== null;

    const candidateId =
      canonicalIdentityId === null
        ? `source:${record.provider}:${record.sourceId}`
        : `reep:${canonicalIdentityId}`;

    const candidate = groups.get(candidateId);

    if (candidate !== undefined) {
      if (
        !candidate.records.some((existing) =>
          sameSourceRecord(existing, record)
        )
      ) {
        candidate.records.push(
          toReferenceSourceRecord(record, canonicalIdentityId, identityVerified)
        );
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
      identityBasis:
        canonicalIdentityId === null ? "source_record" : "reep_registry",
      identityVerified: canonicalIdentityId !== null,
      name: record.name,
      records: [
        toReferenceSourceRecord(record, canonicalIdentityId, identityVerified),
      ],
    });
  }

  return sortReferenceCandidates([...groups.values()]);
};

const candidateProviders = (candidate: ReferenceCandidate): Set<string> =>
  new Set(candidate.records.map((record) => record.provider));

const singleCandidateProvider = (
  candidate: ReferenceCandidate
): "fm" | "understat" | null => {
  const [provider] = candidateProviders(candidate);

  return candidateProviders(candidate).size === 1 &&
    (provider === "fm" || provider === "understat")
    ? provider
    : null;
};

const candidatesSuggestSamePerson = (
  first: ReferenceCandidate,
  second: ReferenceCandidate
): boolean => {
  if (
    first.canonicalIdentityId !== null &&
    second.canonicalIdentityId !== null
  ) {
    return false;
  }

  if (first.exactNameMatch === second.exactNameMatch) {
    return false;
  }

  const firstProvider = singleCandidateProvider(first);
  const secondProvider = singleCandidateProvider(second);

  if (
    firstProvider === null ||
    secondProvider === null ||
    firstProvider === secondProvider
  ) {
    return false;
  }

  const firstName = normalizePlayerName(first.name);
  const secondName = normalizePlayerName(second.name);

  const shorterName =
    firstName.length < secondName.length ? firstName : secondName;

  const longerName =
    firstName.length < secondName.length ? secondName : firstName;

  return (
    shorterName.length >= 8 &&
    shorterName !== longerName &&
    longerName.startsWith(shorterName)
  );
};

const uniqueCandidateRecords = (
  candidates: ReferenceCandidate[]
): ReferenceCandidate["records"] => {
  const records = new Map<string, ReferenceCandidate["records"][number]>();

  for (const candidate of candidates) {
    for (const record of candidate.records) {
      const key = JSON.stringify([
        record.provider,
        record.sourceId,
        record.competition,
        record.season,
      ]);

      if (!records.has(key)) {
        records.set(key, record);
      }
    }
  }

  return [...records.values()];
};

const groupPossibleSamePersonCandidates = (
  candidates: ReferenceCandidate[]
): ReferenceCandidate[] => {
  const possiblePartners = candidates.map((candidate, candidateIndex) =>
    candidates.flatMap((other, otherIndex) =>
      candidateIndex !== otherIndex &&
      candidatesSuggestSamePerson(candidate, other)
        ? [otherIndex]
        : []
    )
  );

  const groupedCandidates: ReferenceCandidate[] = [];
  const usedIndexes = new Set<number>();

  for (const [candidateIndex, candidate] of candidates.entries()) {
    if (!usedIndexes.has(candidateIndex)) {
      const partners = possiblePartners[candidateIndex] ?? [];
      const [partnerIndex] = partners;

      const partner =
        partnerIndex === undefined ? undefined : candidates[partnerIndex];

      const hasSinglePartner = partners.length === 1 && partner !== undefined;

      const partnerHasSingleLink =
        partnerIndex !== undefined &&
        (possiblePartners[partnerIndex]?.length ?? 0) === 1;

      const isUniquePair = hasSinglePartner && partnerHasSingleLink;

      if (isUniquePair && partner !== undefined && partnerIndex !== undefined) {
        const relatedCandidates = [candidate, partner];

        const preferredName = relatedCandidates.find(
          (item) => item.exactNameMatch
        );

        const candidateIds = relatedCandidates
          .map((item) => item.candidateId)
          .toSorted();

        groupedCandidates.push({
          candidateId: `thread-candidate:${candidateIds.join("|")}`,
          canonicalIdentityId: null,
          exactNameMatch: true,
          identityBasis: "thread_candidate",
          identityVerified: false,
          name: preferredName?.name ?? candidate.name,
          records: uniqueCandidateRecords(relatedCandidates),
        });
        usedIndexes.add(candidateIndex);
        usedIndexes.add(partnerIndex);
      } else {
        groupedCandidates.push(candidate);
        usedIndexes.add(candidateIndex);
      }
    }
  }

  return sortReferenceCandidates(groupedCandidates);
};

const candidateNameKey = (name: string): string => {
  const normalizedName = normalizePlayerName(name);

  return normalizedName.length > 0
    ? normalizedName
    : name
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replaceAll(/[\s\p{P}\p{S}]/gu, "");
};

const hasDuplicateCandidateName = (candidates: ReferenceCandidate[]): boolean =>
  candidates.some((candidate, index) =>
    candidates.some(
      (other, otherIndex) =>
        index !== otherIndex &&
        candidateNameKey(candidate.name) === candidateNameKey(other.name)
    )
  );

const clarificationForCandidates = (
  mention: string,
  candidates: ReferenceCandidate[],
  candidatesTruncated: boolean,
  candidateCount: number
): string => {
  if (candidatesTruncated) {
    return `“${mention}”匹配到 ${candidateCount} 个候选，数量较多。请补充球队、赛事或赛季线索。`;
  }

  if (
    candidates.some(
      (candidate) => candidate.identityBasis === "thread_candidate"
    )
  ) {
    return `“${mention}”匹配到名字相近的跨来源候选组。候选组会列出 FM 和 Understat 各自的记录；选中候选组表示你确认它们在当前 thread 指向同一人。若只想使用一个来源，请回复“只用 FM”或“只用 Understat”。`;
  }

  if (hasDuplicateCandidateName(candidates)) {
    return `“${mention}”匹配到多个同名候选。请回复候选编号，或补充球队、赛事或赛季；多个编号（例如 1,2）表示你确认这些来源记录属于同一人。`;
  }

  return candidates.length > 1
    ? `“${mention}”匹配到多个身份，请回复候选编号或补充球队、赛事或赛季。多个编号（例如 1,2）表示你确认这些来源记录属于同一人；如果它们对应不同的 Reep ID，系统会保持分开。`
    : `“${mention}”不是唯一的完整姓名匹配，请确认候选是否正确。`;
};

const dataUnavailableReference = (mention: string): ReferenceLookupResult => ({
  candidateCount: 0,
  candidates: [],
  candidatesTruncated: false,
  canonicalIdentityId: null,
  clarificationMessage:
    "本地球员身份资料无法读取，本次请求没有执行。请检查本地数据后重试。",
  mention,
  selectedCandidateId: null,
  selectedName: null,
  status: "data_unavailable",
});

const resolvePlayerReference = (mention: string): ReferenceLookupResult => {
  assertModelProcessingAllowed("both");

  let records: CandidateSourceRecord[];

  try {
    records = [
      ...readUnderstatReferenceRecords(mention),
      ...readFmReferenceRecords(mention),
    ];
  } catch (error) {
    if (error instanceof Error && isLocalDataError(error)) {
      return dataUnavailableReference(mention);
    }

    throw error;
  }

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

  let registry: DatabaseSync | null;

  try {
    registry = openIdentityRegistry(registryPath);
  } catch (error) {
    if (error instanceof Error && isLocalDataError(error)) {
      return dataUnavailableReference(mention);
    }

    throw error;
  }

  if (registry === null) {
    const limited = limitReferenceCandidates(
      groupPossibleSamePersonCandidates(groupReferenceCandidates(records, null))
    );

    return {
      canonicalIdentityId: null,
      clarificationMessage:
        "本地身份注册表不可用，无法自动确认跨来源关联。请指定单条来源记录，或明确确认候选组中的来源记录在当前 thread 属于同一人。",
      mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "registry_unavailable",
      ...limited,
    };
  }

  try {
    const allCandidates = groupPossibleSamePersonCandidates(
      groupReferenceCandidates(records, registry)
    );

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

    const clarificationMessage = clarificationForCandidates(
      mention,
      allCandidates,
      limited.candidatesTruncated,
      limited.candidateCount
    );

    return {
      canonicalIdentityId: null,
      clarificationMessage,
      mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "needs_confirmation",
      ...limited,
    };
  } catch (error) {
    if (error instanceof Error && isLocalDataError(error)) {
      return dataUnavailableReference(mention);
    }

    throw error;
  } finally {
    registry.close();
  }
};

export { resolvePlayerReference };

export type { ReferenceIdentityLookup };
