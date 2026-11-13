import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod/v4";

import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../src/state.js";
import { agentGraphTest } from "./agent-graph.js";
import { recommendationEvidenceAnswerText } from "./recommendation-evidence-answer.js";
import { recommendationResultData } from "./workflow-results.js";

const candidate = (list: string, index: number) => ({
  age: 19 + (index % 10),
  attributes: [],
  currentAbility: 110 + index,
  currentDistance: Number((index / 10).toFixed(2)),
  fmId: `fm-${list}-${String(index + 1).padStart(2, "0")}`,
  name: `${list} Candidate ${String(index + 1).padStart(2, "0")}`,
  positionRating: 15 + (index % 6),
  potentialAbility: 150 + index,
  rank: index + 1,
  sourceRecordId: `source-${list}-${String(index + 1).padStart(2, "0")}`,
});

const resultJson = JSON.stringify(
  recommendationResultData("ready", "stc", {
    currentCandidates: Array.from({ length: 20 }, (_unused, index) =>
      candidate("current", index)
    ),
    filterCounts: {
      afterAge: 40,
      afterCurrentAbility: 35,
      afterIdentityExclusion: 30,
      afterPotentialAbility: 25,
      currentAttributeComplete: 45,
      eligiblePositionProfiles: 50,
      excludedMissingAttribute: 5,
      excludedMissingFmIdCandidates: 0,
      excludedMissingPotentialForPotentialList: 3,
    },
    filters: {
      includePotential: true,
      maxAge: 25,
      minimumCurrentAbility: null,
      minimumPotentialAbility: 150,
      resultLimit: 20,
    },
    potentialCandidates: Array.from({ length: 20 }, (_unused, index) =>
      candidate("potential", index)
    ),
  })
);

const savedRecommendationState = () => {
  const reference = agentGraphTest.playerCandidate(
    "Synthetic Reference",
    "reference"
  );

  const message = new HumanMessage({
    content: "Explain the saved two-list player recommendation.",
    id: "saved-two-list-recommendation",
  });

  return AgentState.parse({
    conversationContext: {
      ...createInitialConversationContext(),
      activeRecommendation: {
        excludePlayers: [],
        includePotential: true,
        maxAge: 25,
        minimumCurrentAbility: null,
        minimumPotentialAbility: 150,
        position: "stc",
        referencePlayers: [
          agentGraphTest.conversationReferenceFromCandidate(reference),
        ],
        resultJson,
        resultLimit: 20,
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
};

const recommendationBatchAnswer = (messages: BaseMessage[]) => {
  const humanMessage = messages.find(
    (message) => message instanceof HumanMessage
  );

  const content = z.string().parse(humanMessage?.content);
  const marker = "Player recommendation evidence projection JSON:\n";
  const markerIndex = content.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error("The graph must send a bounded recommendation projection.");
  }

  const answer = recommendationEvidenceAnswerText(
    content.slice(markerIndex + marker.length)
  );

  if (answer === null) {
    throw new Error("The recommendation projection is invalid.");
  }

  return new AIMessage(answer);
};

export {
  candidate as playerRecommendationCandidate,
  recommendationBatchAnswer,
  resultJson as playerRecommendationResultJson,
  savedRecommendationState,
};
