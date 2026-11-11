import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { evaluationWorkerRequestSchema } from "../../../evals/contracts.js";
import { createEvaluationObserver } from "../../../evals/observation.js";
import {
  completeRecommendationResultAnswer,
  completeTeamRecommendationResultAnswer,
} from "../../../src/recommendation-answer.js";
import { AgentState, agentStateSchemaVersion } from "../../../src/state.js";
import { teamRecommendationEvidenceFixture } from "../../fixtures/team-recommendation-evidence.js";
import { recommendationResultData } from "../../fixtures/workflow-results.js";

const evaluationRequest = (turnId: string, userMessage: string) =>
  evaluationWorkerRequestSchema.parse({
    ageAsOfDate: "2026-11-11",
    caseId: "recommendation-fallback",
    caseOrigin: "synthetic",
    databasePaths: {
      fm: "test-fm.sqlite",
      identity: "test-identity.sqlite",
      understat: "test-understat.sqlite",
    },
    declaredTurnFaults: [],
    maxClarificationsPerTurn: 2,
    resultPath: "test-result.json",
    runId: "recommendation-fallback-run",
    threadId: "recommendation-fallback-thread",
    trialId: "recommendation-fallback-trial",
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

describe("deterministic recommendation fallback evidence", () => {
  it("records every saved player candidate used by the full-list fallback", () => {
    const userMessage = "Explain this saved two-list recommendation.";

    const resultJson = JSON.stringify(
      recommendationResultData("ready", "stc", {
        currentCandidates: [
          {
            age: 21,
            attributes: [],
            currentAbility: 140,
            currentDistance: 0.25,
            fmId: "current-fm-one",
            name: "Current Candidate One",
            positionRating: 18,
            potentialAbility: 170,
            rank: 1,
            sourceRecordId: "current-record-one",
          },
          {
            age: 22,
            attributes: [],
            currentAbility: 138,
            currentDistance: 0.5,
            fmId: "current-fm-two",
            name: "Current Candidate Two",
            positionRating: 19,
            potentialAbility: 171,
            rank: 2,
            sourceRecordId: "current-record-two",
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
            fmId: "potential-fm-one",
            name: "Potential Candidate One",
            positionRating: 17,
            potentialAbility: 190,
            rank: 1,
            sourceRecordId: "potential-record-one",
          },
        ],
      })
    );

    const answer = completeRecommendationResultAnswer(resultJson, "en");

    if (answer === null) {
      throw new Error(
        "The completed player recommendation should render fully."
      );
    }

    const request = evaluationRequest("player-render-turn", userMessage);

    const state = AgentState.parse({
      messages: [
        new HumanMessage(userMessage),
        new AIMessage(
          `推荐数据已完整验证，但分批解释未完成。以下是完整名单和来源：\n\n${answer}`
        ),
      ],
      outcome: {
        kind: "player_recommendation",
        resultJson,
        source: "saved",
        status: "ready",
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const observer = createEvaluationObserver(request);
    const [turn] = request.turns;

    if (turn === undefined) {
      throw new Error("The observer fixture needs one turn.");
    }

    observer.recordTurn(turn, state, []);

    expect({
      deliveredCount: observer.deliveredEvidence.length,
      renderedFmIds: observer.renderedEvidence
        .filter(({ provider }) => provider === "fm")
        .map(({ sourceId }) => sourceId),
      visibleCompleteLists:
        answer.includes("Current Candidate One") &&
        answer.includes("Current Candidate Two") &&
        answer.includes("Potential Candidate One"),
    }).toMatchObject({
      deliveredCount: 0,
      visibleCompleteLists: true,
    });

    const renderedFmIds = observer.renderedEvidence
      .filter(({ provider }) => provider === "fm")
      .map(({ sourceId }) => sourceId);

    const renderedFmIdSet = new Set(renderedFmIds);

    expect(renderedFmIds.length).toBeGreaterThan(0);
    expect(
      ["current-fm-one", "current-fm-two", "potential-fm-one"].every(
        (sourceId) => renderedFmIdSet.has(sourceId)
      )
    ).toBeTruthy();
  });

  it("records roster, exclusion, and candidate sources used by the team fallback", () => {
    const userMessage = "Explain this saved team recommendation.";
    const { resultJson } = teamRecommendationEvidenceFixture();
    const answer = completeTeamRecommendationResultAnswer(resultJson, "en");

    if (answer === null) {
      throw new Error("The completed team recommendation should render fully.");
    }

    const request = evaluationRequest("team-render-turn", userMessage);

    const state = AgentState.parse({
      messages: [
        new HumanMessage(userMessage),
        new AIMessage(
          `球队推荐数据已完整验证，但分批解释未完成。以下是完整名单和来源：\n\n${answer}`
        ),
      ],
      outcome: {
        kind: "team_recommendation",
        resultJson,
        source: "saved",
        status: "ready",
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const observer = createEvaluationObserver(request);
    const [turn] = request.turns;

    if (turn === undefined) {
      throw new Error("The observer fixture needs one turn.");
    }

    observer.recordTurn(turn, state, []);

    expect({
      deliveredCount: observer.deliveredEvidence.length,
      renderedFmIds: observer.renderedEvidence
        .filter(({ provider }) => provider === "fm")
        .map(({ sourceId }) => sourceId),
      renderedTeamIds: observer.renderedEvidence
        .filter(({ provider }) => provider === "api_football")
        .map(({ sourceId }) => sourceId),
      visibleRosterExclusion: answer.includes("linked-roster-fm-1"),
    }).toMatchObject({
      deliveredCount: 0,
      renderedTeamIds: ["player:11", "player:12", "team:42"],
      visibleRosterExclusion: true,
    });

    const renderedFmIds = observer.renderedEvidence
      .filter(({ provider }) => provider === "fm")
      .map(({ sourceId }) => sourceId);

    const renderedFmIdSet = new Set(renderedFmIds);

    expect(
      [
        "roster-fm-1",
        "roster-fm-2",
        "linked-roster-fm-1",
        "linked-roster-fm-2",
        "fm-current-1",
        "fm-potential-1",
      ].every((sourceId) => renderedFmIdSet.has(sourceId))
    ).toBeTruthy();
  });
});
