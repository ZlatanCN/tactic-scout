import type { CandidateSourceRecord } from "./contracts.js";
import { normalizePlayerName } from "./shared.js";

const tokenize = (value: string): string[] =>
  value
    .normalize("NFKD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);

const hasContiguousTokens = (source: string[], target: string[]): boolean =>
  source.some((_, index) =>
    target.every((token, offset) => source[index + offset] === token)
  );

const matchReferenceName = (mention: string, names: string[]) => {
  const queryTokens = tokenize(mention);

  if (queryTokens.length === 0 || names.length === 0) {
    return { exact: false, matches: false };
  }

  const normalizedMention = normalizePlayerName(mention);

  const exact = names.some(
    (name) => normalizePlayerName(name) === normalizedMention
  );

  if (exact) {
    return { exact: true, matches: true };
  }

  const matches = names.some((name) => {
    const nameTokens = tokenize(name);

    return queryTokens.length === 1
      ? nameTokens.includes(queryTokens[0])
      : hasContiguousTokens(nameTokens, queryTokens);
  });

  return { exact: false, matches };
};

const deduplicateSourceRecords = (
  records: CandidateSourceRecord[]
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

    if (previous === undefined) {
      unique.set(key, record);
    } else {
      previous.exactNameMatch ||= record.exactNameMatch;
    }
  }

  return [...unique.values()];
};

export { deduplicateSourceRecords, matchReferenceName };
