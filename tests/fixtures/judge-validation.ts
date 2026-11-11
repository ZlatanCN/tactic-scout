import { readFileSync } from "node:fs";
import path from "node:path";

import {
  evaluationCaseSchema,
  workerTrialResultSchema,
} from "../../evals/contracts.js";
import type {
  EvaluationCase,
  WorkerTrialResult,
} from "../../evals/contracts.js";

const fixtureTrialId = "test-trial";
const fixtureToolCallId = "test-tool-call";

type SearchActionInput = {
  competition?: string;
  seasonStartYear?: number;
  sourceRecords: { provider: "fm" | "understat"; sourceId: string }[];
};

const caseFile = (caseId: string): EvaluationCase =>
  evaluationCaseSchema.parse(
    JSON.parse(
      readFileSync(
        path.join(process.cwd(), `evals/cases/${caseId}.json`),
        "utf-8"
      )
    )
  );

const workerForCase = (
  caseDefinition: EvaluationCase,
  answers: Map<string, string[]>,
  availableResultKind: string | null,
  actionEvents: WorkerTrialResult["actionEvents"] = []
) => {
  const players = caseDefinition.contract.resolvedPlayers.map((player) => ({
    candidates: [
      {
        candidateId: player.candidateId,
        canonicalIdentityId: player.canonicalIdentityId,
        records: player.sourceRecords.map(
          ({ competition, provider, season, sourceId }) => ({
            competition: competition ?? null,
            provider,
            season: season ?? null,
            sourceId,
          })
        ),
      },
    ],
    lookupName: player.mention,
    mention: player.mention,
    resolutionStatus: "resolved",
    selectedCandidateId: player.candidateId,
    selectedName: player.mention,
  }));

  const deliveredEvidence = caseDefinition.contract.requiredEvidence.map(
    (fact, index) => ({
      content: JSON.stringify(fact),
      evidenceId: `test-evidence-${index + 1}`,
      messageIndex: 0,
      modelCallIndex: 1,
      modelRunId: "test-model-run",
      provider: fact.provider,
      sourceId: fact.sourceId,
      trialId: fixtureTrialId,
      turnId: caseDefinition.turns[0]?.turnId ?? "test-turn",
    })
  );

  return workerTrialResultSchema.parse({
    actionEvents,
    activeLookupResult: null,
    activeResults: {
      comparison: null,
      lookup: null,
      playerRecommendation: null,
      teamRecommendation: null,
    },
    conversationContext: [],
    deliveredEvidence,
    driverIssue: null,
    failureCategory: null,
    identityLookupEvents: [],
    outcomeKind: caseDefinition.workflow,
    outcomeStatus: "answer_ready",
    players,
    requestKind: caseDefinition.workflow,
    teamRosterCoverage: null,
    toolMessages: [],
    turns: caseDefinition.turns.map((turn) => ({
      assistantMessages: answers.get(turn.turnId) ?? [],
      availableResultKinds:
        availableResultKind === null ? [] : [availableResultKind],
      clarificationAnswers: turn.clarificationAnswers.map(
        ({ expectedKind, resumeValue }) => ({
          kind: expectedKind,
          value: resumeValue,
        })
      ),
      clarificationKinds: turn.clarificationAnswers.map(
        ({ expectedKind }) => expectedKind
      ),
      deliveredEvidenceIds: [],
      effectiveConditions: null,
      effectiveConstraints: [],
      nodeFailure: null,
      outcomeKind: caseDefinition.workflow,
      outcomeStatus: "answer_ready",
      players,
      requestKind: caseDefinition.workflow,
      reuse: null,
      turnId: turn.turnId,
      userMessage: turn.userMessage,
    })),
  });
};

const searchActionForCase = (
  caseDefinition: EvaluationCase,
  turnId: string,
  input: SearchActionInput,
  kind: WorkerTrialResult["actionEvents"][number]["kind"] = "returned"
): WorkerTrialResult["actionEvents"][number] => ({
  actionId: "action:search-test",
  caseId: caseDefinition.caseId,
  durationMs: 20,
  eventId: "action-event:search-test",
  input,
  kind,
  name: "search_player_records",
  outcome: "found",
  result: '{"status":"found"}',
  runId: "test-run",
  sourceRecords: [],
  toolCallId: fixtureToolCallId,
  trialId: fixtureTrialId,
  turnId,
});

const recommendationActionForCase = (
  caseDefinition: EvaluationCase,
  turnId: string,
  excludedMissingAttribute: number
): WorkerTrialResult["actionEvents"][number] => ({
  actionId: "action:recommendation-test",
  caseId: caseDefinition.caseId,
  durationMs: 20,
  eventId: "action-event:recommendation-test",
  input: {},
  kind: "returned",
  name: "recommend_player_candidates",
  outcome: "ready",
  result: JSON.stringify({
    filterCounts: { excludedMissingAttribute },
  }),
  runId: "test-run",
  sourceRecords: [],
  toolCallId: fixtureToolCallId,
  trialId: fixtureTrialId,
  turnId,
});

const teamRecommendationActionForCase = (
  caseDefinition: EvaluationCase,
  turnId: string,
  candidateFmIds: string[]
): WorkerTrialResult["actionEvents"][number] => ({
  actionId: "action:team-recommendation-test",
  caseId: caseDefinition.caseId,
  durationMs: 20,
  eventId: "action-event:team-recommendation-test",
  input: {
    roster: {
      members: [
        { fmId: "fm-ref-01", mappingStatus: "resolved" },
        { fmId: "fm-close-01", mappingStatus: "resolved" },
      ],
    },
  },
  kind: "returned",
  name: "recommend_team_player_candidates",
  outcome: "ready",
  result: JSON.stringify({
    recommendation: {
      currentCandidates: candidateFmIds.map((fmId) => ({ fmId })),
      potentialCandidates: null,
    },
  }),
  runId: "test-run",
  sourceRecords: [],
  toolCallId: fixtureToolCallId,
  trialId: fixtureTrialId,
  turnId,
});

const allFactsCovered = (caseDefinition: EvaluationCase) =>
  caseDefinition.contract.requiredEvidence.map((_, index) => ({
    factId: `required-fact-${index + 1}`,
    status: "covered" as const,
  }));

const judgeValidationTest = {
  allFactsCovered,
  caseFile,
  recommendationActionForCase,
  searchActionForCase,
  teamRecommendationActionForCase,
  workerForCase,
};

export { judgeValidationTest };
