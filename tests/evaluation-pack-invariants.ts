import type { LoadedEvaluationCase } from "../evals/benchmark.js";

type EvaluationCaseDefinition = LoadedEvaluationCase["caseDefinition"];

type EvaluationPackSummary = {
  count: number;
  origins: { mixed: number; real: number; synthetic: number };
  workflows: Record<string, number>;
};

const sourceKeysForCases = (
  cases: { caseDefinition: EvaluationCaseDefinition }[]
): Set<string> =>
  new Set(
    cases
      .flatMap(({ caseDefinition }) => [
        ...caseDefinition.contract.sourceScope,
        ...caseDefinition.contract.resolvedPlayers.flatMap(
          ({ sourceRecords }) => sourceRecords
        ),
        ...caseDefinition.contract.resolvedPlayers.flatMap(
          ({ canonicalIdentityId }) =>
            canonicalIdentityId === null
              ? []
              : [{ provider: "reep", sourceId: canonicalIdentityId }]
        ),
        ...caseDefinition.contract.requiredEvidence.map(
          ({ provider, sourceId }) => ({ provider, sourceId })
        ),
        ...caseDefinition.contract.toolActions.flatMap(
          ({ sourceRecords }) => sourceRecords
        ),
        ...caseDefinition.contract.expectedTurnToolActions.flatMap(
          ({ sourceRecords }) => sourceRecords
        ),
      ])
      .map(({ provider, sourceId }) => {
        const normalizedSourceId = sourceId.split(":").at(-1) ?? sourceId;

        return `${provider}:${normalizedSourceId}`;
      })
  );

const evaluationPackSummary = (
  cases: LoadedEvaluationCase[]
): EvaluationPackSummary => {
  const workflows = new Map<string, number>();
  const origins = { mixed: 0, real: 0, synthetic: 0 };

  for (const { caseDefinition } of cases) {
    workflows.set(
      caseDefinition.workflow,
      (workflows.get(caseDefinition.workflow) ?? 0) + 1
    );
    origins[caseDefinition.origin] += 1;
  }

  return {
    count: cases.length,
    origins,
    workflows: Object.fromEntries(workflows),
  };
};

const evaluationPackConflicts = (
  cases: LoadedEvaluationCase[],
  priorCases: LoadedEvaluationCase[]
): string[] => {
  const priorCaseIds = new Set(
    priorCases.map(({ caseDefinition }) => caseDefinition.caseId)
  );

  const priorFamilies = new Set(
    priorCases.map(({ caseDefinition }) => caseDefinition.scenarioFamily)
  );

  const priorBundles = new Set(
    priorCases.map(({ caseDefinition }) => caseDefinition.evidenceBundleId)
  );

  const priorSources = sourceKeysForCases(priorCases);

  const priorMentions = new Set(
    priorCases.flatMap(({ caseDefinition }) =>
      caseDefinition.contract.resolvedPlayers.map(({ mention }) =>
        mention.toLocaleLowerCase()
      )
    )
  );

  return cases.flatMap(({ caseDefinition }) => [
    ...(priorCaseIds.has(caseDefinition.caseId) ? [caseDefinition.caseId] : []),
    ...(priorFamilies.has(caseDefinition.scenarioFamily)
      ? [caseDefinition.scenarioFamily]
      : []),
    ...(priorBundles.has(caseDefinition.evidenceBundleId)
      ? [caseDefinition.evidenceBundleId]
      : []),
    ...caseDefinition.contract.resolvedPlayers
      .filter(({ mention }) => priorMentions.has(mention.toLocaleLowerCase()))
      .map(({ mention }) => mention),
    ...[...sourceKeysForCases([{ caseDefinition }])].filter((sourceKey) =>
      priorSources.has(sourceKey)
    ),
  ]);
};

const evaluationProvenanceErrors = (
  cases: LoadedEvaluationCase[],
  ageAsOfDate: string
): unknown[] => {
  const performanceFields = new Set([
    "appearances",
    "assists",
    "expectedAssists",
    "expectedGoals",
    "goals",
    "minutes",
    "shots",
  ]);

  return cases.flatMap(({ caseDefinition }) => {
    const fmPerformanceEvidence =
      caseDefinition.contract.requiredEvidence.filter(
        ({ field, provider }) =>
          performanceFields.has(field) && provider !== "understat"
      );

    const understatSourcesWithoutMatchingScope = [
      ...caseDefinition.contract.resolvedPlayers.flatMap(
        ({ sourceRecords }) => sourceRecords
      ),
      ...caseDefinition.contract.requiredEvidence,
      ...caseDefinition.contract.toolActions.flatMap(
        ({ sourceRecords }) => sourceRecords
      ),
      ...caseDefinition.contract.expectedTurnToolActions.flatMap(
        ({ sourceRecords }) => sourceRecords
      ),
    ].filter(
      (record) =>
        record.provider === "understat" &&
        !caseDefinition.contract.sourceScope.some(
          (scope) =>
            scope.provider === "understat" &&
            scope.sourceId === record.sourceId &&
            scope.competition === record.competition &&
            scope.season === record.season
        )
    );

    const invalidApiFootballIds = caseDefinition.contract.sourceScope
      .filter(({ provider }) => provider === "api_football")
      .filter(({ sourceId }) => !/^\d+$/u.test(sourceId));

    return [
      ...(caseDefinition.ageAsOfDate === ageAsOfDate
        ? []
        : [
            {
              ageAsOfDate: caseDefinition.ageAsOfDate,
              caseId: caseDefinition.caseId,
            },
          ]),
      ...fmPerformanceEvidence.map(({ field, sourceId }) => ({
        caseId: caseDefinition.caseId,
        field,
        sourceId,
      })),
      ...understatSourcesWithoutMatchingScope.map(
        ({ competition, season, sourceId }) => ({
          caseId: caseDefinition.caseId,
          competition,
          season,
          sourceId,
        })
      ),
      ...invalidApiFootballIds.map(({ sourceId }) => ({
        caseId: caseDefinition.caseId,
        sourceId,
      })),
    ];
  });
};

const sourceRecordsMatch = (
  left: { provider: string; sourceId: string },
  right: { provider: string; sourceId: string }
): boolean =>
  left.provider === right.provider && left.sourceId === right.sourceId;

const missingSourceActionsForLookup = (
  caseDefinition: EvaluationCaseDefinition,
  lookup: EvaluationCaseDefinition["contract"]["expectedIdentityLookups"][number]
) => {
  const player = caseDefinition.contract.resolvedPlayers.find(
    ({ mention }) => mention === lookup.lookupName
  );

  const actionRecords = caseDefinition.contract.expectedTurnToolActions
    .filter((action) => action.turnId === lookup.turnId)
    .flatMap(({ sourceRecords }) => sourceRecords);

  return (player?.sourceRecords ?? [])
    .filter(
      (source) =>
        !actionRecords.some((action) => sourceRecordsMatch(source, action))
    )
    .map((source) => ({
      caseId: caseDefinition.caseId,
      lookupName: lookup.lookupName,
      sourceId: source.sourceId,
      turnId: lookup.turnId,
    }));
};

const missingResolvedSourceActions = (
  cases: LoadedEvaluationCase[]
): {
  caseId: string;
  lookupName: string;
  sourceId: string;
  turnId: string;
}[] =>
  cases.flatMap(({ caseDefinition }) =>
    caseDefinition.contract.expectedIdentityLookups.flatMap((lookup) =>
      missingSourceActionsForLookup(caseDefinition, lookup)
    )
  );

export {
  evaluationPackConflicts,
  evaluationPackSummary,
  evaluationProvenanceErrors,
  missingResolvedSourceActions,
};
