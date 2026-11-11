import { createHash } from "node:crypto";

import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { contextProcessingHash } from "../../src/context-processing-state.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../src/state.js";
import { teamRecommendationResultSchema } from "../../src/team-data/recommendation-result.js";
import { teamRecommendationEvidenceProjections } from "../../src/team-recommendation-evidence.js";
import {
  apiThreadSchema,
  postJson,
  startDevServerSession,
  waitResponseSchema,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";
import { teamRecommendationEvidenceFixture } from "../fixtures/team-recommendation-evidence.js";

const evidenceStateSchema = z.object({
  batches: z.array(
    z.object({
      answer: z.string().nullable(),
      index: z.number(),
      projectionJson: z.string(),
      recordRefs: z.array(z.string()),
      status: z.string(),
    })
  ),
  failureReason: z.string().nullable(),
  requestId: z.string(),
  resultDigest: z.string(),
  source: z.string(),
  sourceHash: z.string(),
  sourceMessageId: z.string(),
  status: z.string(),
});

const batchStatus = (index: number) => {
  if (index === 0) {
    return "ready" as const;
  }

  if (index === 1) {
    return "reserved" as const;
  }

  return "pending" as const;
};

describe("team recommendation evidence recovery", () => {
  it("preserves saved ranking and settles an unknown batch after a managed restart", async () => {
    const session = await startDevServerSession();
    const { baseUrl, gateway } = session;

    const thread = await postJson(
      baseUrl,
      "/threads",
      apiThreadSchema,
      JSON.stringify({ metadata: { graph_id: "agent" } })
    );

    const { resultJson } = teamRecommendationEvidenceFixture();

    const completed = teamRecommendationResultSchema.parse(
      JSON.parse(resultJson)
    );

    if (
      !("recommendation" in completed) ||
      completed.exclusionScope === undefined
    ) {
      throw new Error("The recovery fixture needs a complete exclusion scope.");
    }

    const messageId = "saved-team-recommendation-evidence-restart";
    const question = "Explain the saved team recommendation.";

    const projections = teamRecommendationEvidenceProjections(
      resultJson,
      "saved",
      2
    );

    if (projections === null || projections.length < 2) {
      throw new Error(
        "The recovery fixture needs multiple team evidence batches."
      );
    }

    const resultDigest = createHash("sha256").update(resultJson).digest("hex");
    const questionHash = contextProcessingHash(question);
    const requestId = `message:${messageId}`;

    const sourceHash = contextProcessingHash(
      `saved:${messageId}:${resultDigest}:${questionHash}:team-recommendation-evidence-v1`
    );

    const roster = {
      members: completed.exclusionScope.currentRosterMembers.map(
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
      retrievedAt: completed.roster.retrievedAt,
      team: completed.team,
    };

    const reservation = {
      chunkIndex: 1,
      maxActiveTimeMs: 119_900,
      maxAdditionalCalls: 1,
      operation: "explain_team_recommendation_evidence" as const,
      operationId: contextProcessingHash(`${requestId}:${sourceHash}:batch:1`),
      sourceHash,
      sourceMessageId: messageId,
    };

    const seededState = AgentState.parse({
      contextProcessing: {
        allowance: {
          consumedActiveTimeMs: 100,
          consumedAdditionalCalls: 1,
          maxActiveTimeMs: 120_000,
          maxAdditionalCalls: 6,
          requestId,
          reservation,
        },
        clarification: null,
        compaction: null,
      },
      conversationContext: {
        ...createInitialConversationContext(),
        activeTeamRecommendation: {
          ...completed.filters,
          position: completed.position,
          referenceMode: "squad",
          referencePlayers: [],
          resultJson,
          resultLimit: completed.filters.resultLimit,
          roster,
          status: completed.status,
          team: completed.team,
        },
      },
      messages: [new HumanMessage({ content: question, id: messageId })],
      outcome: {
        kind: "team_recommendation",
        resultJson,
        source: "saved",
        status: completed.status,
      },
      request: {
        ...createInitialRequestState(),
        kind: "team_recommendation",
        players: [],
        processedMessageId: messageId,
        teamRecommendation: {
          ...completed.filters,
          position: completed.position,
          referenceMode: "squad",
          roster,
          team: completed.team,
          teamName: completed.team.name,
          teamSearchName: null,
        },
        teamRecommendationAction: "refine",
        teams: [completed.team.name],
      },
      stateSchemaVersion: agentStateSchemaVersion,
      teamRecommendationEvidence: {
        batches: projections.map((projection, index) => ({
          answer: index === 0 ? "The first saved batch is ready." : null,
          index,
          projectionJson: projection.projectionJson,
          recordRefs: projection.recordRefs,
          status: batchStatus(index),
        })),
        failureReason: null,
        questionHash,
        requestId,
        resultDigest,
        source: "saved",
        sourceHash,
        sourceMessageId: messageId,
        status: "processing",
      },
    });

    try {
      await postJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({
          values: {
            ...seededState,
            messages: [{ content: question, id: messageId, type: "human" }],
          },
        })
      );

      const eventsBeforeRestart = gateway.events();
      const callsBeforeRestart = gateway.calls().length;

      await session.restart();

      const restored = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      const restoredEvidence = evidenceStateSchema.parse(
        restored.values.teamRecommendationEvidence
      );

      expect({
        allowanceCalls:
          restored.values.contextProcessing?.allowance?.consumedAdditionalCalls,
        batchStatuses: restoredEvidence.batches.map(({ status }) => status),
        savedSnapshot:
          restored.values.conversationContext.activeTeamRecommendation
            ?.resultJson,
      }).toStrictEqual({
        allowanceCalls: 1,
        batchStatuses: ["ready", "reserved", "pending", "pending", "pending"],
        savedSnapshot: resultJson,
      });

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        question,
        messageId
      );

      const settled = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      const answer = managedDevServerTest.latestAssistantText(settled);

      const settledEvidence = evidenceStateSchema.parse(
        settled.values.teamRecommendationEvidence
      );

      expect({
        activeTimeMs:
          settled.values.contextProcessing?.allowance?.consumedActiveTimeMs,
        allowanceCalls:
          settled.values.contextProcessing?.allowance?.consumedAdditionalCalls,
        answerHasExclusionIds: answer.includes("linked-roster-fm-1"),
        answerHasFullCandidate: answer.includes("Current Prospect 1"),
        evidenceStatus: settledEvidence.status,
        evidenceStatuses: settledEvidence.batches.map(({ status }) => status),
        modelCalls: gateway.calls().length,
        providerEvents: gateway.events(),
        reservation: settled.values.contextProcessing?.allowance?.reservation,
        savedSnapshot:
          settled.values.conversationContext.activeTeamRecommendation
            ?.resultJson,
      }).toStrictEqual({
        activeTimeMs: 120_000,
        allowanceCalls: 2,
        answerHasExclusionIds: true,
        answerHasFullCandidate: true,
        evidenceStatus: "failed",
        evidenceStatuses: ["ready", "failed", "pending", "pending", "pending"],
        modelCalls: callsBeforeRestart,
        providerEvents: eventsBeforeRestart,
        reservation: null,
        savedSnapshot: resultJson,
      });
    } finally {
      await session.close();
    }
  }, 90_000);
});
