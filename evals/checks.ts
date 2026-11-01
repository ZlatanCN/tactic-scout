import { isDeepStrictEqual } from "node:util";

import { z } from "zod/v4";

import type {
  LoadedEvaluationCase,
  PreparedEvaluationCase,
} from "./benchmark.js";
import type {
  EvaluationCase,
  EvaluationCheck,
  EvaluationTrialReport,
  JsonValue,
  WorkerTrialResult,
} from "./contracts.js";

type JsonEvidenceValue =
  EvaluationCase["contract"]["requiredEvidence"][number]["value"];

type ObservedToolAction = {
  businessOutcome: string;
  name: string;
  sourceRecords: { provider: string; sourceId: string }[];
};

const jsonValue = (value: string[]): string => JSON.stringify(value);

const normalizeIdentityLookupName = (value: string): string =>
  value
    .normalize("NFKD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]/gu, "");

const sourceRecordKey = (provider: string, sourceId: string): string =>
  `${provider}:${sourceId}`;

const sortedSourceRecordKeys = (
  records: { provider: string; sourceId: string }[]
): string[] =>
  records
    .map(({ provider, sourceId }) => sourceRecordKey(provider, sourceId))
    .toSorted();

const expectedPlayerKeys = (
  players: EvaluationCase["contract"]["resolvedPlayers"]
): string[] =>
  players
    .map((player) =>
      [
        player.mention,
        player.candidateId,
        player.canonicalIdentityId ?? "",
        sortedSourceRecordKeys(player.sourceRecords).join(","),
      ].join("|")
    )
    .toSorted();

const expectedIdentityStatusKeys = (
  caseDefinition: EvaluationCase
): string[] => {
  const expectedStatuses =
    caseDefinition.contract.expectedIdentityStatuses.length > 0
      ? caseDefinition.contract.expectedIdentityStatuses
      : caseDefinition.contract.resolvedPlayers.map(({ mention }) => ({
          mention,
          status: "resolved",
        }));

  return expectedStatuses
    .map(({ mention, status }) => `${mention}|${status}`)
    .toSorted();
};

const selectedPlayerKeys = (worker: WorkerTrialResult): string[] =>
  worker.players
    .flatMap((player) => {
      const candidate = player.candidates.find(
        (item) => item.candidateId === player.selectedCandidateId
      );

      return candidate === undefined
        ? []
        : [
            [
              player.mention,
              candidate.candidateId,
              candidate.canonicalIdentityId ?? "",
              sortedSourceRecordKeys(candidate.records).join(","),
            ].join("|"),
          ];
    })
    .toSorted();

const observedIdentityStatusKeys = (worker: WorkerTrialResult): string[] =>
  worker.players
    .map(({ mention, resolutionStatus }) => `${mention}|${resolutionStatus}`)
    .toSorted();

type ExpectedTurnIdentityStatus =
  EvaluationCase["contract"]["expectedTurnIdentityStatuses"][number];

type ObservedTurnIdentityStatus = {
  mention: string;
  resolutionStatus: string;
  selectedCandidateId: string | null;
  turnId: string;
};

const expectedTurnIdentityStatusesForCase = (
  caseDefinition: EvaluationCase
): ExpectedTurnIdentityStatus[] =>
  caseDefinition.contract.expectedTurnIdentityStatuses;

const observedTurnIdentityStatuses = (
  worker: WorkerTrialResult
): ObservedTurnIdentityStatus[] =>
  worker.turns.flatMap(({ players, turnId }) =>
    players.map(({ mention, resolutionStatus, selectedCandidateId }) => ({
      mention,
      resolutionStatus,
      selectedCandidateId,
      turnId,
    }))
  );

const expectedTurnIdentityStatusLabels = (
  expected: ExpectedTurnIdentityStatus[]
): string[] =>
  expected
    .map(
      ({ acceptableStatuses, mention, selectedCandidateId, status, turnId }) =>
        `${turnId}|${mention}|${[status, ...(acceptableStatuses ?? [])].join("/")}|${selectedCandidateId ?? "*"}`
    )
    .toSorted();

const observedTurnIdentityStatusLabels = (
  actual: ObservedTurnIdentityStatus[]
): string[] =>
  actual
    .map(
      ({ mention, resolutionStatus, selectedCandidateId, turnId }) =>
        `${turnId}|${mention}|${resolutionStatus}|${selectedCandidateId ?? "*"}`
    )
    .toSorted();

const turnIdentityStatusMatches = (
  expected: ExpectedTurnIdentityStatus,
  actual: ObservedTurnIdentityStatus,
  alreadyMatched: boolean
): boolean => {
  if (alreadyMatched) {
    return false;
  }

  if (
    actual.turnId !== expected.turnId ||
    actual.mention !== expected.mention
  ) {
    return false;
  }

  const acceptableStatuses = new Set([
    expected.status,
    ...(expected.acceptableStatuses ?? []),
  ]);

  if (!acceptableStatuses.has(actual.resolutionStatus)) {
    return false;
  }

  return (
    expected.selectedCandidateId === undefined ||
    expected.selectedCandidateId === actual.selectedCandidateId
  );
};

const turnIdentityStatusesMatch = (
  expected: ExpectedTurnIdentityStatus[],
  actual: ObservedTurnIdentityStatus[]
): boolean => {
  if (expected.length !== actual.length) {
    return false;
  }

  const matchedIndices = new Set<number>();

  return expected.every((expectedStatus) => {
    const matchingIndex = actual.findIndex((actualStatus, index) =>
      turnIdentityStatusMatches(
        expectedStatus,
        actualStatus,
        matchedIndices.has(index)
      )
    );

    if (matchingIndex === -1) {
      return false;
    }

    matchedIndices.add(matchingIndex);

    return true;
  });
};

const scriptedClarificationKeys = (
  clarifications: {
    kind: string;
    value: string;
  }[]
): string[] => clarifications.map(({ kind, value }) => `${kind}|${value}`);

const expectedIdentityLookupKeys = (caseDefinition: EvaluationCase): string[] =>
  caseDefinition.contract.expectedIdentityLookups
    .map(
      ({ lookupName, status, turnId }) =>
        `${turnId}|${normalizeIdentityLookupName(lookupName)}|${status}`
    )
    .toSorted();

const observedIdentityLookupKeys = (worker: WorkerTrialResult): string[] =>
  worker.identityLookupEvents
    .flatMap(({ kind, lookupName, outcome, turnId }) =>
      kind === "returned" && outcome !== null
        ? [`${turnId}|${normalizeIdentityLookupName(lookupName)}|${outcome}`]
        : []
    )
    .toSorted();

const lookupResultSchema = z.object({
  fm: z
    .object({ records: z.array(z.json()).optional(), status: z.string() })
    .optional(),
  query: z
    .array(z.object({ provider: z.string(), sourceId: z.string() }))
    .optional(),
  understat: z
    .object({ records: z.array(z.json()).optional(), status: z.string() })
    .optional(),
});

const lookupResultFromToolMessage = (content: string) => {
  let value: unknown;

  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }

  const parsed = lookupResultSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
};

const jsonValueFromEvidence = (content: string): JsonValue | null => {
  try {
    const parsed = z.json().safeParse(JSON.parse(content));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const valueAtPath = (
  value: JsonValue | null,
  path: string
): JsonValue | null => {
  if (value === null) {
    return null;
  }

  let current: JsonValue = value;

  for (const part of path.split(".")) {
    if (Array.isArray(current)) {
      const index = Number(part);

      if (!Number.isInteger(index) || index < 0) {
        return null;
      }

      current = current[index] ?? null;
      continue;
    }

    const object = z.record(z.string(), z.json()).safeParse(current);

    if (!object.success) {
      return null;
    }

    current = object.data[part] ?? null;
  }

  return current;
};

const expectedActionValueChecks = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult
): EvaluationCheck[] => {
  const expectations = caseDefinition.contract.expectedActionValues;

  if (expectations.length === 0) {
    return [];
  }

  const results = expectations.map((expectation) => {
    const matchingEvents = worker.actionEvents.filter(
      (event) =>
        event.turnId === expectation.turnId &&
        event.name === expectation.name &&
        (expectation.source === "input"
          ? event.kind === "attempted"
          : event.kind === "returned")
    );

    const expected = JSON.stringify(expectation.value);

    const actualValues = matchingEvents.map((event) => {
      const result =
        expectation.source === "input"
          ? event.input
          : jsonValueFromEvidence(event.result ?? "");

      return valueAtPath(result, expectation.path);
    });

    return {
      actual: JSON.stringify(actualValues),
      expected,
      passed: actualValues.some(
        (actual) => JSON.stringify(actual) === expected
      ),
      path: `${expectation.turnId}:${expectation.name}:${expectation.source}.${expectation.path}`,
    };
  });

  return [
    {
      actual: JSON.stringify(
        results.map(({ actual, passed, path }) => ({ actual, passed, path }))
      ),
      expected: JSON.stringify(
        results.map(({ expected, path }) => ({ expected, path }))
      ),
      id: "expected-action-values",
      status: results.every(({ passed }) => passed) ? "passed" : "failed",
    },
  ];
};

const expectedTeamRosterCoverageChecks = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult
): EvaluationCheck[] => {
  const expected = caseDefinition.contract.expectedTeamRosterCoverage;

  if (expected === null) {
    return [];
  }

  const actual = worker.teamRosterCoverage;

  return [
    {
      actual: JSON.stringify(actual),
      expected: JSON.stringify(expected),
      id: "team-roster-coverage",
      status: isDeepStrictEqual(actual, expected) ? "passed" : "failed",
    },
  ];
};

const activeResultKey = (
  kind: EvaluationCase["contract"]["expectedActiveResultValues"][number]["kind"]
): keyof WorkerTrialResult["activeResults"] => {
  if (kind === "player_comparison") {
    return "comparison";
  }

  if (kind === "player_recommendation") {
    return "playerRecommendation";
  }

  if (kind === "team_recommendation") {
    return "teamRecommendation";
  }

  return "lookup";
};

const expectedActiveResultChecks = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult
): EvaluationCheck[] => {
  const expectations = caseDefinition.contract.expectedActiveResultValues;

  if (expectations.length === 0) {
    return [];
  }

  const results = expectations.map((expectation) => {
    const raw = worker.activeResults[activeResultKey(expectation.kind)];

    const activeResult = raw === null ? null : jsonValueFromEvidence(raw);

    const actual = valueAtPath(activeResult, expectation.path);

    return {
      actual: JSON.stringify(actual),
      expected: JSON.stringify(expectation.value),
      passed: JSON.stringify(actual) === JSON.stringify(expectation.value),
      path: `${expectation.kind}.${expectation.path}`,
    };
  });

  return [
    {
      actual: JSON.stringify(
        results.map(({ actual, passed, path }) => ({ actual, passed, path }))
      ),
      expected: JSON.stringify(
        results.map(({ expected, path }) => ({ expected, path }))
      ),
      id: "active-result-values",
      status: results.every(({ passed }) => passed) ? "passed" : "failed",
    },
  ];
};

const expectedTurnParameterChecks = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult
): EvaluationCheck[] => {
  const expectations = caseDefinition.contract.expectedTurnParameters;

  if (expectations.length === 0) {
    return [];
  }

  const results = expectations.map((expectation) => {
    const turn = worker.turns.find(
      ({ turnId }) => turnId === expectation.turnId
    );

    const parameters = z.json().safeParse(turn?.effectiveConditions ?? null);

    const actual = valueAtPath(
      parameters.success ? parameters.data : null,
      expectation.path
    );

    return {
      actual: JSON.stringify(actual),
      expected: JSON.stringify(expectation.value),
      passed: JSON.stringify(actual) === JSON.stringify(expectation.value),
      path: `${expectation.turnId}.${expectation.path}`,
    };
  });

  return [
    {
      actual: JSON.stringify(
        results.map(({ actual, passed, path }) => ({ actual, passed, path }))
      ),
      expected: JSON.stringify(
        results.map(({ expected, path }) => ({ expected, path }))
      ),
      id: "expected-turn-parameters",
      status: results.every(({ passed }) => passed) ? "passed" : "failed",
    },
  ];
};

const normalizedToolOutcome = (outcome: string | null): string => {
  const knownLookupOutcomes = new Set(["found", "not_found", "unavailable"]);

  return outcome !== null && knownLookupOutcomes.has(outcome)
    ? outcome
    : (outcome ?? "unknown");
};

const actionOutcome = (
  kind: WorkerTrialResult["actionEvents"][number]["kind"],
  outcome: string | null
): string | null => {
  if (kind === "returned") {
    return normalizedToolOutcome(outcome);
  }

  return ["blocked", "cache_hit", "failed", "schema_rejected"].includes(kind)
    ? kind
    : null;
};

const actualToolActions = (worker: WorkerTrialResult): ObservedToolAction[] =>
  worker.actionEvents.flatMap(({ kind, name, outcome, sourceRecords }) => {
    const businessOutcome = actionOutcome(kind, outcome);

    return businessOutcome === null
      ? []
      : [
          {
            businessOutcome,
            name,
            sourceRecords: sourceRecords.map(({ provider, sourceId }) => ({
              provider,
              sourceId,
            })),
          },
        ];
  });

const toolActionKeys = (actions: ObservedToolAction[]): string[] =>
  actions
    .map((action) =>
      [
        action.name,
        action.businessOutcome,
        sortedSourceRecordKeys(action.sourceRecords).join(","),
      ].join("|")
    )
    .toSorted();

const evidenceValueIfMatches = (
  rawRecord: JsonEvidenceValue,
  expectation: EvaluationCase["contract"]["requiredEvidence"][number]
): string | null => {
  const parsedRecord = z.record(z.string(), z.json()).safeParse(rawRecord);

  if (!parsedRecord.success) {
    return null;
  }

  const record = parsedRecord.data;

  const sourceId =
    expectation.provider === "fm"
      ? (z.string().safeParse(record.identitySourceId).data ??
        z.string().safeParse(record.fmId).data)
      : (z.string().safeParse(record.sourcePlayerId).data ??
        z.string().safeParse(record.sourceId).data);

  if (sourceId !== expectation.sourceId) {
    return null;
  }

  if (
    expectation.competition !== undefined &&
    record.competition !== expectation.competition
  ) {
    return null;
  }

  if (
    expectation.season !== undefined &&
    record.season !== expectation.season
  ) {
    return null;
  }

  const value = record[expectation.field];

  return value === undefined ? null : (JSON.stringify(value) ?? "null");
};

const recordsFromEvidenceValue = (
  value: JsonValue | null,
  expectation: EvaluationCase["contract"]["requiredEvidence"][number]
): JsonEvidenceValue[] => {
  const visit = (item: JsonValue): JsonEvidenceValue[] => {
    if (Array.isArray(item)) {
      return item.flatMap(visit);
    }

    const object = z.record(z.string(), z.json()).safeParse(item);

    if (!object.success) {
      return [];
    }

    const idField =
      expectation.provider === "fm" ? "identitySourceId" : "sourcePlayerId";

    const alternateIdField =
      expectation.provider === "fm" ? "fmId" : "sourceId";

    const sourceId =
      z.string().safeParse(object.data[idField]).data ??
      z.string().safeParse(object.data[alternateIdField]).data;

    const matches = sourceId === expectation.sourceId;
    const nested = Object.values(object.data).flatMap(visit);

    return matches ? [object.data, ...nested] : nested;
  };

  return value === null ? [] : visit(value);
};

const recordsForEvidenceExpectation = (
  worker: WorkerTrialResult,
  expectation: EvaluationCase["contract"]["requiredEvidence"][number]
): JsonEvidenceValue[] =>
  worker.deliveredEvidence.flatMap(({ content }) =>
    recordsFromEvidenceValue(jsonValueFromEvidence(content), expectation)
  );

const valueAtSource = (
  worker: WorkerTrialResult,
  expectation: EvaluationCase["contract"]["requiredEvidence"][number]
): string =>
  recordsForEvidenceExpectation(worker, expectation)
    .map((record) => evidenceValueIfMatches(record, expectation))
    .find((value) => value !== null) ?? "undefined";

const sourceRecordsFromWorker = (worker: WorkerTrialResult) =>
  worker.players
    .flatMap((player) => {
      const selected = player.candidates.find(
        (candidate) => candidate.candidateId === player.selectedCandidateId
      );

      return (
        selected?.records.map(({ provider, sourceId }) => ({
          provider,
          sourceId,
        })) ?? []
      );
    })
    .toSorted(
      (left, right) =>
        left.provider.localeCompare(right.provider) ||
        left.sourceId.localeCompare(right.sourceId)
    );

const identityLookupChecks = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult
): EvaluationCheck[] => {
  const expected = expectedIdentityLookupKeys(caseDefinition);

  if (expected.length === 0) {
    return [];
  }

  const actual = observedIdentityLookupKeys(worker);

  return [
    {
      actual: jsonValue(actual),
      expected: jsonValue(expected),
      id: "identity-lookup-observations",
      status: isDeepStrictEqual(actual, expected) ? "passed" : "failed",
    },
  ];
};

const activeLookupChecks = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult
): EvaluationCheck[] => {
  const expected = sortedSourceRecordKeys(
    caseDefinition.contract.expectedActiveLookupSourceRecords
  );

  if (expected.length === 0) {
    return [];
  }

  const activeLookupResult =
    worker.activeLookupResult === null
      ? null
      : lookupResultFromToolMessage(worker.activeLookupResult);

  const actual = sortedSourceRecordKeys(activeLookupResult?.query ?? []);

  return [
    {
      actual: jsonValue(actual),
      expected: jsonValue(expected),
      id: "active-lookup-preserved",
      status: isDeepStrictEqual(actual, expected) ? "passed" : "failed",
    },
  ];
};

const turnToolActionChecks = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult
): EvaluationCheck[] => {
  const expected = caseDefinition.contract.expectedTurnToolActions
    .map(({ businessOutcome, name, sourceRecords, turnId }) =>
      [
        turnId,
        name,
        businessOutcome,
        sortedSourceRecordKeys(sourceRecords).join(","),
      ].join("|")
    )
    .toSorted();

  if (expected.length === 0) {
    return [];
  }

  const actual = worker.actionEvents
    .flatMap((event) => {
      const businessOutcome = actionOutcome(event.kind, event.outcome);

      return businessOutcome === null
        ? []
        : [
            [
              event.turnId,
              event.name,
              businessOutcome,
              sortedSourceRecordKeys(event.sourceRecords).join(","),
            ].join("|"),
          ];
    })
    .toSorted();

  return [
    {
      actual: jsonValue(actual),
      expected: jsonValue(expected),
      id: "turn-tool-actions",
      status: isDeepStrictEqual(actual, expected) ? "passed" : "failed",
    },
  ];
};

const clarificationChecks = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult
): EvaluationCheck[] => {
  const hasDeclaredAnswers = caseDefinition.turns.some(
    ({ clarificationAlternatives, clarificationAnswers }) =>
      clarificationAnswers.length > 0 ||
      clarificationAlternatives.some((answerPath) => answerPath.length > 0)
  );

  const hasObservedAnswers = worker.turns.some(
    ({ clarificationAnswers }) => clarificationAnswers.length > 0
  );

  if (
    !hasDeclaredAnswers &&
    !hasObservedAnswers &&
    worker.driverIssue === null
  ) {
    return [];
  }

  const expected = caseDefinition.turns.map((turn) => ({
    paths: [turn.clarificationAnswers, ...turn.clarificationAlternatives].map(
      (answerPath) =>
        scriptedClarificationKeys(
          answerPath.map(({ expectedKind, resumeValue }) => ({
            kind: expectedKind,
            value: resumeValue,
          }))
        )
    ),
    turnId: turn.turnId,
  }));

  const actual = worker.turns.map((turn) => ({
    answers: scriptedClarificationKeys(turn.clarificationAnswers),
    turnId: turn.turnId,
  }));

  const answersMatch =
    actual.length === expected.length &&
    expected.every((expectedTurn) => {
      const actualTurn = actual.find(
        (turn) => turn.turnId === expectedTurn.turnId
      );

      return (
        actualTurn !== undefined &&
        expectedTurn.paths.some((answerPath) =>
          isDeepStrictEqual(actualTurn.answers, answerPath)
        )
      );
    });

  return [
    {
      actual: JSON.stringify({ answers: actual, issue: worker.driverIssue }),
      expected: JSON.stringify({ answers: expected, issue: null }),
      id: "scripted-clarifications",
      status: answersMatch && worker.driverIssue === null ? "passed" : "failed",
    },
  ];
};

const canonicalConstraintNames = new Map<string, string>([
  ["age", "age"],
  ["maxage", "age"],
  ["maximumage", "age"],
  ["年龄", "age"],
  ["年龄上限", "age"],
  ["ca", "CA"],
  ["minca", "CA"],
  ["minimumca", "CA"],
  ["currentability", "CA"],
  ["minimumcurrentability", "CA"],
  ["当前能力", "CA"],
  ["pa", "PA"],
  ["minpa", "PA"],
  ["minimumpa", "PA"],
  ["potentialability", "PA"],
  ["minimumpotentialability", "PA"],
  ["潜力", "PA"],
  ["潜力下限", "PA"],
  ["season", "season"],
  ["赛季", "season"],
  ["competition", "competition"],
  ["league", "competition"],
  ["赛事", "competition"],
  ["联赛", "competition"],
  ["position", "position"],
  ["位置", "position"],
  ["limit", "result_limit"],
  ["resultlimit", "result_limit"],
  ["maximumresults", "result_limit"],
  ["结果数", "result_limit"],
  ["最多", "result_limit"],
]);

const canonicalConstraintName = (name: string): string => {
  const normalized = name
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[\s_-]/gu, "");

  return canonicalConstraintNames.get(normalized) ?? name;
};

const turnConstraintChecks = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult
): EvaluationCheck[] => {
  const expected = caseDefinition.contract.expectedTurnConstraints;

  if (expected.length === 0) {
    return [];
  }

  const actual = expected.map(({ turnId }) => {
    const turn = worker.turns.find((item) => item.turnId === turnId);

    return {
      constraints: (turn?.effectiveConstraints ?? []).map((constraint) => ({
        ...constraint,
        name: canonicalConstraintName(constraint.name),
      })),
      turnId,
    };
  });

  const normalizedExpected = expected.map((turn) => ({
    ...turn,
    constraints: turn.constraints
      .map((constraint) => ({
        ...constraint,
        name: canonicalConstraintName(constraint.name),
      }))
      .toSorted(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.value.localeCompare(right.value)
      ),
  }));

  const normalizedActual = actual.map((turn) => ({
    ...turn,
    constraints: turn.constraints.toSorted(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.value.localeCompare(right.value)
    ),
  }));

  return [
    {
      actual: JSON.stringify(normalizedActual),
      expected: JSON.stringify(normalizedExpected),
      id: "effective-turn-constraints",
      status: isDeepStrictEqual(normalizedActual, normalizedExpected)
        ? "passed"
        : "failed",
    },
  ];
};

const checkCaseContract = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult
): EvaluationCheck[] => {
  const expectedActions = caseDefinition.contract.toolActions.map(
    ({ businessOutcome, name, sourceRecords }) => ({
      businessOutcome,
      name,
      sourceRecords: sourceRecords.map(({ provider, sourceId }) => ({
        provider,
        sourceId,
      })),
    })
  );

  const actualActions = actualToolActions(worker);

  const expectedEvidencePassed = caseDefinition.contract.requiredEvidence.every(
    (expectation) =>
      valueAtSource(worker, expectation) ===
      (JSON.stringify(expectation.value) ?? "undefined")
  );

  const expectedPlayers = expectedPlayerKeys(
    caseDefinition.contract.resolvedPlayers
  );

  const actualPlayers = selectedPlayerKeys(worker);
  const expectedIdentityStatuses = expectedIdentityStatusKeys(caseDefinition);
  const actualIdentityStatuses = observedIdentityStatusKeys(worker);

  const expectedTurnIdentityStatuses =
    expectedTurnIdentityStatusesForCase(caseDefinition);

  const actualTurnIdentityStatuses = observedTurnIdentityStatuses(worker);

  const expectedTurnIdentityLabels = expectedTurnIdentityStatusLabels(
    expectedTurnIdentityStatuses
  );

  const actualTurnIdentityLabels = observedTurnIdentityStatusLabels(
    actualTurnIdentityStatuses
  );

  const turnIdentityStatusesPassed = turnIdentityStatusesMatch(
    expectedTurnIdentityStatuses,
    actualTurnIdentityStatuses
  );

  const expectedActionsKey = toolActionKeys(expectedActions);
  const actualActionsKey = toolActionKeys(actualActions);

  return [
    {
      actual: worker.outcomeKind ?? worker.requestKind ?? "missing",
      expected: caseDefinition.contract.taskKind,
      id: "task-kind",
      status:
        (worker.outcomeKind ?? worker.requestKind) ===
        caseDefinition.contract.taskKind
          ? "passed"
          : "failed",
    },
    {
      actual: worker.outcomeStatus ?? "none",
      expected: caseDefinition.contract.outcomeStatus ?? "none",
      id: "task-outcome",
      status:
        worker.outcomeStatus === caseDefinition.contract.outcomeStatus
          ? "passed"
          : "failed",
    },
    {
      actual: jsonValue(actualIdentityStatuses),
      expected: jsonValue(expectedIdentityStatuses),
      id: "identity-resolution-status",
      status: isDeepStrictEqual(
        actualIdentityStatuses,
        expectedIdentityStatuses
      )
        ? "passed"
        : "failed",
    },
    {
      actual: jsonValue(actualPlayers),
      expected: jsonValue(expectedPlayers),
      id: "resolved-identity",
      status: isDeepStrictEqual(actualPlayers, expectedPlayers)
        ? "passed"
        : "failed",
    },
    ...(expectedTurnIdentityStatuses.length === 0
      ? []
      : [
          {
            actual: jsonValue(actualTurnIdentityLabels),
            expected: jsonValue(expectedTurnIdentityLabels),
            id: "turn-identity-continuity",
            status: turnIdentityStatusesPassed
              ? ("passed" as const)
              : ("failed" as const),
          },
        ]),
    ...activeLookupChecks(caseDefinition, worker),
    ...identityLookupChecks(caseDefinition, worker),
    ...clarificationChecks(caseDefinition, worker),
    ...turnConstraintChecks(caseDefinition, worker),
    ...turnToolActionChecks(caseDefinition, worker),
    ...expectedActionValueChecks(caseDefinition, worker),
    ...expectedTeamRosterCoverageChecks(caseDefinition, worker),
    ...expectedTurnParameterChecks(caseDefinition, worker),
    ...expectedActiveResultChecks(caseDefinition, worker),
    {
      actual: jsonValue(actualActionsKey),
      expected: jsonValue(expectedActionsKey),
      id: "lookup-result",
      status: isDeepStrictEqual(actualActionsKey, expectedActionsKey)
        ? "passed"
        : "failed",
    },
    {
      actual: expectedEvidencePassed
        ? "all_required_evidence_found"
        : "missing_or_wrong_evidence",
      expected: "all_required_evidence_found",
      id: "required-evidence",
      status: expectedEvidencePassed ? "passed" : "failed",
    },
  ];
};

const emptyWorkerResult = (error: string): WorkerTrialResult => ({
  actionEvents: [],
  activeLookupResult: null,
  activeResults: {
    comparison: null,
    lookup: null,
    playerRecommendation: null,
    teamRecommendation: null,
  },
  conversationContext: [],
  deliveredEvidence: [],
  driverIssue: null,
  error,
  failureCategory: null,
  identityLookupEvents: [],
  outcomeKind: null,
  outcomeStatus: null,
  players: [],
  requestKind: null,
  teamRosterCoverage: null,
  toolMessages: [],
  turns: [],
});

const makeTrialReport = (
  prepared: PreparedEvaluationCase,
  runIndex: number,
  worker: WorkerTrialResult,
  gatewayExchanges: EvaluationTrialReport["gatewayExchanges"],
  modelRequests: number,
  deniedRequests: number,
  networkFailures: number
): EvaluationTrialReport => {
  const base = {
    caseHash: prepared.caseHash,
    caseId: prepared.caseDefinition.caseId,
    category: prepared.caseDefinition.category,
    checks: [],
    codeStatus: "not_run" as const,
    evidenceBundleHash: prepared.bundleHash,
    evidenceSourceMetadata: prepared.evidenceSourceMetadata,
    gatewayExchanges,
    modelRequests,
    modelRequestsByRole: { agent: modelRequests, calibration: 0, judge: 0 },
    networkFailures,
    observation: worker,
    origin: prepared.caseDefinition.origin,
    priorTuningExposure: prepared.caseDefinition.priorTuningExposure,
    runIndex,
    scenarioFamily: prepared.caseDefinition.scenarioFamily,
    semanticFindings: [],
    semanticRequiredFactCoverage: [],
    semanticStatus: "not_assessed" as const,
    semanticValidationErrors: [],
    sourceRecords: [],
    split: prepared.caseDefinition.split,
    workflow: prepared.caseDefinition.workflow,
  };

  if (prepared.preflightError !== null || prepared.databasePaths === null) {
    return { ...base, status: "preflight_error" };
  }

  if (deniedRequests > 0) {
    return { ...base, status: "budget_exhausted" };
  }

  if (worker.error !== undefined) {
    return { ...base, status: "runtime_error" };
  }

  const checks = checkCaseContract(prepared.caseDefinition, worker);

  const codeStatus = checks.every((check) => check.status === "passed")
    ? "passed"
    : "failed";

  return {
    ...base,
    checks,
    codeStatus,
    sourceRecords: sourceRecordsFromWorker(worker),
    status: codeStatus === "passed" ? "not_assessed" : "failed",
  };
};

const makeUnrunTrial = (
  prepared: PreparedEvaluationCase,
  runIndex: number
): EvaluationTrialReport => ({
  caseHash: prepared.caseHash,
  caseId: prepared.caseDefinition.caseId,
  category: prepared.caseDefinition.category,
  checks: [],
  codeStatus: "not_run",
  evidenceBundleHash: prepared.bundleHash,
  evidenceSourceMetadata: prepared.evidenceSourceMetadata,
  gatewayExchanges: [],
  modelRequests: 0,
  modelRequestsByRole: { agent: 0, calibration: 0, judge: 0 },
  networkFailures: 0,
  observation: emptyWorkerResult("This trial was not dispatched."),
  origin: prepared.caseDefinition.origin,
  priorTuningExposure: prepared.caseDefinition.priorTuningExposure,
  runIndex,
  scenarioFamily: prepared.caseDefinition.scenarioFamily,
  semanticFindings: [],
  semanticRequiredFactCoverage: [],
  semanticStatus: "not_assessed",
  semanticValidationErrors: [],
  sourceRecords: [],
  split: prepared.caseDefinition.split,
  status: "not_run",
  workflow: prepared.caseDefinition.workflow,
});

const makePreflightFailureTrial = (
  loaded: LoadedEvaluationCase,
  runIndex: number,
  message: string
): EvaluationTrialReport => {
  const prepared: PreparedEvaluationCase = {
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
    preflightError: message,
  };

  return makeTrialReport(
    prepared,
    runIndex,
    emptyWorkerResult(message),
    [],
    0,
    0,
    0
  );
};

export {
  checkCaseContract,
  emptyWorkerResult,
  makePreflightFailureTrial,
  makeTrialReport,
  makeUnrunTrial,
};
