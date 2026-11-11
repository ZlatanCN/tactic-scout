import { createHash } from "node:crypto";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { evaluationWorkerRequestSchema } from "../../../evals/contracts.js";
import { createEvaluationObserver } from "../../../evals/observation.js";
import { playerRecommendationEvidenceProjections } from "../../../src/player-recommendation-evidence.js";
import { AgentState, agentStateSchemaVersion } from "../../../src/state.js";
import { teamRecommendationEvidenceProjections } from "../../../src/team-recommendation-evidence.js";
import { teamRecommendationEvidenceFixture } from "../../fixtures/team-recommendation-evidence.js";
import { recommendationResultData } from "../../fixtures/workflow-results.js";

const evaluationRequest = (turnId: string, userMessage: string) =>
  evaluationWorkerRequestSchema.parse({
    ageAsOfDate: "2026-11-11",
    caseId: "recommendation-projection",
    caseOrigin: "synthetic",
    databasePaths: {
      fm: "test-fm.sqlite",
      identity: "test-identity.sqlite",
      understat: "test-understat.sqlite",
    },
    declaredTurnFaults: [],
    maxClarificationsPerTurn: 2,
    resultPath: "test-result.json",
    runId: "recommendation-projection-run",
    threadId: "recommendation-projection-thread",
    trialId: "recommendation-projection-trial",
    turnIds: [turnId],
    turns: [
      {
        clarificationAlternatives: [],
        clarificationAnswers: [],
        turnId,
        userMessage,
      },
    ],
  });

const captureProjection = (
  kind: "player_recommendation" | "team_recommendation",
  turnId: string,
  userMessage: string,
  projectionJson: string
) => {
  const request = evaluationRequest(turnId, userMessage);

  const marker =
    kind === "player_recommendation"
      ? "Player recommendation evidence projection JSON:\n"
      : "Team recommendation evidence projection JSON:\n";

  const observer = createEvaluationObserver(request);

  if (observer.callbacks.handleChatModelStart === undefined) {
    throw new Error("The evaluation observer has no model-start callback.");
  }

  observer.callbacks.handleChatModelStart(
    {
      id: ["tests", "chat-model"],
      kwargs: {},
      lc: 1,
      name: "chat-model",
      type: "constructor",
    },
    [
      [
        new HumanMessage(
          `用户请求：${userMessage}\n\n${marker}${projectionJson}`
        ),
      ],
    ],
    `${kind}-projection-model-run`
  );

  const turn = request.turns.at(0);

  if (turn === undefined) {
    throw new Error("The observer fixture needs one turn.");
  }

  const state = AgentState.parse({
    messages: [new HumanMessage(userMessage), new AIMessage("Batch received.")],
    outcome: {
      kind,
      resultJson: projectionJson,
      source: "saved",
      status: "ready",
    },
    stateSchemaVersion: agentStateSchemaVersion,
  });

  observer.recordTurn(turn, state, []);

  return observer;
};

describe("recommendation evidence projection observation", () => {
  it("records which ranked player list and candidates the model received", () => {
    const userMessage = "Explain both saved player recommendation lists.";

    const resultJson = JSON.stringify(
      recommendationResultData("ready", "stc", {
        currentCandidates: [
          {
            age: 21,
            attributes: [],
            currentAbility: 140,
            currentDistance: 0.25,
            fmId: "current-fm-1",
            name: "Current Candidate",
            positionRating: 18,
            potentialAbility: 170,
            rank: 1,
            sourceRecordId: "current-source-1",
          },
          {
            age: 22,
            attributes: [],
            currentAbility: 138,
            currentDistance: 0.5,
            fmId: "current-fm-2",
            name: "Current Candidate Two",
            positionRating: 19,
            potentialAbility: 171,
            rank: 2,
            sourceRecordId: "current-source-2",
          },
        ],
        filters: {
          includePotential: true,
          maxAge: 23,
          minimumCurrentAbility: null,
          minimumPotentialAbility: null,
          resultLimit: 20,
        },
        potentialCandidates: [
          {
            age: 19,
            attributes: [],
            currentAbility: 120,
            currentDistance: 1.5,
            fmId: "potential-fm-1",
            name: "Potential Candidate",
            positionRating: 17,
            potentialAbility: 190,
            rank: 1,
            sourceRecordId: "potential-source-1",
          },
        ],
      })
    );

    const [projection] =
      playerRecommendationEvidenceProjections(resultJson, "saved", 1) ?? [];

    if (projection === undefined) {
      throw new Error(
        "The player recommendation should have evidence batches."
      );
    }

    const observer = captureProjection(
      "player_recommendation",
      "player-projection-turn",
      userMessage,
      projection.projectionJson
    );

    const observedProjection = observer.deliveredEvidence[0]?.projection;

    expect(observedProjection).toStrictEqual({
      batchCount: 3,
      batchIndex: 0,
      candidateRefs: ["currentCandidates[0]"],
      currentCandidateCount: 2,
      kind: "player_recommendation",
      potentialCandidateCount: 1,
      potentialListStatus: "requested",
      resultDigest: createHash("sha256").update(resultJson).digest("hex"),
    });
    expect(
      observer.deliveredEvidence.every(
        ({ projection: candidateProjection }) =>
          JSON.stringify(candidateProjection) ===
          JSON.stringify(observedProjection)
      )
    ).toBeTruthy();
  });

  it("records the team roster mapping, exact exclusions, and both candidate lists", () => {
    const userMessage = "Explain the saved team recommendation.";
    const { resultJson } = teamRecommendationEvidenceFixture();

    const [projection] =
      teamRecommendationEvidenceProjections(resultJson, "saved", 3) ?? [];

    if (projection === undefined) {
      throw new Error("The team recommendation should have evidence batches.");
    }

    const observer = captureProjection(
      "team_recommendation",
      "team-projection-turn",
      userMessage,
      projection.projectionJson
    );

    expect(observer.deliveredEvidence[0]?.projection).toStrictEqual({
      batchCount: 3,
      batchIndex: 0,
      candidateRefs: [
        "recommendation.currentCandidates[0]",
        "recommendation.currentCandidates[1]",
        "recommendation.currentCandidates[2]",
      ],
      completedCandidateRefs: [],
      currentCandidateCount: 5,
      currentRosterMembers: [
        {
          apiFootballPlayerId: 11,
          fmId: "roster-fm-1",
          mappingMethod: "reep_bridge",
        },
        {
          apiFootballPlayerId: 12,
          fmId: "roster-fm-2",
          mappingMethod: "user_confirmation",
        },
      ],
      effectiveExcludedFmIds: [
        "roster-fm-1",
        "roster-fm-2",
        "linked-roster-fm-1",
        "linked-roster-fm-2",
      ],
      fmSnapshotDate: "2025-11-23",
      kind: "team_recommendation",
      potentialCandidateCount: 4,
      rankingBasis: "equal_weight_mean_of_position_capable_squad_profiles",
      remainingCandidateRefs: [
        "recommendation.currentCandidates[3]",
        "recommendation.currentCandidates[4]",
        "recommendation.potentialCandidates[0]",
        "recommendation.potentialCandidates[1]",
        "recommendation.potentialCandidates[2]",
        "recommendation.potentialCandidates[3]",
      ],
      resultDigest: createHash("sha256").update(resultJson).digest("hex"),
      rosterRetrievedAt: "2026-10-26T10:00:00.000Z",
      rosterSource: "API-Football",
      teamId: 42,
    });
  });
});
