import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluationCaseSchema,
  workerTrialResultSchema,
} from "../evals/contracts.js";
import type { EvaluationCase, WorkerTrialResult } from "../evals/contracts.js";
import {
  judgeInputForTrial,
  semanticJudgeOutputSchema,
  validateTrialJudgment,
} from "../evals/judge.js";

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
      trialId: "test-trial",
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
  toolCallId: "test-tool-call",
  trialId: "test-trial",
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
  toolCallId: "test-tool-call",
  trialId: "test-trial",
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
  toolCallId: "test-tool-call",
  trialId: "test-trial",
  turnId,
});

const allFactsCovered = (caseDefinition: EvaluationCase) =>
  caseDefinition.contract.requiredEvidence.map((_, index) => ({
    factId: `required-fact-${index + 1}`,
    status: "covered" as const,
  }));

describe("semantic judge validation rules", () => {
  it("counts a correctly labeled numeric fact in an earlier player section", () => {
    const caseDefinition = caseFile("compare-season-resume-add-synthetic-v1");

    const answer = [
      "**Synthetic Winger's Football Manager record**",
      "| Ability / attribute | Value |",
      "|---|---:|",
      "| Current ability | 139 |",
    ].join("\n");

    const turnId = "compare-season-resume-add-synthetic-v1-turn-2";

    const coverage = allFactsCovered(caseDefinition).map((fact) =>
      fact.factId === "required-fact-3"
        ? { ...fact, status: "missing" as const }
        : fact
    );

    const worker = workerForCase(
      caseDefinition,
      new Map([[turnId, [answer]]]),
      "player_comparison"
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [],
      requiredFactCoverage: coverage,
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({
      factStatus: result.requiredFactCoverage.find(
        ({ factId }) => factId === "required-fact-3"
      )?.status,
      status: result.status,
    }).toStrictEqual({ factStatus: "covered", status: "passed" });
  });

  it("keeps a numeric fact missing when the player table shows a different value", () => {
    const caseDefinition = caseFile("compare-season-resume-add-synthetic-v1");

    const answer = [
      "**Synthetic Winger's Football Manager record**",
      "| Ability / attribute | Value |",
      "|---|---:|",
      "| Current ability | 180 |",
    ].join("\n");

    const coverage = allFactsCovered(caseDefinition).map((fact) =>
      fact.factId === "required-fact-3"
        ? { ...fact, status: "missing" as const }
        : fact
    );

    const worker = workerForCase(
      caseDefinition,
      new Map([["compare-season-resume-add-synthetic-v1-turn-2", [answer]]]),
      "player_comparison"
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [],
      requiredFactCoverage: coverage,
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({
      factStatus: result.requiredFactCoverage.find(
        ({ factId }) => factId === "required-fact-3"
      )?.status,
      status: result.status,
    }).toStrictEqual({ factStatus: "missing", status: "failed" });
  });

  it("counts player values under matching Markdown column headers", () => {
    const caseDefinition = caseFile("compare-saka-foden-real-v1");
    const turnId = caseDefinition.turns[0]?.turnId;

    if (turnId === undefined) {
      throw new Error("The comparison case must declare a user turn.");
    }

    const answer = [
      "## Football Manager",
      "| 球员 | 当前能力 | 潜力能力 |",
      "|---|---:|---:|",
      "| Bukayo Saka | 182 | 188 |",
      "| Phil Foden | 169 | 180 |",
    ].join("\n");

    const coverage = allFactsCovered(caseDefinition).map((fact) =>
      fact.factId === "required-fact-1" || fact.factId === "required-fact-2"
        ? { ...fact, status: "missing" as const }
        : fact
    );

    const worker = workerForCase(
      caseDefinition,
      new Map([[turnId, [answer]]]),
      "player_comparison"
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [],
      requiredFactCoverage: coverage,
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect(
      result.requiredFactCoverage.find(
        ({ factId }) => factId === "required-fact-1"
      )?.status
    ).toBe("covered");
    expect(
      result.requiredFactCoverage.find(
        ({ factId }) => factId === "required-fact-2"
      )?.status
    ).toBe("covered");
    expect(result.status).toBe("passed");
  });

  it("does not flag a generic retained-result statement when thread state confirms a saved lookup", () => {
    const caseDefinition = caseFile("lookup-identity-clarification-v1");
    const finalTurn = caseDefinition.turns.at(-1);

    if (finalTurn === undefined) {
      throw new Error("The lookup case must declare a final turn.");
    }

    const quote = "此前已完成的结果仍保留。";

    const worker = workerForCase(
      caseDefinition,
      new Map([[finalTurn.turnId, [quote]]]),
      "player_lookup"
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation:
            "The active result kind confirms a saved lookup remains.",
          quote,
          turnId: finalTurn.turnId,
        },
      ],
      requiredFactCoverage: allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({ findings: result.findings, status: result.status }).toStrictEqual({
      findings: [],
      status: "passed",
    });
  });

  it("keeps a generic retained-result claim unsupported when no result remains in state", () => {
    const caseDefinition = caseFile("lookup-identity-clarification-v1");
    const finalTurn = caseDefinition.turns.at(-1);

    if (finalTurn === undefined) {
      throw new Error("The lookup case must declare a final turn.");
    }

    const quote = "此前已完成的结果仍保留。";

    const worker = workerForCase(
      caseDefinition,
      new Map([[finalTurn.turnId, [quote]]]),
      null
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation: "No completed result is available in this turn.",
          quote,
          turnId: finalTurn.turnId,
        },
      ],
      requiredFactCoverage: allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({ findings: result.findings, status: result.status }).toStrictEqual({
      findings: judgment.findings,
      status: "failed",
    });
  });

  it("accepts evidence from an earlier turn when judging a later historical claim", () => {
    const caseDefinition = caseFile("lookup-identity-clarification-v1");
    const [, turn] = caseDefinition.turns;

    if (turn === undefined) {
      throw new Error("The lookup case must include a follow-up turn.");
    }

    const quote =
      "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。";

    const worker = workerForCase(
      caseDefinition,
      new Map([[turn.turnId, [quote]]]),
      "player_lookup"
    );

    const judgeInput = judgeInputForTrial(caseDefinition, worker);

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "factual_contradiction",
          evidenceIds: judgeInput.evidence.map(({ evidenceId }) => evidenceId),
          explanation:
            "The prior lookup is present in the current thread result state.",
          quote,
          turnId: turn.turnId,
        },
      ],
      requiredFactCoverage: allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({
      findings: result.findings.length,
      status: result.status,
    }).toStrictEqual({
      findings: 1,
      status: "failed",
    });
  });

  it("accepts a distance-attribute exclusion supported by the recommendation count", () => {
    const caseDefinition = caseFile("recommend-smoke-synthetic-v1");
    const [turn] = caseDefinition.turns;

    if (turn === undefined) {
      throw new Error("The recommendation case must declare a user turn.");
    }

    const quote = "另有 1 个因距离属性不完整而无法排名。";

    const worker = workerForCase(
      caseDefinition,
      new Map([[turn.turnId, [quote]]]),
      null,
      [recommendationActionForCase(caseDefinition, turn.turnId, 1)]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation:
            "The tool reports one profile missing distance attributes.",
          quote,
          turnId: turn.turnId,
        },
      ],
      requiredFactCoverage: allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({ findings: result.findings, status: result.status }).toStrictEqual({
      findings: [],
      status: "passed",
    });
  });

  it("keeps a distance-attribute claim when the returned count is zero", () => {
    const caseDefinition = caseFile("recommend-smoke-synthetic-v1");
    const [turn] = caseDefinition.turns;

    if (turn === undefined) {
      throw new Error("The recommendation case must declare a user turn.");
    }

    const quote = "另有 1 个因距离属性不完整而无法排名。";

    const worker = workerForCase(
      caseDefinition,
      new Map([[turn.turnId, [quote]]]),
      null,
      [recommendationActionForCase(caseDefinition, turn.turnId, 0)]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation: "The tool reports no incomplete distance attributes.",
          quote,
          turnId: turn.turnId,
        },
      ],
      requiredFactCoverage: allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({ findings: result.findings, status: result.status }).toStrictEqual({
      findings: judgment.findings,
      status: "failed",
    });
  });

  it("accepts mapped roster exclusions when candidate IDs belong to other players", () => {
    const caseDefinition = caseFile("team-rec-refine-synthetic-v1");
    const [, turn] = caseDefinition.turns;

    if (turn === undefined) {
      throw new Error(
        "The team recommendation case needs its refinement turn."
      );
    }

    const quote = "当前阵容中所有已映射的 FM 球员均已排除。";

    const worker = workerForCase(
      caseDefinition,
      new Map([[turn.turnId, [quote]]]),
      null,
      [
        teamRecommendationActionForCase(caseDefinition, turn.turnId, [
          "fm-far-01",
        ]),
      ]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "factual_contradiction",
          evidenceIds: [],
          explanation:
            "The listed candidate does not match either mapped roster FM ID.",
          quote,
          turnId: turn.turnId,
        },
      ],
      requiredFactCoverage: allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({ findings: result.findings, status: result.status }).toStrictEqual({
      findings: [],
      status: "passed",
    });
  });

  it("keeps a roster-exclusion finding when a mapped roster ID appears as a candidate", () => {
    const caseDefinition = caseFile("team-rec-refine-synthetic-v1");
    const [, turn] = caseDefinition.turns;

    if (turn === undefined) {
      throw new Error(
        "The team recommendation case needs its refinement turn."
      );
    }

    const quote = "当前阵容中所有已映射的 FM 球员均已排除。";

    const worker = workerForCase(
      caseDefinition,
      new Map([[turn.turnId, [quote]]]),
      null,
      [
        teamRecommendationActionForCase(caseDefinition, turn.turnId, [
          "fm-close-01",
        ]),
      ]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation:
            "The result lists a mapped roster player as a candidate.",
          quote,
          turnId: turn.turnId,
        },
      ],
      requiredFactCoverage: allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({ findings: result.findings, status: result.status }).toStrictEqual({
      findings: judgment.findings,
      status: "failed",
    });
  });

  it("accepts a no-competition-filter statement when the executed tool input has none", () => {
    const caseDefinition = caseFile("lookup-followup-smoke-v1");
    const turnId = "lookup-followup-smoke-v1-turn-2";
    const quote = "查询未设置赛事过滤条件；";

    const worker = workerForCase(
      caseDefinition,
      new Map([[turnId, [quote]]]),
      "player_lookup",
      [
        searchActionForCase(caseDefinition, turnId, {
          sourceRecords: [{ provider: "understat", sourceId: "us-haaland-01" }],
        }),
      ]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation:
            "The action input does not include a competition filter.",
          quote,
          turnId,
        },
      ],
      requiredFactCoverage: allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({ findings: result.findings, status: result.status }).toStrictEqual({
      findings: [],
      status: "passed",
    });
  });

  it("does not accept a no-filter statement when the action input contains a competition", () => {
    const caseDefinition = caseFile("lookup-followup-smoke-v1");
    const turnId = "lookup-followup-smoke-v1-turn-2";
    const quote = "查询未设置赛事过滤条件；";

    const worker = workerForCase(
      caseDefinition,
      new Map([[turnId, [quote]]]),
      "player_lookup",
      [
        searchActionForCase(caseDefinition, turnId, {
          competition: "EPL",
          sourceRecords: [{ provider: "understat", sourceId: "us-haaland-01" }],
        }),
      ]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation: "The action input includes a competition filter.",
          quote,
          turnId,
        },
      ],
      requiredFactCoverage: allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({ findings: result.findings, status: result.status }).toStrictEqual({
      findings: judgment.findings,
      status: "failed",
    });
  });

  it("does not use a proposed search to support a no-filter statement", () => {
    const caseDefinition = caseFile("lookup-followup-smoke-v1");
    const turnId = "lookup-followup-smoke-v1-turn-2";
    const quote = "查询未设置赛事过滤条件；";

    const worker = workerForCase(
      caseDefinition,
      new Map([[turnId, [quote]]]),
      "player_lookup",
      [
        searchActionForCase(
          caseDefinition,
          turnId,
          {
            sourceRecords: [
              { provider: "understat", sourceId: "us-haaland-01" },
            ],
          },
          "requested"
        ),
      ]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation: "A requested action is not evidence of execution.",
          quote,
          turnId,
        },
      ],
      requiredFactCoverage: allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({ findings: result.findings, status: result.status }).toStrictEqual({
      findings: judgment.findings,
      status: "failed",
    });
  });
});
