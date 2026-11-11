import type { BaseMessage } from "@langchain/core/messages";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { assessModelRequest } from "../../src/model-context.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../src/state.js";
import type { ApiFootballClient } from "../../src/team-data/api-football.js";
import { teamRecommendationResultSchema } from "../../src/team-data/recommendation-result.js";
import type { RecommendTeamPlayerCandidates } from "../../src/tools/recommend-team-player-candidates.js";
import { createRecommendTeamPlayerCandidatesTool } from "../../src/tools/recommend-team-player-candidates.js";
import { agentGraphTest } from "../fixtures/agent-graph.js";
import { testModelOutputLimitAdapter } from "../fixtures/model-context.js";
import { teamRecommendationEvidenceFixture } from "../fixtures/team-recommendation-evidence.js";

const teamCandidate = (list: "current" | "potential", index: number) => ({
  age: 19 + (index % 10),
  attributes: [
    {
      attribute: "pace",
      candidateValue: 60 + index,
      difference: index / 10,
      referenceMean: 59 + index,
    },
  ],
  currentAbility: 120 + index,
  currentDistance: Number((index / 10).toFixed(2)),
  fmId: `fm-${list}-${String(index + 1).padStart(2, "0")}`,
  name: `${list} Candidate ${String(index + 1).padStart(2, "0")}`,
  positionRating: 15 + (index % 6),
  potentialAbility: 150 + index,
  rank: index + 1,
  sourceRecordId: `source-${list}-${String(index + 1).padStart(2, "0")}`,
});

const teamCandidateProjectionSchema = z.object({
  age: z.number().nullable(),
  currentAbility: z.number().nullable(),
  currentDistance: z.number(),
  fmId: z.string(),
  name: z.string(),
  positionRating: z.number(),
  potentialAbility: z.number().nullable(),
  rank: z.number(),
});

const teamCandidateLine = (
  candidate: z.output<typeof teamCandidateProjectionSchema>
): string =>
  `${candidate.rank}. ${candidate.name} (FM ID ${candidate.fmId}; age ${candidate.age}; position rating ${candidate.positionRating}; CA ${candidate.currentAbility}; PA ${candidate.potentialAbility}; currentDistance ${candidate.currentDistance})`;

const teamRecommendationResultJson = () => {
  const { resultJson } = teamRecommendationEvidenceFixture();
  const base = teamRecommendationResultSchema.parse(JSON.parse(resultJson));

  if (!("recommendation" in base)) {
    throw new Error(
      "The team recommendation fixture must contain ranked lists."
    );
  }

  const { recommendation } = base;

  if (
    recommendation.status !== "ready" &&
    recommendation.status !== "no_candidates"
  ) {
    throw new Error("The saved team recommendation fixture must be complete.");
  }

  return JSON.stringify(
    teamRecommendationResultSchema.parse({
      ...base,
      recommendation: {
        ...recommendation,
        currentCandidates: Array.from({ length: 20 }, (_unused, index) =>
          teamCandidate("current", index)
        ),
        potentialCandidates: Array.from({ length: 20 }, (_unused, index) =>
          teamCandidate("potential", index)
        ),
      },
    })
  );
};

const savedTeamRecommendationState = (resultJson: string) => {
  const parsedResult = teamRecommendationResultSchema.parse(
    JSON.parse(resultJson)
  );

  if (!("recommendation" in parsedResult)) {
    throw new Error("The saved team recommendation result is missing.");
  }

  const message = new HumanMessage({
    content: "Explain the saved team recommendation.",
    id: "saved-team-recommendation-evidence",
  });

  const { exclusionScope, team } = parsedResult;

  const roster = {
    members: (exclusionScope?.currentRosterMembers ?? []).map(
      ({ apiFootballPlayerId, fmId, mappingMethod }, index) => ({
        apiFootballPlayerId,
        fmCandidates: [],
        fmId,
        mappingMethod,
        mappingStatus: "resolved" as const,
        name: `Roster Player ${index + 1}`,
        position: "STC",
      })
    ),
    retrievedAt: parsedResult.roster.retrievedAt,
    team,
  };

  return AgentState.parse({
    conversationContext: {
      ...createInitialConversationContext(),
      activeTeamRecommendation: {
        includePotential: parsedResult.filters.includePotential,
        maxAge: parsedResult.filters.maxAge,
        minimumCurrentAbility: parsedResult.filters.minimumCurrentAbility,
        minimumPotentialAbility: parsedResult.filters.minimumPotentialAbility,
        position: parsedResult.position,
        referenceMode: "squad",
        referencePlayers: [],
        resultJson,
        resultLimit: parsedResult.filters.resultLimit,
        roster,
        status: parsedResult.status,
        team,
      },
    },
    messages: [message],
    outcome: {
      kind: "team_recommendation",
      resultJson,
      source: "saved",
      status: parsedResult.status,
    },
    request: {
      ...createInitialRequestState(),
      processedMessageId: message.id,
    },
    stateSchemaVersion: agentStateSchemaVersion,
  });
};

describe("team recommendation evidence delivery through the full graph", () => {
  it("explains both saved ranked lists with exact roster exclusions and without refetching", async () => {
    const resultJson = teamRecommendationResultJson();
    const modelInputs: BaseMessage[][] = [];

    const dynamicModelResponse = (messages: BaseMessage[]) => {
      modelInputs.push(messages);

      const humanMessage = messages.find(
        (message) => message instanceof HumanMessage
      );

      const content = z.string().parse(humanMessage?.content);
      const marker = "Team recommendation evidence projection JSON:\n";
      const markerIndex = content.indexOf(marker);

      if (markerIndex === -1) {
        throw new Error(
          "The graph must send a bounded team recommendation projection."
        );
      }

      const projection = z
        .object({
          currentCandidates: z.array(teamCandidateProjectionSchema),
          exclusionScope: z.object({
            currentRosterMembers: z.array(
              z.object({
                apiFootballPlayerId: z.number(),
                fmId: z.string(),
                mappingMethod: z.string(),
              })
            ),
            effectiveExcludedFmIds: z.array(z.string()),
          }),
          fmSnapshotDate: z.string().nullable(),
          position: z.string(),
          potentialCandidates: z
            .array(teamCandidateProjectionSchema)
            .nullable(),
          rankingBasis: z.string(),
          rankingContext: z.object({
            ageAsOfDate: z.string(),
            filterCounts: z.record(z.string(), z.number()),
            snapshotDate: z.string(),
          }),
          roster: z.object({
            mappedMembers: z.number(),
            retrievedAt: z.string(),
            source: z.string(),
            totalMembers: z.number(),
          }),
          team: z.object({
            id: z.number(),
            name: z.string(),
          }),
        })
        .parse(JSON.parse(content.slice(markerIndex + marker.length)));

      const currentLines = projection.currentCandidates.map(teamCandidateLine);

      const potentialLines = (projection.potentialCandidates ?? []).map(
        teamCandidateLine
      );

      const excludedIds =
        projection.exclusionScope.effectiveExcludedFmIds.join(", ");

      const rosterMappings = projection.exclusionScope.currentRosterMembers
        .map(
          ({ apiFootballPlayerId, fmId, mappingMethod }) =>
            `${apiFootballPlayerId} ${fmId} ${mappingMethod}`
        )
        .join(", ");

      return new AIMessage(
        [
          `${projection.team.name} (${projection.team.id}) ${projection.position}`,
          `Roster ${projection.roster.source} ${projection.roster.retrievedAt}: ${projection.roster.mappedMembers}/${projection.roster.totalMembers} mapped.`,
          `FM snapshot ${projection.fmSnapshotDate}; age date ${projection.rankingContext.ageAsOfDate}; ranking ${projection.rankingBasis}; snapshot ${projection.rankingContext.snapshotDate}.`,
          `Roster mappings ${rosterMappings}; excluded FM IDs ${excludedIds}.`,
          `Stage counts ${JSON.stringify(projection.rankingContext.filterCounts)}.`,
          "Current-ability similarity candidates:",
          ...currentLines,
          "High-potential candidates:",
          ...potentialLines,
        ].join("\n")
      );
    };

    const model = Object.assign(fakeModel(), {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    });

    for (let responseIndex = 0; responseIndex < 50; responseIndex += 1) {
      model.respond(dynamicModelResponse);
    }

    const ranker = vi.fn<RecommendTeamPlayerCandidates>(() => {
      throw new Error("Saved team recommendation explanation must not rerank.");
    });

    const searchTeams = vi.fn<ApiFootballClient["searchTeams"]>(() => {
      throw new Error("Saved team recommendation must not search providers.");
    });

    const getSquad = vi.fn<ApiFootballClient["getSquad"]>(() => {
      throw new Error("Saved team recommendation must not refetch a roster.");
    });

    const modelContextProfile = {
      countingMarginTokens: 64,
      maxInputTokens: 2400,
      maxOutputTokens: 512,
      softTriggerFraction: 0.9,
      targetFraction: 0.6,
    };

    const graph = agentGraphTest.createAgent({
      model,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      teamDirectory: { getSquad, searchTeams },
      tools: [createRecommendTeamPlayerCandidatesTool(ranker)],
    });

    const result = await graph.invoke(
      savedTeamRecommendationState(resultJson),
      { configurable: { thread_id: "saved-team-recommendation-batches" } }
    );

    const answer = z.string().parse(result.messages.at(-1)?.content);

    const projectionInputs = modelInputs.map((messages) => {
      const humanMessage = messages.find(
        (message) => message instanceof HumanMessage
      );

      const content = z.string().parse(humanMessage?.content);
      const marker = "Team recommendation evidence projection JSON:\n";
      const markerIndex = content.indexOf(marker);

      if (markerIndex === -1) {
        throw new Error(
          "Every team batch call must include its evidence projection."
        );
      }

      return z
        .object({
          batch: z.object({ candidateRefs: z.array(z.string()) }),
          candidateCoverage: z.object({
            currentCandidateCount: z.number(),
            potentialCandidateCount: z.number().nullable(),
          }),
          currentCandidates: z.array(
            z.object({ fmId: z.string(), rank: z.number() })
          ),
          exclusionScope: z.object({
            effectiveExcludedFmIds: z.array(z.string()),
          }),
          potentialCandidates: z
            .array(z.object({ fmId: z.string(), rank: z.number() }))
            .nullable(),
        })
        .parse(JSON.parse(content.slice(markerIndex + marker.length)));
    });

    const firstSystemMessage = modelInputs[0]?.find(
      (message) => message instanceof SystemMessage
    );

    if (firstSystemMessage === undefined) {
      throw new Error("The team evidence batch should have a system prompt.");
    }

    const unbatchedAssessment = await assessModelRequest(
      model,
      {
        messages: [
          firstSystemMessage,
          new HumanMessage(
            `用户请求：Explain the saved team recommendation.\n\n结构化工具结果：\n${resultJson}`
          ),
        ],
        purpose: "answer",
      },
      {
        outputLimitAdapter: testModelOutputLimitAdapter,
        profile: modelContextProfile,
      }
    );

    const batchAssessments = await Promise.all(
      modelInputs.map(
        async (messages) =>
          await assessModelRequest(
            model,
            { messages, purpose: "answer" },
            {
              outputLimitAdapter: testModelOutputLimitAdapter,
              profile: modelContextProfile,
            }
          )
      )
    );

    expect({
      additionalCallsWithinDefaultGrant:
        (result.contextProcessing.allowance?.consumedAdditionalCalls ?? 7) <= 6,
      allCandidatesDelivered: [
        ...Array.from({ length: 20 }, (_unused, index) =>
          teamCandidate("current", index)
        ),
        ...Array.from({ length: 20 }, (_unused, index) =>
          teamCandidate("potential", index)
        ),
      ].every(
        ({
          age,
          currentAbility,
          currentDistance,
          fmId,
          name,
          positionRating,
          potentialAbility,
          rank,
        }) =>
          [
            name,
            fmId,
            String(age),
            String(currentAbility),
            String(currentDistance),
            String(positionRating),
            String(potentialAbility),
            String(rank),
          ].every((value) => answer.includes(value))
      ),
      batchesFit: batchAssessments.every(({ failure }) => failure === null),
      candidateCountsPreserved: projectionInputs.every(
        ({ candidateCoverage }) =>
          candidateCoverage.currentCandidateCount === 20 &&
          candidateCoverage.potentialCandidateCount === 20
      ),
      exactExclusionScopePreserved: projectionInputs.every(
        ({ exclusionScope }) =>
          exclusionScope.effectiveExcludedFmIds.includes("roster-fm-1") &&
          exclusionScope.effectiveExcludedFmIds.includes("roster-fm-2") &&
          exclusionScope.effectiveExcludedFmIds.includes("linked-roster-fm-1")
      ),
      modelCalls: modelInputs.length,
      orderedRefs: projectionInputs.every(
        ({ batch, currentCandidates, potentialCandidates }) =>
          batch.candidateRefs.every((reference, index) => {
            const expected = reference.startsWith(
              "recommendation.currentCandidates["
            )
              ? currentCandidates.find(({ rank }) =>
                  reference.endsWith(`[${rank - 1}]`)
                )
              : potentialCandidates?.find(({ rank }) =>
                  reference.endsWith(`[${rank - 1}]`)
                );

            return (
              expected !== undefined &&
              expected.rank > 0 &&
              currentCandidates.length + (potentialCandidates?.length ?? 0) >
                index
            );
          })
      ),
      providerCalls: searchTeams.mock.calls.length + getSquad.mock.calls.length,
      rankerCalls: ranker.mock.calls.length,
      rosterDateDisplayed: answer.includes("2026-10-26T10:00:00.000Z"),
      savedOutcome:
        result.outcome !== null && "source" in result.outcome
          ? result.outcome.source
          : null,
      storedEvidenceStatus: result.teamRecommendationEvidence?.status,
      teamNameDisplayed: answer.includes("Synthetic FC"),
      unbatchedNeedsProcessing:
        unbatchedAssessment.failure !== null ||
        unbatchedAssessment.assessment.compactionSuggested,
    }).toMatchObject({
      additionalCallsWithinDefaultGrant: true,
      allCandidatesDelivered: true,
      batchesFit: true,
      candidateCountsPreserved: true,
      exactExclusionScopePreserved: true,
      providerCalls: 0,
      rankerCalls: 0,
      rosterDateDisplayed: true,
      savedOutcome: "saved",
      storedEvidenceStatus: "complete",
      teamNameDisplayed: true,
      unbatchedNeedsProcessing: true,
    });
    expect(modelInputs.length).toBeGreaterThan(1);
  });

  it("renders every saved candidate and exclusion scope when the grant stops early", async () => {
    const resultJson = teamRecommendationResultJson();

    const model = Object.assign(
      fakeModel().respond(
        new AIMessage("Only the first team batch is explained.")
      ),
      {
        getNumTokens: async (text: string) => {
          await Promise.resolve();

          return Math.ceil(text.length / 4);
        },
      }
    );

    const ranker = vi.fn<RecommendTeamPlayerCandidates>(() => {
      throw new Error("Saved team recommendation explanation must not rerank.");
    });

    const searchTeams = vi.fn<ApiFootballClient["searchTeams"]>(() => {
      throw new Error("Saved team recommendation must not search providers.");
    });

    const getSquad = vi.fn<ApiFootballClient["getSquad"]>(() => {
      throw new Error("Saved team recommendation must not refetch a roster.");
    });

    const graph = agentGraphTest.createAgent({
      contextProcessingAllowance: { maxAdditionalCalls: 1 },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 2400,
        maxOutputTokens: 512,
        softTriggerFraction: 0.9,
        targetFraction: 0.6,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      teamDirectory: { getSquad, searchTeams },
      tools: [createRecommendTeamPlayerCandidatesTool(ranker)],
    });

    const result = await graph.invoke(
      savedTeamRecommendationState(resultJson),
      {
        configurable: { thread_id: "saved-team-recommendation-quota" },
      }
    );

    const answer = z.string().parse(result.messages.at(-1)?.content);

    const everyCandidate = [
      ...Array.from({ length: 20 }, (_unused, index) =>
        teamCandidate("current", index)
      ),
      ...Array.from({ length: 20 }, (_unused, index) =>
        teamCandidate("potential", index)
      ),
    ];

    expect({
      allCandidateRowsRemainAvailable: everyCandidate.every(
        ({
          age,
          currentAbility,
          currentDistance,
          fmId,
          name,
          positionRating,
          potentialAbility,
          rank,
        }) =>
          [
            `${rank}. ${name}`,
            fmId,
            String(age),
            String(positionRating),
            String(currentAbility),
            String(potentialAbility),
            String(currentDistance),
          ].every((value) => answer.includes(value))
      ),
      exactExclusionScopeRemainsAvailable:
        answer.includes("FM IDs actually excluded during calculation") &&
        answer.includes("linked-roster-fm-1"),
      explanationIsMarkedIncomplete: answer.includes("分批解释未完成"),
      modelCalls: model.callCount,
      providerCalls: searchTeams.mock.calls.length + getSquad.mock.calls.length,
      rankerCalls: ranker.mock.calls.length,
      resultSnapshotIsPreserved:
        result.conversationContext.activeTeamRecommendation?.resultJson ===
        resultJson,
      status: result.teamRecommendationEvidence?.status,
    }).toStrictEqual({
      allCandidateRowsRemainAvailable: true,
      exactExclusionScopeRemainsAvailable: true,
      explanationIsMarkedIncomplete: true,
      modelCalls: 1,
      providerCalls: 0,
      rankerCalls: 0,
      resultSnapshotIsPreserved: true,
      status: "allowance_exhausted",
    });
  });
});
