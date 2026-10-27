import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { inflateRawSync } from "node:zlib";

import { z } from "zod/v4";

import {
  evaluationCaseSchema,
  evaluationEvidenceBundleSchema,
} from "./contracts.js";
import type { EvaluationCase, EvaluationEvidenceBundle } from "./contracts.js";

const caseRoot = path.join(import.meta.dirname, "cases");
const versionedEvidenceRoot = path.join(import.meta.dirname, "evidence");

const fmProfileRowSchema = z.object({
  birth_date: z.string().nullable(),
  name: z.string(),
  payload: z.instanceof(Uint8Array),
  record_id: z.string(),
  unique_id: z.string(),
});

const fmManifestSchema = z.object({
  databaseVersion: z.string(),
  gameBuild: z.string(),
  inGameDate: z.string(),
  sha256: z.string(),
});

const apiFootballCaptureSchema = z.object({
  apiFootball: evaluationEvidenceBundleSchema.shape.apiFootball,
  requestCount: z.number().int().nonnegative(),
  requestedTeams: z.array(z.string()),
  status: z.enum(["completed", "partial"]),
});

const emptyApiFootballCapture = {
  capturedAt: null,
  requestedTeams: [],
  sourceRequests: null,
  squadResponses: [],
  teamSearchResponses: [],
} satisfies EvaluationEvidenceBundle["apiFootball"];

const understatSnapshotRowSchema = z.object({
  captured_at: z.string(),
  kind: z.enum(["league", "team"]),
  parser_version: z.string(),
  payload_json: z.string(),
  resource_id: z.string(),
  schema_version: z.number().int(),
  season_start_year: z.number().int(),
});

const identityBridgeSchema = z.object({
  canonical_reep_id: z.string().nullable(),
  external_id: z.string(),
  provider: z.enum(["api_football", "fm", "understat"]),
  redirect_status: z.string(),
});

const sourceRecordSchema = z.object({
  competition: z.string().nullable().optional(),
  provider: z.enum(["api_football", "fm", "understat"]),
  season: z.string().nullable().optional(),
  sourceId: z.string(),
});

type SourceRecord = z.output<typeof sourceRecordSchema>;

type ExtractedFmProfile = EvaluationEvidenceBundle["fm"]["players"][number] & {
  positions: EvaluationEvidenceBundle["fm"]["positions"][number][];
};

type RealSourcePaths = {
  fm: string;
  identity: string;
  understat: string;
};

const sourcePaths = (): RealSourcePaths => ({
  fm: path.resolve(
    process.cwd(),
    process.env.TACTISCOUT_FM_PROFILES_PATH ?? ".data/fm/profiles-v2.sqlite"
  ),
  identity: path.resolve(
    process.cwd(),
    process.env.TACTISCOUT_REEP_IDENTITY_DB_PATH ??
      ".data/reep/identity-with-fm.sqlite"
  ),
  understat: path.resolve(
    process.cwd(),
    process.env.TACTISCOUT_UNDERSTAT_DB_PATH ??
      ".data/understat/understat.sqlite"
  ),
});

const caseFiles = (selectedIds: string[]): EvaluationCase[] => {
  const ids = selectedIds.length > 0 ? selectedIds : [];

  if (ids.length === 0) {
    throw new Error("Provide one or more real case IDs with --case.");
  }

  return ids.map((caseId) => {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(caseId)) {
      throw new Error("Evaluation case IDs contain unsupported characters.");
    }

    const casePath = path.join(caseRoot, `${caseId}.json`);

    const parsedCase = evaluationCaseSchema.parse(
      JSON.parse(readFileSync(casePath, "utf-8"))
    );

    if (parsedCase.origin !== "real") {
      throw new Error(`${caseId} is not marked as real evidence.`);
    }

    return parsedCase;
  });
};

const sourceRecordsForCases = (cases: EvaluationCase[]): SourceRecord[] => {
  const records = new Map<string, SourceRecord>();

  for (const caseDefinition of cases) {
    const references = [
      ...caseDefinition.contract.sourceScope,
      ...caseDefinition.contract.resolvedPlayers.flatMap(
        ({ sourceRecords }) => sourceRecords
      ),
      ...caseDefinition.contract.toolActions.flatMap(
        ({ sourceRecords }) => sourceRecords
      ),
      ...caseDefinition.contract.requiredEvidence.map(
        ({ competition, provider, season, sourceId }) => ({
          competition: competition ?? null,
          provider,
          season: season ?? null,
          sourceId,
        })
      ),
    ];

    for (const record of references) {
      const parsed = sourceRecordSchema.parse(record);

      const key = [
        parsed.provider,
        parsed.sourceId,
        parsed.competition ?? "",
        parsed.season ?? "",
      ].join("|");

      records.set(key, parsed);
    }
  }

  return [...records.values()].toSorted(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.sourceId.localeCompare(right.sourceId) ||
      (left.season ?? "").localeCompare(right.season ?? "")
  );
};

const startYearFromSeason = (
  season: string | null | undefined
): number | null => {
  const parsedSeason = z.string().safeParse(season);

  if (!parsedSeason.success) {
    return null;
  }

  const match = /^(?<year>20\d{2})\/(?:\d{2}|20\d{2})$/u.exec(
    parsedSeason.data
  );

  const parsedYear = z
    .string()
    .regex(/^20\d{2}$/u)
    .safeParse(match?.groups?.year);

  return parsedYear.success ? Number(parsedYear.data) : null;
};

const fmManifest = (database: DatabaseSync) => {
  const { payload } = z
    .object({ payload: z.string() })
    .parse(database.prepare("SELECT payload FROM manifest WHERE id = 1").get());

  return fmManifestSchema.parse(JSON.parse(payload));
};

const fmPlayersFromSource = (
  database: DatabaseSync,
  selectedIds: string[]
): ExtractedFmProfile[] => {
  const playerQuery = database.prepare(
    "SELECT birth_date, name, payload, record_id, unique_id FROM players WHERE unique_id = ? OR record_id = ? ORDER BY record_id"
  );

  const aliasQuery = database.prepare(
    "SELECT name FROM aliases WHERE record_id = ? ORDER BY name"
  );

  const positionsQuery = database.prepare(
    "SELECT position, rating FROM positions WHERE record_id = ? ORDER BY position"
  );

  const selectedRows = new Map<string, z.output<typeof fmProfileRowSchema>>();

  for (const sourceId of new Set(selectedIds)) {
    for (const row of z
      .array(fmProfileRowSchema)
      .parse(playerQuery.all(sourceId, sourceId))) {
      selectedRows.set(row.record_id, row);
    }
  }

  return [...selectedRows.values()].map((row) => {
    const payloadText = inflateRawSync(row.payload).toString("utf-8");

    const payload = z
      .record(z.string(), z.json())
      .parse(JSON.parse(payloadText));

    const aliases = z
      .array(z.object({ name: z.string() }))
      .parse(aliasQuery.all(row.record_id))
      .map(({ name }) => name);

    const positions = z
      .array(z.object({ position: z.string(), rating: z.number().int() }))
      .parse(positionsQuery.all(row.record_id))
      .map(({ position, rating }) => ({
        position,
        rating,
        recordId: row.record_id,
      }));

    return {
      aliases,
      birthDate: row.birth_date,
      name: row.name,
      payload,
      positions,
      recordId: row.record_id,
      uniqueId: row.unique_id,
    };
  });
};

const understatSnapshotsFromSource = (
  database: DatabaseSync,
  sourceRecords: SourceRecord[]
): EvaluationEvidenceBundle["understat"]["snapshots"] => {
  const selectedUnderstat = sourceRecords.filter(
    ({ provider }) => provider === "understat"
  );

  const selectedIds = new Set(
    selectedUnderstat.map(({ sourceId }) => sourceId)
  );

  const selectedScopes = selectedUnderstat.flatMap((record) => {
    const seasonStartYear = startYearFromSeason(record.season);

    return record.competition === null || seasonStartYear === null
      ? []
      : [`${record.competition}|${seasonStartYear}`];
  });

  const selectedScopeSet = new Set(selectedScopes);

  if (selectedIds.size === 0) {
    return [];
  }

  const rows = z
    .array(understatSnapshotRowSchema)
    .parse(
      database
        .prepare(
          "SELECT retrieved_at AS captured_at, kind, parser_version, payload_json, resource_id, schema_version, season_start_year FROM source_snapshots WHERE kind = 'league' ORDER BY season_start_year, resource_id"
        )
        .all()
    );

  return rows.flatMap((row) => {
    const scope = `${row.resource_id}|${row.season_start_year}`;

    if (selectedScopeSet.size > 0 && !selectedScopeSet.has(scope)) {
      return [];
    }

    const payload = z
      .object({ players: z.array(z.json()).optional() })
      .parse(JSON.parse(row.payload_json));

    const players = (payload.players ?? []).filter((candidate) => {
      const object = z.record(z.string(), z.json()).safeParse(candidate);

      const playerId = object.success
        ? z.union([z.string(), z.number()]).safeParse(object.data.id)
        : { success: false as const };

      return playerId.success && selectedIds.has(String(playerId.data));
    });

    return players.length === 0
      ? []
      : [
          {
            capturedAt: row.captured_at,
            kind: row.kind,
            parserVersion: row.parser_version,
            players,
            resourceId: row.resource_id,
            schemaVersion: row.schema_version,
            seasonStartYear: row.season_start_year,
          },
        ];
  });
};

const identityFromSource = (
  database: DatabaseSync,
  sourceRecords: SourceRecord[]
): EvaluationEvidenceBundle["identity"] => {
  const metadata = z
    .object({ value: z.string() })
    .parse(
      database
        .prepare("SELECT value FROM metadata WHERE key = 'release_stamp'")
        .get()
    );

  const query = database.prepare(
    "SELECT canonical_reep_id, external_id, provider, redirect_status FROM bridges WHERE namespace = 'player' AND provider = ? AND external_id = ? ORDER BY rung"
  );

  const bridgesByKey = new Map<
    string,
    EvaluationEvidenceBundle["identity"]["bridges"][number]
  >();

  for (const { provider, sourceId } of sourceRecords) {
    const rows = z
      .array(identityBridgeSchema)
      .parse(query.all(provider, sourceId));

    for (const row of rows) {
      const bridge = {
        canonicalReepId: row.canonical_reep_id,
        externalId: row.external_id,
        provider,
        redirectStatus: row.redirect_status,
      };

      bridgesByKey.set(JSON.stringify(bridge), bridge);
    }
  }

  return { bridges: [...bridgesByKey.values()], releaseStamp: metadata.value };
};

const createRealEvidenceBundle = (
  bundleId: string,
  sourceRecords: SourceRecord[],
  paths: RealSourcePaths,
  apiFootball: EvaluationEvidenceBundle["apiFootball"]
): EvaluationEvidenceBundle => {
  const fm = new DatabaseSync(paths.fm, { readOnly: true });
  const understat = new DatabaseSync(paths.understat, { readOnly: true });
  const identity = new DatabaseSync(paths.identity, { readOnly: true });

  try {
    const manifest = fmManifest(fm);

    const players = fmPlayersFromSource(
      fm,
      sourceRecords.flatMap(({ provider, sourceId }) =>
        provider === "fm" ? [sourceId] : []
      )
    );

    const identitySourceRecords = [
      ...sourceRecords,
      ...players.flatMap(({ uniqueId }) =>
        uniqueId === null
          ? []
          : [
              {
                provider: "fm" as const,
                sourceId: uniqueId,
              },
            ]
      ),
    ];

    const positions = players.flatMap(
      ({ positions: playerPositions }) => playerPositions
    );

    const bundle: EvaluationEvidenceBundle = {
      apiFootball: {
        ...apiFootball,
      },
      bundleId,
      fm: {
        manifest,
        players: players.map(({ positions: _positions, ...player }) => player),
        positions,
      },
      identity: identityFromSource(identity, identitySourceRecords),
      origin: "real",
      understat: {
        snapshots: understatSnapshotsFromSource(understat, sourceRecords),
      },
    };

    return evaluationEvidenceBundleSchema.parse(bundle);
  } finally {
    fm.close();
    understat.close();
    identity.close();
  }
};

const hashFile = (filePath: string): string =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const copyVersionedSyntheticEvidence = (outputDirectory: string): void => {
  for (const fileName of readdirSync(versionedEvidenceRoot)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }

    const sourcePath = path.join(versionedEvidenceRoot, fileName);

    const bundle = evaluationEvidenceBundleSchema.parse(
      JSON.parse(readFileSync(sourcePath, "utf-8"))
    );

    if (bundle.origin === "synthetic") {
      writeFileSync(
        path.join(outputDirectory, fileName),
        readFileSync(sourcePath),
        {
          mode: 0o600,
        }
      );
    }
  }
};

const apiFootballSnapshotFromPath = (
  filePath: string | undefined
): EvaluationEvidenceBundle["apiFootball"] => {
  if (filePath === undefined) {
    return emptyApiFootballCapture;
  }

  const capture = apiFootballCaptureSchema.parse(
    JSON.parse(readFileSync(filePath, "utf-8"))
  );

  if (capture.status !== "completed") {
    throw new Error("The API-Football source capture is incomplete.");
  }

  return {
    ...capture.apiFootball,
    requestedTeams: capture.requestedTeams,
    sourceRequests: capture.requestCount,
  };
};

const writeRealEvidenceBundles = (
  selectedIds: string[],
  outputDirectory: string,
  apiFootballCapture: EvaluationEvidenceBundle["apiFootball"] = emptyApiFootballCapture
): { bundleId: string; sha256: string; sourceRecordCount: number }[] => {
  const cases = caseFiles(selectedIds);
  const byBundle = new Map<string, EvaluationCase[]>();

  for (const caseDefinition of cases) {
    const bundleCases = byBundle.get(caseDefinition.evidenceBundleId) ?? [];
    bundleCases.push(caseDefinition);
    byBundle.set(caseDefinition.evidenceBundleId, bundleCases);
  }

  const paths = sourcePaths();
  mkdirSync(outputDirectory, { recursive: true });
  copyVersionedSyntheticEvidence(outputDirectory);

  return [...byBundle.entries()].map(([bundleId, bundleCases]) => {
    const sourceRecords = sourceRecordsForCases(bundleCases);

    const bundle = createRealEvidenceBundle(
      bundleId,
      sourceRecords,
      paths,
      apiFootballCapture
    );

    const outputPath = path.join(outputDirectory, `${bundleId}.json`);
    const temporaryPath = `${outputPath}.tmp`;

    writeFileSync(temporaryPath, `${JSON.stringify(bundle, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporaryPath, outputPath);

    return {
      bundleId,
      sha256: hashFile(outputPath),
      sourceRecordCount: sourceRecords.length,
    };
  });
};

const runCli = (): void => {
  const { values } = parseArgs({
    options: {
      "api-football-snapshot": { type: "string" },
      case: { multiple: true, type: "string" },
      output: { type: "string" },
    },
    strict: true,
  });

  const outputDirectory = path.resolve(
    process.cwd(),
    values.output ?? ".data/evals/evidence"
  );

  const apiFootballCapture = apiFootballSnapshotFromPath(
    values["api-football-snapshot"]
  );

  const bundles = writeRealEvidenceBundles(
    values.case ?? [],
    outputDirectory,
    apiFootballCapture
  );

  process.stdout.write(
    `${JSON.stringify({ bundles, outputDirectory }, null, 2)}\n`
  );
};

const runCliWithErrors = (): void => {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Could not prepare local evidence."}\n`
    );
    process.exitCode = 1;
  }
};

if (process.argv[1]?.endsWith("prepare-local-evidence.ts")) {
  runCliWithErrors();
}

export { writeRealEvidenceBundles };
