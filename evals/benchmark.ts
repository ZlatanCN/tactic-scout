import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { z } from "zod/v4";

import { assertModelProcessingAllowed } from "../src/player-data/shared.js";
import {
  evaluationCaseSchema,
  evaluationEvidenceBundleSchema,
} from "./contracts.js";
import type {
  EvaluationCase,
  EvaluationEvidenceBundle,
  JsonValue,
} from "./contracts.js";
import { prepareEvidenceBundle } from "./evidence.js";
import {
  captureFreezeConfiguration,
  captureRunIdentity,
  freezeFingerprintForEvaluation,
} from "./run-identity.js";

type EvaluationMode = "development" | "held_out" | "smoke";

type PreviewEvaluationOptions = {
  caseDirectory?: string;
  caseIds: string[];
  evidenceDirectory?: string;
  freezeId?: string;
  includeSemanticJudge?: boolean;
  mode: EvaluationMode;
};

type EvaluationPreview = {
  caseCount: number;
  cases: {
    caseId: string;
    category: EvaluationCase["category"];
    evidenceBundleId: string;
    evidenceBundleSha256: string;
    evidenceStatus: "ready" | "missing_or_invalid" | "requires_preparation";
    origin: EvaluationCase["origin"];
    split: EvaluationCase["split"];
    workflow: EvaluationCase["workflow"];
  }[];
  estimatedModelRequests: number;
  freezeId: string | null;
  freezeFingerprint: string | null;
  heldOutFreezeReady: boolean;
  judgeEnabled: boolean;
  modelConfigurationReady: boolean;
  mode: EvaluationMode;
  repetitions: number;
  sourceProcessingAllowed: boolean;
  trials: number;
  workflows: {
    caseCount: number;
    workflow: EvaluationCase["workflow"];
  }[];
};

type EvaluationInventory = {
  caseCount: number;
  evidence: {
    invalid: string[];
    preparationRequired: string[];
    ready: string[];
  };
  errors: string[];
  originCounts: { mixed: number; real: number; synthetic: number };
  splitCounts: { development: number; held_out: number };
  status: "invalid" | "needs_preparation" | "ready";
  workflowCounts: {
    boundary: number;
    development: number;
    held_out: number;
    multi_turn: number;
    ordinary: number;
    real: number;
    synthetic: number;
    total: number;
    workflow: EvaluationCase["workflow"];
  }[];
};

type LoadedEvaluationCase = {
  caseDefinition: EvaluationCase;
  caseHash: string;
};

type EvaluationSourceMetadata = {
  apiFootball: {
    capturedAt: string | null;
    requestedTeams: string[];
    sourceRequests: number | null;
    teamIds: number[];
  } | null;
  fm: {
    databaseVersion: string;
    gameBuild: string;
    inGameDate: string;
    manifestSha256: string;
  };
  identityReleaseStamp: string;
  understat: Pick<
    EvaluationEvidenceBundle["understat"]["snapshots"][number],
    | "capturedAt"
    | "kind"
    | "parserVersion"
    | "resourceId"
    | "schemaVersion"
    | "seasonStartYear"
  >[];
};

type PreparedEvaluationCase = LoadedEvaluationCase & {
  apiFootball: EvaluationEvidenceBundle["apiFootball"];
  bundleHash: string;
  databasePaths: {
    fm: string;
    identity: string;
    understat: string;
  } | null;
  evidenceSourceMetadata: EvaluationSourceMetadata | null;
  preflightError: string | null;
};

const evaluationRoot = import.meta.dirname;
const casesRoot = path.join(evaluationRoot, "cases");
const evidenceRoot = path.join(evaluationRoot, "evidence");

const readJson = <Schema extends z.ZodType>(
  filePath: string,
  schema: Schema
): z.output<Schema> => {
  let contents: unknown;

  try {
    contents = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    throw new Error("An evaluation case or evidence bundle is invalid JSON.");
  }

  const parsed = schema.safeParse(contents);

  if (!parsed.success) {
    throw new Error(
      "An evaluation case or evidence bundle does not match its schema."
    );
  }

  return parsed.data;
};

const sha256File = (filePath: string): string =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const caseFilePath = (caseId: string, caseDirectory = casesRoot): string => {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(caseId)) {
    throw new Error(
      "Evaluation case IDs may contain only lowercase letters, numbers, and hyphens."
    );
  }

  return path.join(caseDirectory, `${caseId}.json`);
};

const caseIdsForMode = (
  mode: EvaluationMode,
  caseIds: string[],
  caseDirectory = casesRoot
): string[] => {
  if (caseIds.length > 0) {
    const uniqueIds = [...new Set(caseIds)];

    if (uniqueIds.length !== caseIds.length) {
      throw new Error("An evaluation case was selected more than once.");
    }

    return uniqueIds;
  }

  if (mode === "smoke") {
    throw new Error("Smoke mode requires one or more explicit case IDs.");
  }

  return readdirSync(caseDirectory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isFile() && entry.name.endsWith(".json")
        ? [entry.name.slice(0, -5)]
        : []
    )
    .toSorted();
};

const loadEvaluationCases = (
  mode: EvaluationMode,
  requestedCaseIds: string[],
  caseDirectory = casesRoot
): LoadedEvaluationCase[] => {
  const selectedIds = caseIdsForMode(mode, requestedCaseIds, caseDirectory);

  if (selectedIds.length === 0) {
    throw new Error("No evaluation cases match the requested split.");
  }

  const loadedCases = selectedIds.flatMap((caseId) => {
    const filePath = caseFilePath(caseId, caseDirectory);
    const caseDefinition = readJson(filePath, evaluationCaseSchema);

    if (caseDefinition.caseId !== caseId) {
      throw new Error("The evaluation case ID does not match its file name.");
    }

    if (
      caseDefinition.declaredTurnFaults.length > 0 &&
      caseDefinition.origin !== "synthetic"
    ) {
      throw new Error(
        "Declared turn-time source faults require synthetic evidence."
      );
    }

    if (
      caseDefinition.declaredTurnFaults.some(
        ({ turnId }) =>
          !caseDefinition.turns.some((turn) => turn.turnId === turnId)
      )
    ) {
      throw new Error(
        "A declared turn-time source fault has no matching user turn."
      );
    }

    if (mode !== "smoke" && caseDefinition.split !== mode) {
      if (requestedCaseIds.length === 0) {
        return [];
      }

      throw new Error(
        "A selected case is outside the requested evaluation split."
      );
    }

    return [
      {
        caseDefinition,
        caseHash: createHash("sha256")
          .update(readFileSync(filePath))
          .digest("hex"),
      },
    ];
  });

  if (loadedCases.length === 0) {
    throw new Error("No evaluation cases match the requested split.");
  }

  return loadedCases;
};

const evidenceStatusForCase = (
  caseDefinition: EvaluationCase,
  evidenceDirectory: string
): "invalid" | "preparation_required" | "ready" => {
  const evidencePath = path.join(
    evidenceDirectory,
    `${caseDefinition.evidenceBundleId}.json`
  );

  if (!existsSync(evidencePath)) {
    return caseDefinition.origin === "real"
      ? "preparation_required"
      : "invalid";
  }

  try {
    const bundle = readJson(evidencePath, evaluationEvidenceBundleSchema);

    return bundle.bundleId === caseDefinition.evidenceBundleId &&
      bundle.origin === caseDefinition.origin &&
      sha256File(evidencePath) === caseDefinition.evidenceBundleSha256
      ? "ready"
      : "invalid";
  } catch {
    return "invalid";
  }
};

const categoryCount = (
  cases: LoadedEvaluationCase[],
  category: EvaluationCase["category"]
): number =>
  cases.filter(({ caseDefinition }) => caseDefinition.category === category)
    .length;

const workflowInventory = (
  workflow: EvaluationCase["workflow"],
  allCases: LoadedEvaluationCase[]
) => {
  const workflowCases = allCases.filter(
    ({ caseDefinition }) => caseDefinition.workflow === workflow
  );

  const devCases = workflowCases.filter(
    ({ caseDefinition }) => caseDefinition.split === "development"
  );

  const heldCases = workflowCases.filter(
    ({ caseDefinition }) => caseDefinition.split === "held_out"
  );

  const real = workflowCases.filter(
    ({ caseDefinition }) => caseDefinition.origin === "real"
  ).length;

  const synthetic = workflowCases.filter(
    ({ caseDefinition }) => caseDefinition.origin === "synthetic"
  ).length;

  const errors: string[] = [];

  if (workflowCases.length !== 12) {
    errors.push(`${workflow}:expected_12_cases_found_${workflowCases.length}`);
  }

  if (
    devCases.length !== 8 ||
    categoryCount(devCases, "ordinary") !== 3 ||
    categoryCount(devCases, "boundary") !== 3 ||
    categoryCount(devCases, "multi_turn") !== 2
  ) {
    errors.push(`${workflow}:development_split_mismatch`);
  }

  if (
    heldCases.length !== 4 ||
    categoryCount(heldCases, "ordinary") !== 1 ||
    categoryCount(heldCases, "boundary") !== 1 ||
    categoryCount(heldCases, "multi_turn") !== 2
  ) {
    errors.push(`${workflow}:held_out_split_mismatch`);
  }

  return {
    errors,
    summary: {
      boundary: categoryCount(workflowCases, "boundary"),
      development: devCases.length,
      held_out: heldCases.length,
      multi_turn: categoryCount(workflowCases, "multi_turn"),
      ordinary: categoryCount(workflowCases, "ordinary"),
      real,
      synthetic,
      total: workflowCases.length,
      workflow,
    },
  };
};

const validateBenchmarkDataset = (
  options: {
    caseDirectory?: string;
    evidenceDirectory?: string;
  } = {}
): EvaluationInventory => {
  const caseDirectory = options.caseDirectory ?? casesRoot;
  const evidenceDirectory = options.evidenceDirectory ?? evidenceRoot;
  const development = loadEvaluationCases("development", [], caseDirectory);
  const heldOut = loadEvaluationCases("held_out", [], caseDirectory);
  const allCases = [...development, ...heldOut];

  const workflows: EvaluationCase["workflow"][] = [
    "player_lookup",
    "player_comparison",
    "player_recommendation",
    "team_recommendation",
  ];

  const errors: string[] = [];
  const familySplits = new Map<string, Set<string>>();
  const originCounts = { mixed: 0, real: 0, synthetic: 0 };

  const evidence: EvaluationInventory["evidence"] = {
    invalid: [],
    preparationRequired: [],
    ready: [],
  };

  for (const loaded of allCases) {
    const { caseDefinition } = loaded;
    originCounts[caseDefinition.origin] += 1;
    const splits = familySplits.get(caseDefinition.scenarioFamily) ?? new Set();
    splits.add(caseDefinition.split);
    familySplits.set(caseDefinition.scenarioFamily, splits);

    const evidenceStatus = evidenceStatusForCase(
      caseDefinition,
      evidenceDirectory
    );

    evidence[
      evidenceStatus === "preparation_required"
        ? "preparationRequired"
        : evidenceStatus
    ].push(caseDefinition.caseId);
  }

  const workflowInventories = workflows.map((workflow) =>
    workflowInventory(workflow, allCases)
  );

  errors.push(
    ...workflowInventories.flatMap(
      ({ errors: workflowErrors }) => workflowErrors
    )
  );
  const workflowCounts = workflowInventories.map(({ summary }) => summary);

  if (allCases.length !== 48) {
    errors.push(`expected_48_cases_found_${allCases.length}`);
  }

  if (
    development.length !== 32 ||
    heldOut.length !== 16 ||
    originCounts.real !== 32 ||
    originCounts.synthetic !== 16
  ) {
    errors.push(
      `benchmark_split_or_origin_mismatch:dev_${development.length}_held_${heldOut.length}_real_${originCounts.real}_synthetic_${originCounts.synthetic}`
    );
  }

  for (const [family, splits] of familySplits) {
    if (splits.size > 1) {
      errors.push(`scenario_family_crosses_splits:${family}`);
    }
  }

  errors.push(
    ...evidence.invalid.map((caseId) => `invalid_evidence:${caseId}`)
  );

  let status: EvaluationInventory["status"] = "ready";

  if (errors.length > 0) {
    status = "invalid";
  } else if (evidence.preparationRequired.length > 0) {
    status = "needs_preparation";
  }

  return {
    caseCount: allCases.length,
    errors,
    evidence,
    originCounts,
    splitCounts: { development: development.length, held_out: heldOut.length },
    status,
    workflowCounts,
  };
};

const modelRequestBoundPerTurn = (
  workflow: EvaluationCase["workflow"]
): number => (workflow === "player_lookup" ? 15 : 6);

const estimateModelRequests = (
  cases: LoadedEvaluationCase[],
  repetitions: number,
  includeSemanticJudge = false
): number =>
  cases.reduce(
    (total, { caseDefinition }) =>
      total +
      caseDefinition.turns.length *
        modelRequestBoundPerTurn(caseDefinition.workflow) *
        repetitions,
    0
  ) + (includeSemanticJudge ? 32 + cases.length * repetitions : 0);

const sourceScopeForCase = (
  caseDefinition: EvaluationCase
): EvaluationCase["contract"]["sourceScope"] => {
  const playerAndEvidenceSources = [
    ...caseDefinition.contract.resolvedPlayers.flatMap(
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

  const representedSourceKeys = new Set(
    playerAndEvidenceSources.map(
      ({ provider, sourceId }) => `${provider}|${sourceId}`
    )
  );

  const toolOnlySources = caseDefinition.contract.toolActions.flatMap(
    ({ sourceRecords }) =>
      sourceRecords.filter(
        ({ provider, sourceId }) =>
          !representedSourceKeys.has(`${provider}|${sourceId}`)
      )
  );

  const expectedSources = [...playerAndEvidenceSources, ...toolOnlySources];

  const selectedSources =
    caseDefinition.contract.sourceScope.length > 0
      ? caseDefinition.contract.sourceScope
      : expectedSources;

  const sources = new Map<
    string,
    EvaluationCase["contract"]["sourceScope"][number]
  >();

  for (const source of selectedSources) {
    const key = [
      source.provider,
      source.sourceId,
      source.competition ?? "",
      source.season ?? "",
    ].join("|");

    sources.set(key, source);
  }

  return [...sources.values()];
};

const understatSourceId = (player: JsonValue): string | null => {
  const object = z.record(z.string(), z.json()).safeParse(player);

  if (!object.success) {
    return null;
  }

  const id = z.union([z.string(), z.number()]).safeParse(object.data.id);

  return id.success ? String(id.data) : null;
};

const apiFootballPayload = (
  payload: JsonValue,
  teamIds: Set<string>,
  playerIds: Set<string>
): JsonValue => {
  const root = z.record(z.string(), z.json()).safeParse(payload);

  if (!root.success || !Array.isArray(root.data.response)) {
    return payload;
  }

  const response = root.data.response.flatMap((item) => {
    const wrapper = z.record(z.string(), z.json()).safeParse(item);

    if (!wrapper.success) {
      return [];
    }

    const team = z.record(z.string(), z.json()).safeParse(wrapper.data.team);

    const teamId = team.success
      ? z.number().int().positive().safeParse(team.data.id)
      : { success: false as const };

    if (team.success && teamId.success) {
      if (!teamIds.has(String(teamId.data))) {
        return [];
      }

      if (!Array.isArray(wrapper.data.players)) {
        return [wrapper.data];
      }

      const players = wrapper.data.players.filter((player) => {
        const parsedPlayer = z.record(z.string(), z.json()).safeParse(player);

        const playerId = parsedPlayer.success
          ? z.number().int().positive().safeParse(parsedPlayer.data.id)
          : { success: false as const };

        return (
          parsedPlayer.success &&
          playerId.success &&
          playerIds.has(String(playerId.data))
        );
      });

      return [{ ...wrapper.data, players }];
    }

    return [wrapper.data];
  });

  return { ...root.data, response };
};

const apiFootballTeamIdsFromSearchResponses = (
  responses: EvaluationEvidenceBundle["apiFootball"]["teamSearchResponses"],
  allowedIds: Set<string>
): Set<string> =>
  new Set(
    responses.flatMap(({ payload }) => {
      const root = z.record(z.string(), z.json()).safeParse(payload);

      if (!root.success || !Array.isArray(root.data.response)) {
        return [];
      }

      return root.data.response.flatMap((item) => {
        const wrapper = z.record(z.string(), z.json()).safeParse(item);

        const team = wrapper.success
          ? z.record(z.string(), z.json()).safeParse(wrapper.data.team)
          : { success: false as const };

        const teamId = team.success
          ? z.number().int().positive().safeParse(team.data.id)
          : { success: false as const };

        return teamId.success && allowedIds.has(String(teamId.data))
          ? [String(teamId.data)]
          : [];
      });
    })
  );

const restrictEvidenceBundleToCase = (
  bundle: EvaluationEvidenceBundle,
  caseDefinition: EvaluationCase
): EvaluationEvidenceBundle => {
  const sourceScope = sourceScopeForCase(caseDefinition);

  const fmIds = new Set(
    sourceScope.flatMap(({ provider, sourceId }) =>
      provider === "fm" ? [sourceId] : []
    )
  );

  const understatIds = new Set(
    sourceScope.flatMap(({ provider, sourceId }) =>
      provider === "understat" ? [sourceId] : []
    )
  );

  const scopedUnderstatIds = new Map<string, Set<string>>();
  const unrestrictedUnderstatIds = new Set<string>();

  for (const source of sourceScope.filter(
    ({ provider }) => provider === "understat"
  )) {
    const seasonMatch = /^(?<year>20\d{2})\//u.exec(source.season ?? "");

    const year = z
      .string()
      .regex(/^20\d{2}$/u)
      .safeParse(seasonMatch?.groups?.year);

    if (source.competition === null || !year.success) {
      unrestrictedUnderstatIds.add(source.sourceId);
      continue;
    }

    const allowedScopes = scopedUnderstatIds.get(source.sourceId) ?? new Set();
    allowedScopes.add(`${source.competition}|${Number(year.data)}`);
    scopedUnderstatIds.set(source.sourceId, allowedScopes);
  }

  const availableFmUniqueIds = new Set(
    bundle.fm.players.flatMap((player) =>
      player.uniqueId === null ? [] : [player.uniqueId]
    )
  );

  const fmRecordIds = new Set(
    [...fmIds].filter((sourceId) => !availableFmUniqueIds.has(sourceId))
  );

  const fmPlayers = bundle.fm.players.filter(
    (player) =>
      fmIds.has(player.uniqueId ?? "") || fmRecordIds.has(player.recordId)
  );

  const selectedFmRecordIds = new Set(
    fmPlayers.map(({ recordId }) => recordId)
  );

  const identitySourceKeys = new Set(
    sourceScope.map(({ provider, sourceId }) => `${provider}|${sourceId}`)
  );

  for (const player of fmPlayers) {
    if (player.uniqueId !== null) {
      identitySourceKeys.add(`fm|${player.uniqueId}`);
    }
  }

  const understatSnapshots = bundle.understat.snapshots.flatMap((snapshot) => {
    const scope = `${snapshot.resourceId}|${snapshot.seasonStartYear}`;

    const players = snapshot.players.filter((player) => {
      const sourceId = understatSourceId(player);

      if (sourceId === null || !understatIds.has(sourceId)) {
        return false;
      }

      const allowedScopes = scopedUnderstatIds.get(sourceId);

      return (
        unrestrictedUnderstatIds.has(sourceId) ||
        allowedScopes === undefined ||
        allowedScopes.has(scope)
      );
    });

    return players.length > 0 ? [{ ...snapshot, players }] : [];
  });

  const apiFootballScope = new Set(
    sourceScope.flatMap(({ provider, sourceId }) =>
      provider === "api_football" ? [sourceId] : []
    )
  );

  const apiFootballTeamIds = new Set(
    bundle.apiFootball.squadResponses.flatMap(({ teamId }) =>
      apiFootballScope.has(String(teamId)) ? [String(teamId)] : []
    )
  );

  const apiFootballSearchTeamIds = apiFootballTeamIdsFromSearchResponses(
    bundle.apiFootball.teamSearchResponses,
    apiFootballScope
  );

  const apiFootballTeamScopeIds = new Set([
    ...apiFootballTeamIds,
    ...apiFootballSearchTeamIds,
  ]);

  const apiFootballPlayerIds = new Set(
    [...apiFootballScope].filter(
      (sourceId) => !apiFootballTeamScopeIds.has(sourceId)
    )
  );

  const apiFootball = {
    ...bundle.apiFootball,
    squadResponses: bundle.apiFootball.squadResponses.flatMap((response) =>
      apiFootballTeamIds.has(String(response.teamId))
        ? [
            {
              ...response,
              payload: apiFootballPayload(
                response.payload,
                apiFootballTeamIds,
                apiFootballPlayerIds
              ),
            },
          ]
        : []
    ),
    teamSearchResponses: bundle.apiFootball.teamSearchResponses.map(
      (response) => ({
        ...response,
        payload: apiFootballPayload(
          response.payload,
          apiFootballSearchTeamIds,
          apiFootballPlayerIds
        ),
      })
    ),
  };

  return evaluationEvidenceBundleSchema.parse({
    ...bundle,
    apiFootball,
    fm: {
      ...bundle.fm,
      players: fmPlayers,
      positions: bundle.fm.positions.filter(({ recordId }) =>
        selectedFmRecordIds.has(recordId)
      ),
    },
    identity: {
      ...bundle.identity,
      bridges: bundle.identity.bridges.filter(({ externalId, provider }) =>
        identitySourceKeys.has(`${provider}|${externalId}`)
      ),
    },
    understat: { snapshots: understatSnapshots },
  });
};

const previewEvaluation = (
  options: PreviewEvaluationOptions
): EvaluationPreview => {
  const caseDirectory = options.caseDirectory ?? casesRoot;
  const evidenceDirectory = options.evidenceDirectory ?? evidenceRoot;

  const cases = loadEvaluationCases(
    options.mode,
    options.caseIds,
    caseDirectory
  );

  const repetitions = options.mode === "smoke" ? 1 : 3;

  const usesHeldOutCases = cases.some(
    ({ caseDefinition }) => caseDefinition.split === "held_out"
  );

  const freezeId = options.freezeId?.trim() ?? "";
  const judgeEnabled = options.includeSemanticJudge === true;

  const freezeFingerprint = freezeFingerprintForEvaluation(
    captureRunIdentity(),
    cases,
    captureFreezeConfiguration(judgeEnabled)
  );

  const workflows = new Map<EvaluationCase["workflow"], number>();

  const evidenceChecks = cases.map(({ caseDefinition }) => {
    let evidenceStatus: EvaluationPreview["cases"][number]["evidenceStatus"] =
      "missing_or_invalid";

    try {
      const bundlePath = path.join(
        evidenceDirectory,
        `${caseDefinition.evidenceBundleId}.json`
      );

      if (!existsSync(bundlePath)) {
        return {
          caseId: caseDefinition.caseId,
          category: caseDefinition.category,
          evidenceBundleId: caseDefinition.evidenceBundleId,
          evidenceBundleSha256: caseDefinition.evidenceBundleSha256,
          evidenceStatus:
            caseDefinition.origin === "real"
              ? ("requires_preparation" as const)
              : ("missing_or_invalid" as const),
          origin: caseDefinition.origin,
          split: caseDefinition.split,
          workflow: caseDefinition.workflow,
        };
      }

      const bundle = readJson(bundlePath, evaluationEvidenceBundleSchema);

      if (
        bundle.bundleId === caseDefinition.evidenceBundleId &&
        bundle.origin === caseDefinition.origin &&
        sha256File(bundlePath) === caseDefinition.evidenceBundleSha256
      ) {
        evidenceStatus = "ready";
      }
    } catch {
      evidenceStatus = "missing_or_invalid";
    }

    return {
      caseId: caseDefinition.caseId,
      category: caseDefinition.category,
      evidenceBundleId: caseDefinition.evidenceBundleId,
      evidenceBundleSha256: caseDefinition.evidenceBundleSha256,
      evidenceStatus,
      origin: caseDefinition.origin,
      split: caseDefinition.split,
      workflow: caseDefinition.workflow,
    };
  });

  for (const { caseDefinition } of cases) {
    const currentCount = workflows.get(caseDefinition.workflow) ?? 0;
    workflows.set(caseDefinition.workflow, currentCount + 1);
  }

  let sourceProcessingAllowed = true;

  try {
    assertModelProcessingAllowed("both");
  } catch {
    sourceProcessingAllowed = false;
  }

  return {
    caseCount: cases.length,
    cases: evidenceChecks,
    estimatedModelRequests: estimateModelRequests(
      cases,
      repetitions,
      judgeEnabled
    ),
    freezeFingerprint,
    freezeId: freezeId.length > 0 ? freezeId : null,
    heldOutFreezeReady:
      !usesHeldOutCases ||
      (freezeFingerprint !== null && freezeId === freezeFingerprint),
    judgeEnabled,
    mode: options.mode,
    modelConfigurationReady:
      (process.env.OPENAI_API_KEY?.trim().length ?? 0) > 0 &&
      (process.env.OPENAI_MODEL?.trim().length ?? 0) > 0,
    repetitions,
    sourceProcessingAllowed,
    trials: cases.length * repetitions,
    workflows: [...workflows.entries()].map(([workflow, caseCount]) => ({
      caseCount,
      workflow,
    })),
  };
};

const prepareEvaluationCases = (
  cases: LoadedEvaluationCase[],
  workspaceDirectory: string,
  evidenceDirectory = evidenceRoot
): PreparedEvaluationCase[] =>
  cases.map((loaded) => {
    const { caseDefinition } = loaded;

    try {
      const evidencePath = path.join(
        evidenceDirectory,
        `${caseDefinition.evidenceBundleId}.json`
      );

      const bundle = readJson(evidencePath, evaluationEvidenceBundleSchema);

      if (
        bundle.bundleId !== caseDefinition.evidenceBundleId ||
        bundle.origin !== caseDefinition.origin ||
        sha256File(evidencePath) !== caseDefinition.evidenceBundleSha256
      ) {
        throw new Error(
          "The evidence bundle identity, origin, or SHA-256 does not match the case."
        );
      }

      const caseBundle = restrictEvidenceBundleToCase(bundle, caseDefinition);

      const preparedEvidence = prepareEvidenceBundle(
        caseBundle,
        path.join(workspaceDirectory, caseDefinition.caseId),
        caseDefinition.declaredDataFaults
      );

      return {
        ...loaded,
        apiFootball: caseBundle.apiFootball,
        bundleHash: preparedEvidence.bundleHash,
        databasePaths: preparedEvidence.databases,
        evidenceSourceMetadata: {
          apiFootball:
            caseBundle.apiFootball.capturedAt === null
              ? null
              : {
                  capturedAt: caseBundle.apiFootball.capturedAt,
                  requestedTeams: caseBundle.apiFootball.requestedTeams,
                  sourceRequests: caseBundle.apiFootball.sourceRequests,
                  teamIds: caseBundle.apiFootball.squadResponses
                    .map(({ teamId }) => teamId)
                    .toSorted((left, right) => left - right),
                },
          fm: {
            databaseVersion: caseBundle.fm.manifest.databaseVersion,
            gameBuild: caseBundle.fm.manifest.gameBuild,
            inGameDate: caseBundle.fm.manifest.inGameDate,
            manifestSha256: caseBundle.fm.manifest.sha256,
          },
          identityReleaseStamp: caseBundle.identity.releaseStamp,
          understat: caseBundle.understat.snapshots.map(
            ({
              capturedAt,
              kind,
              parserVersion,
              resourceId,
              schemaVersion,
              seasonStartYear,
            }) => ({
              capturedAt,
              kind,
              parserVersion,
              resourceId,
              schemaVersion,
              seasonStartYear,
            })
          ),
        },
        preflightError: null,
      };
    } catch (error) {
      return {
        ...loaded,
        apiFootball: {
          capturedAt: null,
          requestedTeams: [],
          sourceRequests: null,
          squadResponses: [],
          teamSearchResponses: [],
        },
        bundleHash: "",
        databasePaths: null,
        evidenceSourceMetadata: null,
        preflightError:
          error instanceof Error ? error.message : "invalid_evidence_bundle",
      };
    }
  });

export {
  estimateModelRequests,
  loadEvaluationCases,
  prepareEvaluationCases,
  previewEvaluation,
  validateBenchmarkDataset,
};

export type {
  EvaluationMode,
  EvaluationInventory,
  EvaluationPreview,
  LoadedEvaluationCase,
  PreparedEvaluationCase,
  PreviewEvaluationOptions,
};
