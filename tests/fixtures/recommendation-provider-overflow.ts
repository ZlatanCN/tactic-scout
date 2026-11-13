import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod/v4";

import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../src/state.js";
import { teamRecommendationResultSchema } from "../../src/team-data/recommendation-result.js";
import { agentGraphTest } from "./agent-graph.js";
import { teamRecommendationEvidenceFixture } from "./team-recommendation-evidence.js";
import { recommendationResultData } from "./workflow-results.js";

const recommendationCandidate = (name: string, index: number) => ({
  age: 20 + index,
  attributes: [],
  currentAbility: 120 + index,
  currentDistance: 0.2 + index / 10,
  fmId: `fm-${name.toLowerCase().replaceAll(" ", "-")}`,
  name,
  positionRating: 18 + index,
  potentialAbility: 150 + index,
  rank: index + 1,
  sourceRecordId: `source-${name.toLowerCase().replaceAll(" ", "-")}`,
});

type OverflowCandidate = {
  age: number | null;
  currentAbility: number | null;
  currentDistance: number;
  fmId: string;
  name: string;
  positionRating: number;
  potentialAbility: number | null;
  rank: number;
};

const projectionJsonSchema = z.json();

type ProjectionJson = z.output<typeof projectionJsonSchema>;

const recommendationOverflowError = () =>
  Object.assign(new Error("The request exceeds the maximum context length."), {
    code: "context_length_exceeded",
    status: 400,
  });

const projectionFromCall = (
  messages: BaseMessage[],
  marker: string
): ProjectionJson => {
  const humanMessage = messages.find(
    (message) => message instanceof HumanMessage
  );

  const content = z.string().parse(humanMessage?.content);
  const [projectionJson] = content.split(marker).slice(1);

  if (projectionJson === undefined) {
    throw new Error(`The model call did not contain ${marker}.`);
  }

  return projectionJsonSchema.parse(JSON.parse(projectionJson));
};

const recommendationBatchResponse =
  (
    marker: string,
    projectionCandidates: (value: ProjectionJson) => OverflowCandidate[],
    maximumCandidatesPerRequest = 1,
    failureMode: "context_overflow" | "output_truncated" = "context_overflow"
  ) =>
  (messages: BaseMessage[]) => {
    const candidates = projectionCandidates(
      projectionFromCall(messages, marker)
    );

    if (candidates.length > maximumCandidatesPerRequest) {
      return failureMode === "output_truncated"
        ? new AIMessage({
            content: "PARTIAL_TRUNCATED_RECOMMENDATION_EXPLANATION",
            response_metadata: { finish_reason: "length" },
            usage_metadata: {
              input_tokens: 101,
              output_tokens: 256,
              total_tokens: 357,
            },
          })
        : recommendationOverflowError();
    }

    if (candidates.length === 0) {
      return new Error("The recommendation batch is empty.");
    }

    return new AIMessage(
      candidates
        .map(
          (candidate) =>
            `${candidate.rank}. ${candidate.name} (FM ID ${candidate.fmId}; age ${candidate.age}; position rating ${candidate.positionRating}; CA ${candidate.currentAbility}; PA ${candidate.potentialAbility}; currentDistance ${candidate.currentDistance})`
        )
        .join("\n")
    );
  };

const playerRecommendationOverflowScenario = () => {
  const currentCandidates = [
    recommendationCandidate("Current Candidate Alpha", 0),
    recommendationCandidate("Current Candidate Beta", 1),
  ];

  const potentialCandidates = [
    recommendationCandidate("Potential Prospect Alpha", 0),
    recommendationCandidate("Potential Prospect Beta", 1),
  ];

  const resultJson = JSON.stringify(
    recommendationResultData("ready", "stc", {
      currentCandidates,
      filterCounts: {
        afterAge: 4,
        afterCurrentAbility: 2,
        afterIdentityExclusion: 4,
        afterPotentialAbility: 2,
        currentAttributeComplete: 4,
        eligiblePositionProfiles: 4,
        excludedMissingAttribute: 0,
        excludedMissingFmIdCandidates: 0,
        excludedMissingPotentialForPotentialList: 0,
      },
      filters: {
        includePotential: true,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: 150,
        resultLimit: 2,
      },
      potentialCandidates,
    })
  );

  const reference = agentGraphTest.playerCandidate("Reference Player", "ref");

  const message = new HumanMessage({
    content: "Explain the saved current and potential recommendation lists.",
    id: "saved-two-list-player-recommendation-overflow",
  });

  const state = AgentState.parse({
    conversationContext: {
      ...createInitialConversationContext(),
      activeRecommendation: {
        excludePlayers: [],
        includePotential: true,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: 150,
        position: "stc",
        referencePlayers: [
          agentGraphTest.conversationReferenceFromCandidate(reference),
        ],
        resultJson,
        resultLimit: 2,
        status: "ready",
      },
    },
    messages: [message],
    outcome: {
      kind: "player_recommendation",
      resultJson,
      source: "saved",
      status: "ready",
    },
    request: {
      ...createInitialRequestState(),
      processedMessageId: message.id,
    },
    stateSchemaVersion: agentStateSchemaVersion,
  });

  return { currentCandidates, potentialCandidates, resultJson, state };
};

const teamRecommendationOverflowScenario = () => {
  const fixture = teamRecommendationEvidenceFixture();

  const base = teamRecommendationResultSchema.parse(
    JSON.parse(fixture.resultJson)
  );

  if (!("recommendation" in base) || base.recommendation.status !== "ready") {
    throw new Error("The team recommendation fixture must be complete.");
  }

  const currentCandidates = [
    recommendationCandidate("Team Candidate Alpha", 0),
    recommendationCandidate("Team Candidate Beta", 1),
  ];

  const potentialCandidates = [
    recommendationCandidate("Team Prospect Alpha", 0),
  ];

  const filters = {
    ...base.filters,
    includePotential: true,
    minimumPotentialAbility: 150,
    resultLimit: 2,
  };

  const nestedFilters = {
    ...base.recommendation.filters,
    includePotential: true,
    minimumPotentialAbility: 150,
    resultLimit: 2,
  };

  const resultJson = JSON.stringify(
    teamRecommendationResultSchema.parse({
      ...base,
      filters,
      recommendation: {
        ...base.recommendation,
        currentCandidates,
        filters: nestedFilters,
        potentialCandidates,
      },
    })
  );

  const parsed = teamRecommendationResultSchema.parse(JSON.parse(resultJson));

  if (
    !("recommendation" in parsed) ||
    parsed.recommendation.status !== "ready"
  ) {
    throw new Error("The saved team recommendation must be complete.");
  }

  const message = new HumanMessage({
    content:
      "Explain the saved current and potential team recommendation lists.",
    id: "saved-two-list-team-recommendation-overflow",
  });

  const roster = {
    members: (parsed.exclusionScope?.currentRosterMembers ?? []).map(
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
    retrievedAt: parsed.roster.retrievedAt,
    team: parsed.team,
  };

  const state = AgentState.parse({
    conversationContext: {
      ...createInitialConversationContext(),
      activeTeamRecommendation: {
        includePotential: true,
        maxAge: filters.maxAge,
        minimumCurrentAbility: filters.minimumCurrentAbility,
        minimumPotentialAbility: filters.minimumPotentialAbility,
        position: parsed.position,
        referenceMode: "squad",
        referencePlayers: [],
        resultJson,
        resultLimit: 2,
        roster,
        status: "ready",
        team: parsed.team,
      },
    },
    messages: [message],
    outcome: {
      kind: "team_recommendation",
      resultJson,
      source: "saved",
      status: "ready",
    },
    request: {
      ...createInitialRequestState(),
      processedMessageId: message.id,
    },
    stateSchemaVersion: agentStateSchemaVersion,
  });

  return { currentCandidates, potentialCandidates, resultJson, state };
};

const recommendationProviderOverflowTest = {
  playerRecommendationOverflowScenario,
  recommendationBatchResponse,
  recommendationCandidate,
  teamRecommendationOverflowScenario,
};

export { recommendationProviderOverflowTest };
