import { z } from "zod/v4";

import type { PlayerSearchQuery } from "./contracts.js";
import {
  readFmProfilesBySourceIds,
  fmReadResultSchema,
} from "./football-manager.js";
import type { FmReadResult } from "./football-manager.js";
import { resolveSearchIdentityGroups } from "./reep-registry.js";
import { assertModelProcessingAllowed } from "./shared.js";
import {
  readUnderstatBySourceIds,
  understatReadResultSchema,
} from "./understat.js";
import type { UnderstatReadResult } from "./understat.js";

const searchIdentityRecordSchema = z.object({
  identitySourceId: z.string(),
  name: z.string(),
  provider: z.enum(["understat", "fm"]),
  recordId: z.string(),
});

const searchIdentityGroupsSchema = z.object({
  canonicalGroups: z.array(
    z.object({
      canonicalIdentityId: z.string(),
      name: z.string(),
      records: z.array(searchIdentityRecordSchema),
    })
  ),
  registryStatus: z.enum(["not_needed", "available", "unavailable"]),
  unlinkedRecords: z.array(
    searchIdentityRecordSchema.extend({ reason: z.string() })
  ),
});

const searchQueryRecordSchema = z.object({
  provider: z.enum(["understat", "fm"]),
  sourceId: z.string(),
});

const searchPlayerRecordsDataSchema = z
  .object({
    fm: fmReadResultSchema.optional(),
    identityGroups: searchIdentityGroupsSchema,
    query: z.array(searchQueryRecordSchema),
    requestedUnderstatSeasonStartYear: z.number().int().nullable().optional(),
    understat: understatReadResultSchema.optional(),
  })
  .superRefine((result, context) => {
    const requestedProviders = new Set(
      result.query.map(({ provider }) => provider)
    );

    const requestedFm = requestedProviders.has("fm");
    const requestedUnderstat = requestedProviders.has("understat");

    const hasUnderstatSeason =
      result.requestedUnderstatSeasonStartYear !== undefined;

    if (result.query.length === 0) {
      context.addIssue({
        code: "custom",
        message:
          "A source result must include at least one queried source record.",
        path: ["query"],
      });
    }

    if (requestedFm !== (result.fm !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "FM query records and FM results must be present together.",
        path: ["fm"],
      });
    }

    if (requestedUnderstat !== (result.understat !== undefined)) {
      context.addIssue({
        code: "custom",
        message:
          "Understat query records and Understat results must be present together.",
        path: ["understat"],
      });
    }

    if (requestedUnderstat !== hasUnderstatSeason) {
      context.addIssue({
        code: "custom",
        message:
          "Understat queries must include their requested season metadata.",
        path: ["requestedUnderstatSeasonStartYear"],
      });
    }
  });

const searchPlayerRecordsResultSchema = z.union([
  searchPlayerRecordsDataSchema,
  z.object({
    query: z.array(searchQueryRecordSchema).length(0),
    result: z.literal("no_confirmed_source_ids"),
  }),
]);

type SearchPlayerRecordsResult = z.output<
  typeof searchPlayerRecordsResultSchema
>;

type SearchPlayerRecordsData = z.output<typeof searchPlayerRecordsDataSchema>;

type PlayerSearch = (input: PlayerSearchQuery) => Promise<string> | string;

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

  const result: SearchPlayerRecordsData = {
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

export { searchPlayerRecordsResultSchema };

export type {
  PlayerSearch,
  SearchPlayerRecordsData,
  SearchPlayerRecordsResult,
};
