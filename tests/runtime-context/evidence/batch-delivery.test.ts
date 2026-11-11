import { createHash } from "node:crypto";

import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { assessModelRequest } from "../../../src/model-context.js";
import { searchPlayerRecordsResultSchema } from "../../../src/player-data/search-records.js";
import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../../src/state.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";

describe("lookup evidence projection and bounded delivery", () => {
  it("explains every saved lookup record in bounded batches without requerying", async () => {
    const player = agentGraphTest.playerCandidate("Mikel Oyarzabal", "mikel");

    const message = new HumanMessage({
      content: "What xA did Understat report across these seasons?",
      id: "saved-lookup-multiple-season-batches",
    });

    const baseResultJson = JSON.stringify({
      identityGroups: {
        canonicalGroups: [
          {
            canonicalIdentityId: "canonical-mikel",
            name: player.name,
            records: [
              {
                identitySourceId: "mikel-understat",
                name: player.name,
                provider: "understat",
                recordId: "mikel-understat",
              },
            ],
          },
        ],
        registryStatus: "available",
        unlinkedRecords: [],
      },
      query: [{ provider: "understat", sourceId: "mikel-understat" }],
      requestedUnderstatSeasonStartYear: null,
      understat: {
        records: [
          {
            appearances: 9,
            assists: 2,
            competition: "La_liga",
            expectedAssists: 0.7,
            expectedGoals: 1.3,
            goals: 2,
            keyPasses: 11,
            minutes: 606,
            nonPenaltyExpectedGoals: 1.3,
            player: player.name,
            position: "F M S",
            season: "2023/24",
            shots: 19,
            source: "Understat",
            sourcePlayerId: "mikel-understat",
            team: "Real Sociedad",
          },
          {
            appearances: 10,
            assists: 3,
            competition: "La_liga",
            expectedAssists: 1.1,
            expectedGoals: 1.8,
            goals: 3,
            keyPasses: 13,
            minutes: 710,
            nonPenaltyExpectedGoals: 1.7,
            player: player.name,
            position: "F M S",
            season: "2024/25",
            shots: 21,
            source: "Understat",
            sourcePlayerId: "mikel-understat",
            team: "Real Sociedad",
          },
          {
            appearances: 11,
            assists: 4,
            competition: "La_liga",
            expectedAssists: 1.6,
            expectedGoals: 2.1,
            goals: 4,
            keyPasses: 15,
            minutes: 805,
            nonPenaltyExpectedGoals: 2,
            player: player.name,
            position: "F M S",
            season: "2025/26",
            shots: 24,
            source: "Understat",
            sourcePlayerId: "mikel-understat",
            team: "Real Sociedad",
          },
        ],
        status: "found",
      },
    });

    const baseResult = searchPlayerRecordsResultSchema.parse(
      JSON.parse(baseResultJson)
    );

    if (
      !("understat" in baseResult) ||
      baseResult.understat?.status !== "found"
    ) {
      throw new Error("The lookup fixture needs Understat records.");
    }

    const understatResult = baseResult.understat;

    const seasons = Array.from({ length: 7 }, (_unused, index) => {
      const startYear = 2022 + index;

      return `${startYear}/${String(startYear + 1).slice(-2)}`;
    });

    const resultJson = JSON.stringify({
      ...baseResult,
      understat: {
        ...understatResult,
        records: seasons.map((season, index) => {
          const baseRecord =
            understatResult.records[index % understatResult.records.length];

          if (baseRecord === undefined) {
            throw new Error("The lookup fixture record is missing.");
          }

          return {
            ...baseRecord,
            appearances: 8 + index,
            assists: 1 + index,
            expectedAssists: 0.5 + index / 10,
            expectedGoals: 1 + index / 10,
            goals: 1 + index,
            keyPasses: 8 + index,
            minutes: 600 + index * 100,
            nonPenaltyExpectedGoals: 0.8 + index / 10,
            season,
            shots: 12 + index,
          };
        }),
      },
    });

    const model = fakeModel();

    for (let start = 0; start < seasons.length; start += 2) {
      const batchSeasons = seasons.slice(start, start + 2);
      model.respond(
        new AIMessage(
          batchSeasons
            .map(
              (season, index) =>
                `The ${season} xA was ${0.5 + (start + index) / 10}.`
            )
            .join(" ")
        )
      );
    }

    const modelInvoke = vi.spyOn(model, "invoke");

    const search = vi.fn<PlayerSearch>(() => {
      throw new Error("Saved evidence must not trigger another provider read.");
    });

    const modelContextProfile = {
      countingMarginTokens: 64,
      maxInputTokens: 1000,
      maxOutputTokens: 256,
      softTriggerFraction: 0.99,
      targetFraction: 0.6,
    };

    const graph = agentGraphTest.createAgent({
      model,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const savedPlayerReference =
      agentGraphTest.conversationReferenceFromCandidate(player);

    const state = AgentState.parse({
      conversationContext: {
        ...createInitialConversationContext(),
        activeLookup: { player: savedPlayerReference, resultJson },
      },
      messages: [message],
      outcome: {
        kind: "player_lookup",
        resultJson,
        source: "saved",
        status: "lookup_follow_up",
      },
      request: {
        ...createInitialRequestState(),
        processedMessageId: message.id,
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const result = await graph.invoke(state, {
      configurable: { thread_id: "saved-lookup-multiple-season-batches" },
    });

    const modelInputs = modelInvoke.mock.calls.map(([input]) =>
      JSON.stringify(input)
    );

    const response = z.string().parse(result.messages.at(-1)?.content);

    const modelMessages = modelInvoke.mock.calls.map(([input]) =>
      z.array(z.instanceof(BaseMessage)).parse(input)
    );

    const [systemMessage] = modelMessages[0] ?? [];

    if (systemMessage === undefined) {
      throw new Error(
        "The lookup evidence batch should include a system prompt."
      );
    }

    const batchAssessments = await Promise.all(
      modelMessages.map(
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

    const unbatchedAssessment = await assessModelRequest(
      model,
      {
        messages: [
          systemMessage,
          new HumanMessage(
            `用户问题：${z.string().parse(message.content)}\n\n结构化工具结果：\n${resultJson}`
          ),
        ],
        purpose: "answer",
      },
      {
        outputLimitAdapter: testModelOutputLimitAdapter,
        profile: modelContextProfile,
      }
    );

    expect(result.contextProcessing.allowance).toMatchObject({
      consumedAdditionalCalls: 4,
      reservation: null,
    });

    expect({
      answers: result.lookupEvidence?.batches.map(({ answer }) => answer),
      batchCoverage: result.lookupEvidence?.batches.map(({ recordRefs }) =>
        recordRefs.join(",")
      ),
      digestMatchesSnapshot:
        result.lookupEvidence?.resultDigest ===
        createHash("sha256").update(resultJson).digest("hex"),
      modelCallCount: modelInvoke.mock.calls.length,
      modelInputsAreBoundedBatches: modelInputs.every((input) => {
        const seasonsInBatch = seasons.filter((season) =>
          input.includes(season)
        ).length;

        return seasonsInBatch > 0 && seasonsInBatch <= 2;
      }),
      modelWindowAblation: {
        batchCompactionSuggested: batchAssessments.map(
          ({ assessment }) => assessment.compactionSuggested
        ),
        batchFailures: batchAssessments.map(({ failure }) => failure),
        unbatchedCompactionSuggested:
          unbatchedAssessment.assessment.compactionSuggested,
        unbatchedFailure: unbatchedAssessment.failure,
      },
      outcome: result.outcome?.status,
      searchCalls: search.mock.calls.length,
      status: result.lookupEvidence?.status,
    }).toStrictEqual({
      answers: [
        "The 2022/23 xA was 0.5. The 2023/24 xA was 0.6.",
        "The 2024/25 xA was 0.7. The 2025/26 xA was 0.8.",
        "The 2026/27 xA was 0.9. The 2027/28 xA was 1.",
        "The 2028/29 xA was 1.1.",
      ],
      batchCoverage: [
        "understat.records[0],understat.records[1]",
        "understat.records[2],understat.records[3]",
        "understat.records[4],understat.records[5]",
        "understat.records[6]",
      ],
      digestMatchesSnapshot: true,
      modelCallCount: 4,
      modelInputsAreBoundedBatches: true,
      modelWindowAblation: {
        batchCompactionSuggested: [false, false, false, false],
        batchFailures: [null, null, null, null],
        unbatchedCompactionSuggested: true,
        unbatchedFailure: "input_exceeds_limit",
      },
      outcome: "lookup_follow_up",
      searchCalls: 0,
      status: "complete",
    });

    for (const season of seasons) {
      expect(response).toContain(season);
    }
  });

  it("renders the complete saved lookup when the evidence grant runs out", async () => {
    const player = agentGraphTest.playerCandidate("Mikel Oyarzabal", "mikel");

    const message = new HumanMessage({
      content: "What xA did Understat report across these seasons?",
      id: "saved-lookup-evidence-quota",
    });

    const record = (season: string, expectedAssists: number) => ({
      appearances: 9,
      assists: 2,
      competition: "La_liga",
      expectedAssists,
      expectedGoals: 1.3,
      goals: 2,
      keyPasses: 11,
      minutes: 606,
      nonPenaltyExpectedGoals: 1.3,
      player: player.name,
      position: "F M S",
      season,
      shots: 19,
      source: "Understat",
      sourcePlayerId: "mikel-understat",
      team: "Real Sociedad",
    });

    const resultJson = JSON.stringify({
      identityGroups: {
        canonicalGroups: [
          {
            canonicalIdentityId: "canonical-mikel",
            name: player.name,
            records: [
              {
                identitySourceId: "mikel-understat",
                name: player.name,
                provider: "understat",
                recordId: "mikel-understat",
              },
            ],
          },
        ],
        registryStatus: "available",
        unlinkedRecords: [],
      },
      query: [{ provider: "understat", sourceId: "mikel-understat" }],
      requestedUnderstatSeasonStartYear: null,
      understat: {
        records: [
          record("2024/25", 0.7),
          record("2025/26", 1.1),
          record("2026/27", 1.5),
        ],
        status: "found",
      },
    });

    const model = fakeModel().respond(
      new AIMessage("Only the first evidence batch was explained.")
    );

    const modelInvoke = vi.spyOn(model, "invoke");

    const search = vi.fn<PlayerSearch>(() => {
      throw new Error("A saved lookup follow-up must not reread the provider.");
    });

    const graph = agentGraphTest.createAgent({
      contextProcessingAllowance: { maxAdditionalCalls: 1 },
      model,
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const state = AgentState.parse({
      conversationContext: {
        ...createInitialConversationContext(),
        activeLookup: {
          player: agentGraphTest.conversationReferenceFromCandidate(player),
          resultJson,
        },
      },
      messages: [message],
      outcome: {
        kind: "player_lookup",
        resultJson,
        source: "saved",
        status: "lookup_follow_up",
      },
      request: {
        ...createInitialRequestState(),
        processedMessageId: message.id,
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const result = await graph.invoke(state, {
      configurable: { thread_id: "saved-lookup-evidence-quota" },
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect(result.contextProcessing.allowance).toMatchObject({
      consumedAdditionalCalls: 1,
      reservation: null,
    });

    expect({
      batchStatuses: result.lookupEvidence?.batches.map(({ status }) => status),
      containsCompleteSnapshot: answer.includes(resultJson),
      containsIncompleteNotice: answer.includes("模型解释未完成"),
      containsPartialModelAnswer: answer.includes(
        "Only the first evidence batch"
      ),
      evidenceStatus: result.lookupEvidence?.status,
      modelCalls: modelInvoke.mock.calls.length,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      batchStatuses: ["ready", "pending"],
      containsCompleteSnapshot: true,
      containsIncompleteNotice: true,
      containsPartialModelAnswer: false,
      evidenceStatus: "allowance_exhausted",
      modelCalls: 1,
      searchCalls: 0,
    });
  });
});
