import type { PlayerSearchQuery } from "./contracts.js";
import { readFmProfilesBySourceIds } from "./football-manager.js";
import type { FmReadResult } from "./football-manager.js";
import { resolveSearchIdentityGroups } from "./reep-registry.js";
import { assertModelProcessingAllowed } from "./shared.js";
import { readUnderstatBySourceIds } from "./understat.js";
import type { UnderstatReadResult } from "./understat.js";

type PlayerSearch = (input: PlayerSearchQuery) => Promise<string> | string;

type SearchPlayerRecordsResult = {
  fm?: FmReadResult;
  identityGroups: ReturnType<typeof resolveSearchIdentityGroups>;
  query: PlayerSearchQuery["sourceRecords"];
  requestedUnderstatSeasonStartYear?: number | null;
  understat?: UnderstatReadResult;
};

const searchPlayerRecords: PlayerSearch = (input) => {
  const sourceRecords = input.sourceRecords.filter(
    ({ sourceId }) => sourceId.trim().length > 0
  );

  if (sourceRecords.length === 0) {
    return JSON.stringify({
      query: [],
      result: "no_confirmed_source_ids",
    });
  }

  const providers = new Set(sourceRecords.map(({ provider }) => provider));

  for (const provider of providers) {
    assertModelProcessingAllowed(provider);
  }

  let understatResult: UnderstatReadResult | null = null;
  let fmResult: FmReadResult | null = null;

  if (providers.has("understat")) {
    understatResult = readUnderstatBySourceIds(
      sourceRecords.flatMap((record) =>
        record.provider === "understat" ? [record.sourceId] : []
      ),
      input.seasonStartYear
    );
  }

  if (providers.has("fm")) {
    fmResult = readFmProfilesBySourceIds(
      sourceRecords.flatMap((record) =>
        record.provider === "fm" ? [record.sourceId] : []
      )
    );
  }

  const result: SearchPlayerRecordsResult = {
    identityGroups: resolveSearchIdentityGroups(understatResult, fmResult),
    query: sourceRecords,
  };

  if (understatResult !== null) {
    result.requestedUnderstatSeasonStartYear = input.seasonStartYear ?? null;
    result.understat = understatResult;
  }

  if (fmResult !== null) {
    result.fm = fmResult;
  }

  return JSON.stringify(result);
};

export { searchPlayerRecords };

export type { PlayerSearch };
