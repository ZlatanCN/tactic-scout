import { createHash } from "node:crypto";

import { z } from "zod/v4";

import { searchPlayerRecordsResultSchema } from "./player-data/search-records.js";
import type { SearchPlayerRecordsData } from "./player-data/search-records.js";

const jsonValueSchema = z.json();

type JsonValue = z.output<typeof jsonValueSchema>;

const understatFieldNames = [
  "appearances",
  "assists",
  "expectedAssists",
  "expectedGoals",
  "goals",
  "keyPasses",
  "minutes",
  "nonPenaltyExpectedGoals",
  "shots",
] as const;

const fmFieldNames = [
  "attributes",
  "birthDate",
  "currentAbility",
  "heightCm",
  "naturalPositions",
  "potentialAbility",
] as const;

const lookupProviderDetails = {
  fm: {
    fieldNames: fmFieldNames,
    metadataFields: [
      "identitySourceId",
      "naturalPositions",
      "player",
      "source",
      "sourceRecordId",
    ],
    sourceIdField: "identitySourceId",
  },
  understat: {
    fieldNames: understatFieldNames,
    metadataFields: [
      "competition",
      "player",
      "position",
      "season",
      "source",
      "sourcePlayerId",
      "team",
    ],
    sourceIdField: "sourcePlayerId",
  },
} as const;

const lookupProviders = ["fm", "understat"] as const;

type LookupProvider = (typeof lookupProviders)[number];

const lookupEvidenceRecordsPerBatch = 2;

const lookupFieldSelectors = [
  {
    expression: /\b(?:xa|expected\s+assists?)\b|预期助攻/iu,
    field: "expectedAssists",
    provider: "understat",
  },
  {
    expression: /\b(?:npxg|non[- ]?penalty\s+xg)\b/iu,
    field: "nonPenaltyExpectedGoals",
    provider: "understat",
  },
  {
    expression: /\b(?:xg|expected\s+goals?)\b|预期进球/iu,
    field: "expectedGoals",
    provider: "understat",
  },
  {
    expression: /\b(?:appearances?|games?)\b|出场/iu,
    field: "appearances",
    provider: "understat",
  },
  {
    expression: /\b(?:assists?)\b|(?<!预期)助攻/iu,
    field: "assists",
    provider: "understat",
  },
  {
    expression: /\b(?:goals?)\b|(?<!预期)进球/iu,
    field: "goals",
    provider: "understat",
  },
  {
    expression: /\b(?:key\s+passes?)\b|关键传球/iu,
    field: "keyPasses",
    provider: "understat",
  },
  {
    expression: /\bminutes?\b|分钟/iu,
    field: "minutes",
    provider: "understat",
  },
  {
    expression: /\bshots?\b|射门/iu,
    field: "shots",
    provider: "understat",
  },
  {
    expression: /\b(?:ca|current\s+ability)\b/iu,
    field: "currentAbility",
    provider: "fm",
  },
  {
    expression: /\b(?:pa|potential\s+ability)\b/iu,
    field: "potentialAbility",
    provider: "fm",
  },
  {
    expression: /\bheight\b|身高/iu,
    field: "heightCm",
    provider: "fm",
  },
  {
    expression: /\bbirth\s+date\b|出生日期/iu,
    field: "birthDate",
    provider: "fm",
  },
  {
    expression: /\bnatural\s+positions?\b|自然位置/iu,
    field: "naturalPositions",
    provider: "fm",
  },
] as const;

type UnderstatSeasonMode =
  | "default_snapshot"
  | "explicit"
  | "explicit_unresolved"
  | "not_queried";

const explicitSeasonMentionPatterns = [
  /\b\d{2}\s*[-\u2010-\u2015/]\s*\d{2}\b/iu,
  /\b20\d{2}\s*[-\u2010-\u2015/]\s*(?:\d{2}|20\d{2})\b/iu,
  /\b(?:19|20)\d{2}\s+season\b/iu,
  /\bseason\s+(?:19|20)\d{2}\b/iu,
  /(?:19|20)\d{2}(?:年|赛季)/u,
  /\b(?:last|previous|current|this)\s+season\b/iu,
  /上赛季|本赛季|这个赛季/u,
];

const explicitSeasonWasMentioned = (question: string): boolean => {
  if (explicitSeasonMentionPatterns.some((pattern) => pattern.test(question))) {
    return true;
  }

  const asksForUnderstatEvidence = lookupFieldSelectors.some(
    (selector) =>
      selector.provider === "understat" && selector.expression.test(question)
  );

  return asksForUnderstatEvidence && /\b(?:19|20)\d{2}\b/u.test(question);
};

const allFieldsFor = (provider: LookupProvider): string[] => [
  ...lookupProviderDetails[provider].fieldNames,
];

const selectedFieldsFor = (
  query: string,
  provider: LookupProvider,
  explicitlySelectedProviders: Set<"fm" | "understat">,
  hasSpecificField: boolean,
  providerQueried: boolean
): string[] => {
  const selectedFields = lookupFieldSelectors.flatMap((selector) =>
    selector.provider === provider && selector.expression.test(query)
      ? [selector.field]
      : []
  );

  if (selectedFields.length > 0) {
    return selectedFields;
  }

  const explicitlySelected = explicitlySelectedProviders.has(provider);

  if (hasSpecificField) {
    return [];
  }

  return explicitlySelected ||
    (explicitlySelectedProviders.size === 0 && providerQueried)
    ? allFieldsFor(provider)
    : [];
};

const fieldValue = (
  value: Record<string, JsonValue>,
  field: string
): { state: "source_null" } | { state: "value"; value: JsonValue } => {
  const selected = value[field];

  return selected === null
    ? { state: "source_null" }
    : { state: "value", value: selected };
};

const recordsFromProvider = (
  provider: LookupProvider,
  result: SearchPlayerRecordsData,
  fields: string[]
) => {
  const source = result[provider];

  if (source === undefined) {
    return [];
  }

  if (source.status !== "found") {
    return [];
  }

  return source.records.map((record, index) => {
    const recordData = z.record(z.string(), jsonValueSchema).parse(record);

    const providerDetails = lookupProviderDetails[provider];

    const sourceId = z
      .string()
      .parse(recordData[providerDetails.sourceIdField]);

    const metadata = Object.fromEntries(
      providerDetails.metadataFields.map((field) => [field, recordData[field]])
    );

    const selectedFieldSet = new Set(fields);

    return {
      fieldStates: Object.fromEntries(
        fields.map((field) => [field, fieldValue(recordData, field)])
      ),
      provider,
      recordRef: `${provider}.records[${index}]`,
      selectedFields: fields,
      sourceId,
      unselectedFields: allFieldsFor(provider).filter(
        (field) => !selectedFieldSet.has(field)
      ),
      ...metadata,
    };
  });
};

const understatSeasonModeFor = (
  result: SearchPlayerRecordsData,
  question: string
): UnderstatSeasonMode => {
  if (result.understat === undefined) {
    return "not_queried";
  }

  if (result.requestedUnderstatSeasonStartYear !== null) {
    return "explicit";
  }

  return explicitSeasonWasMentioned(question)
    ? "explicit_unresolved"
    : "default_snapshot";
};

const scoutingEvidenceProjections = (
  resultJson: string,
  question: string,
  source: "executed" | "saved"
): string[] | null => {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(resultJson);
  } catch {
    return null;
  }

  const parsed = searchPlayerRecordsResultSchema.safeParse(parsedJson);

  if (!parsed.success || "result" in parsed.data) {
    return null;
  }

  const result = parsed.data;
  const explicitlySelectedProviders = new Set<"fm" | "understat">();

  if (
    /\b(?:understat|premier\s+league|la\s+liga|performance|statistics?)\b|表现|统计/iu.test(
      question
    )
  ) {
    explicitlySelectedProviders.add("understat");
  }

  if (/\b(?:football\s+manager|\bfm\b)\b/iu.test(question)) {
    explicitlySelectedProviders.add("fm");
  }

  const hasSpecificField =
    lookupFieldSelectors.some(({ expression }) => expression.test(question)) ||
    /\b(?:season|league)\b|赛季|联赛/iu.test(question);

  if (/\b(?:season|league)\b|赛季|联赛/iu.test(question)) {
    explicitlySelectedProviders.add("understat");
  }

  const fmQueried = result.query.some(({ provider }) => provider === "fm");

  const understatQueried = result.query.some(
    ({ provider }) => provider === "understat"
  );

  const queried = {
    fm: fmQueried,
    understat: understatQueried,
  };

  const selected = {
    fm: selectedFieldsFor(
      question,
      "fm",
      explicitlySelectedProviders,
      hasSpecificField,
      queried.fm
    ),
    understat: selectedFieldsFor(
      question,
      "understat",
      explicitlySelectedProviders,
      hasSpecificField,
      queried.understat
    ),
  };

  const projectedRecords = lookupProviders.flatMap((provider) => {
    const fields = selected[provider];

    const sourceWasSelected =
      fields.length > 0 || explicitlySelectedProviders.has(provider);

    return sourceWasSelected
      ? recordsFromProvider(provider, result, fields)
      : [];
  });

  const batches =
    projectedRecords.length === 0
      ? [[]]
      : Array.from(
          {
            length: Math.ceil(
              projectedRecords.length / lookupEvidenceRecordsPerBatch
            ),
          },
          (_, index) =>
            projectedRecords.slice(
              index * lookupEvidenceRecordsPerBatch,
              (index + 1) * lookupEvidenceRecordsPerBatch
            )
        );

  const recordRefs = projectedRecords.map(({ recordRef }) => recordRef);
  const resultDigest = createHash("sha256").update(resultJson).digest("hex");

  const understatSeasonMode = understatSeasonModeFor(result, question);

  const fmSelectedFieldSet = new Set(selected.fm);
  const understatSelectedFieldSet = new Set(selected.understat);

  return batches.map((recordBatch, index) => {
    const batchRecordRefs = recordBatch.map(({ recordRef }) => recordRef);
    const completedRecordCount = index * lookupEvidenceRecordsPerBatch;
    const remainingRecordStart = (index + 1) * lookupEvidenceRecordsPerBatch;

    const projection = {
      batch: {
        completedRecordRefs: recordRefs.slice(0, completedRecordCount),
        index,
        recordRefs: batchRecordRefs,
        remainingRecordRefs: recordRefs.slice(remainingRecordStart),
        total: batches.length,
      },
      coverage: {
        fields: {
          fm: {
            selected: selected.fm,
            unselected: allFieldsFor("fm").filter(
              (field) => !fmSelectedFieldSet.has(field)
            ),
          },
          understat: {
            selected: selected.understat,
            unselected: allFieldsFor("understat").filter(
              (field) => !understatSelectedFieldSet.has(field)
            ),
          },
        },
        providers: {
          fm: {
            queried: result.query.some(({ provider }) => provider === "fm"),
            reason:
              result.fm?.status === "unavailable" ? result.fm.reason : null,
            status: result.fm?.status ?? "not_queried",
          },
          understat: {
            queried: result.query.some(
              ({ provider }) => provider === "understat"
            ),
            reason:
              result.understat?.status === "unavailable"
                ? result.understat.reason
                : null,
            seasonMode: understatSeasonMode,
            status: result.understat?.status ?? "not_queried",
          },
        },
        records: batchRecordRefs,
      },
      digest: resultDigest,
      identityGroups: result.identityGroups,
      query: result.query,
      records: recordBatch,
      requestedUnderstatSeasonStartYear:
        result.requestedUnderstatSeasonStartYear ?? null,
      source,
      version: 1,
    };

    return JSON.stringify(projection);
  });
};

export { scoutingEvidenceProjections };
