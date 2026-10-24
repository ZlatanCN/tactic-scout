import type { PlayerSearchQuery } from "./contracts.js";
import { readFmProfiles } from "./football-manager.js";
import type { FmReadResult } from "./football-manager.js";
import { resolveSearchIdentityGroups } from "./reep-registry.js";
import { assertModelProcessingAllowed, normalizePlayerName } from "./shared.js";
import { readUnderstat } from "./understat.js";
import type { UnderstatReadResult } from "./understat.js";

type PlayerSearch = (input: PlayerSearchQuery) => Promise<string> | string;

type SearchPlayerRecordsResult = {
  fm?: FmReadResult;
  identityGroups: ReturnType<typeof resolveSearchIdentityGroups>;
  query: string;
  understat?: UnderstatReadResult;
};

const searchPlayerRecords: PlayerSearch = (input) => {
  const normalizedName = normalizePlayerName(input.playerName);

  if (normalizedName.length === 0) {
    return JSON.stringify({
      query: input.playerName,
      result: "empty_query",
    });
  }

  assertModelProcessingAllowed(input.source);
  let understatResult: UnderstatReadResult | null = null;
  let fmResult: FmReadResult | null = null;

  if (input.source === "understat" || input.source === "both") {
    understatResult = readUnderstat(input, normalizedName);
  }

  if (input.source === "fm" || input.source === "both") {
    fmResult = readFmProfiles(input, normalizedName);
  }

  const result: SearchPlayerRecordsResult = {
    identityGroups: resolveSearchIdentityGroups(understatResult, fmResult),
    query: input.playerName,
  };

  if (understatResult !== null) {
    result.understat = understatResult;
  }

  if (fmResult !== null) {
    result.fm = fmResult;
  }

  return JSON.stringify(result);
};

export { searchPlayerRecords };

export type { PlayerSearch };
