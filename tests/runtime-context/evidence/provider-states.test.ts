import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../../src/state.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";

describe("lookup evidence projection and bounded delivery", () => {
  it("distinguishes source null, unselected fields, and an unqueried provider", async () => {
    const player = agentGraphTest.playerCandidate("Mikel Oyarzabal", "mikel");

    const message = new HumanMessage({
      content: "What xA did Understat report?",
      id: "saved-lookup-null-xa",
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
          {
            appearances: 7,
            assists: 1,
            competition: "La_liga",
            expectedAssists: null,
            expectedGoals: 0.8,
            goals: 1,
            keyPasses: 5,
            minutes: 411,
            nonPenaltyExpectedGoals: 0.8,
            player: player.name,
            position: "F M S",
            season: "2025/26",
            shots: 10,
            source: "Understat",
            sourcePlayerId: "mikel-understat",
            team: "Real Sociedad",
          },
        ],
        status: "found",
      },
    });

    const model = fakeModel().respond(
      new AIMessage("Understat returned xA as null for this record.")
    );

    const modelInvoke = vi.spyOn(model, "invoke");

    const search = vi.fn<PlayerSearch>(() => {
      throw new Error("A saved lookup follow-up must not reread the provider.");
    });

    const graph = agentGraphTest.createAgent({
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
      configurable: { thread_id: "saved-lookup-null-xa" },
    });

    const modelInput = JSON.stringify(modelInvoke.mock.calls.at(-1)?.[0]);

    const evidenceProjection =
      result.lookupEvidence?.batches.at(0)?.projectionJson ?? "";

    expect({
      answer: result.messages.at(-1)?.content,
      evidenceStatus: result.lookupEvidence?.status,
      modelCalls: modelInvoke.mock.calls.length,
      modelReceivedProjection: modelInput.includes(
        "Scouting evidence projection JSON:"
      ),
      searchCalls: search.mock.calls.length,
      sourceNullIsExplicit: evidenceProjection.includes("source_null"),
      unqueriedProviderIsExplicit: evidenceProjection.includes(
        '"status":"not_queried"'
      ),
      unselectedExpectedGoalsAreNotPresentAsValues:
        !evidenceProjection.includes(
          `\\"expectedGoals\\":{\\"state\\":\\"value\\"`
        ),
      unselectedFieldsAreExplicit:
        evidenceProjection.includes("unselectedFields"),
    }).toStrictEqual({
      answer: "Understat returned xA as null for this record.",
      evidenceStatus: "complete",
      modelCalls: 1,
      modelReceivedProjection: true,
      searchCalls: 0,
      sourceNullIsExplicit: true,
      unqueriedProviderIsExplicit: true,
      unselectedExpectedGoalsAreNotPresentAsValues: true,
      unselectedFieldsAreExplicit: true,
    });
  });

  it.each([
    {
      id: "short-season-range",
      question: "What xA did Understat report for 24/25?",
    },
    {
      id: "english-single-year-season",
      question: "What xA did Understat report for 2024 season?",
    },
    {
      id: "bare-english-year-with-xa",
      question: "What xA did Understat report in 2024?",
    },
    {
      id: "chinese-single-year-season",
      question: "2024年 Understat 的 xA 是多少？",
    },
  ])(
    "preserves unresolved explicit season scope: $id",
    async ({ id, question }) => {
      const player = agentGraphTest.playerCandidate("Mikel Oyarzabal", "mikel");

      const message = new HumanMessage({
        content: question,
        id: `saved-lookup-unavailable-fm-${id}`,
      });

      const resultJson = JSON.stringify({
        fm: {
          reason: "The FM snapshot is unavailable.",
          status: "unavailable",
        },
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
        query: [
          { provider: "fm", sourceId: "mikel-fm" },
          { provider: "understat", sourceId: "mikel-understat" },
        ],
        requestedUnderstatSeasonStartYear: null,
        understat: {
          records: [
            {
              appearances: 8,
              assists: 2,
              competition: "La_liga",
              expectedAssists: 1.2,
              expectedGoals: 1.1,
              goals: 2,
              keyPasses: 9,
              minutes: 520,
              nonPenaltyExpectedGoals: 1.1,
              player: player.name,
              position: "F M S",
              season: "2025/26",
              shots: 14,
              source: "Understat",
              sourcePlayerId: "mikel-understat",
              team: "Real Sociedad",
            },
          ],
          status: "found",
        },
      });

      const model = fakeModel().respond(
        new AIMessage(
          "The requested season was not normalized; the returned record is for 2025/26."
        )
      );

      const modelInvoke = vi.spyOn(model, "invoke");

      const search = vi.fn<PlayerSearch>(() => {
        throw new Error(
          "A saved lookup follow-up must not reread the provider."
        );
      });

      const graph = agentGraphTest.createAgent({
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
        configurable: { thread_id: `saved-lookup-unavailable-fm-${id}` },
      });

      const projectionJson =
        result.lookupEvidence?.batches.at(0)?.projectionJson ?? "";

      const projection = z
        .object({
          coverage: z.object({
            providers: z.object({
              fm: z.object({ queried: z.boolean(), status: z.string() }),
              understat: z.object({
                queried: z.boolean(),
                seasonMode: z.string(),
                status: z.string(),
              }),
            }),
          }),
        })
        .parse(JSON.parse(projectionJson));

      expect({
        answer: result.messages.at(-1)?.content,
        evidenceStatus: result.lookupEvidence?.status,
        fmProvider: projection.coverage.providers.fm,
        modelCalls: modelInvoke.mock.calls.length,
        modelReceivedProjection: JSON.stringify(
          modelInvoke.mock.calls.at(-1)?.[0]
        ).includes("Scouting evidence projection JSON:"),
        searchCalls: search.mock.calls.length,
        understatSeasonMode: projection.coverage.providers.understat.seasonMode,
      }).toStrictEqual({
        answer:
          "The requested season was not normalized; the returned record is for 2025/26.",
        evidenceStatus: "complete",
        fmProvider: { queried: true, status: "unavailable" },
        modelCalls: 1,
        modelReceivedProjection: true,
        searchCalls: 0,
        understatSeasonMode: "explicit_unresolved",
      });
    }
  );

  it.each([
    {
      answer: "Understat reports expected goals 3.2.",
      otherField: "goals",
      question: "Understat 的预期进球是多少？",
      selectedField: "expectedGoals",
    },
    {
      answer: "Understat reports expected assists 1.4.",
      otherField: "assists",
      question: "Understat 的预期助攻是多少？",
      selectedField: "expectedAssists",
    },
  ])("selects the requested Chinese expected metric", async (testCase) => {
    const player = agentGraphTest.playerCandidate("Mikel Oyarzabal", "mikel");

    const message = new HumanMessage({
      content: testCase.question,
      id: `saved-lookup-${testCase.selectedField}`,
    });

    const resultJson = JSON.stringify({
      identityGroups: {
        canonicalGroups: [],
        registryStatus: "not_needed",
        unlinkedRecords: [],
      },
      query: [{ provider: "understat", sourceId: "mikel-understat" }],
      requestedUnderstatSeasonStartYear: null,
      understat: {
        records: [
          {
            appearances: 7,
            assists: 5,
            competition: "La_liga",
            expectedAssists: 1.4,
            expectedGoals: 3.2,
            goals: 7,
            keyPasses: 11,
            minutes: 606,
            nonPenaltyExpectedGoals: 2.5,
            player: player.name,
            position: "F M S",
            season: "2025/26",
            shots: 20,
            source: "Understat",
            sourcePlayerId: "mikel-understat",
            team: "Real Sociedad",
          },
        ],
        status: "found",
      },
    });

    const model = fakeModel().respond(new AIMessage(testCase.answer));
    const modelInvoke = vi.spyOn(model, "invoke");
    const graph = agentGraphTest.createAgent({ model, tools: [] });

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
      configurable: { thread_id: `saved-lookup-${testCase.selectedField}` },
    });

    const projectionJson =
      result.lookupEvidence?.batches.at(0)?.projectionJson ?? "";

    const projection = z
      .object({
        records: z.array(
          z.object({
            fieldStates: z.record(z.string(), z.unknown()),
            unselectedFields: z.array(z.string()),
          })
        ),
      })
      .parse(JSON.parse(projectionJson));

    const [record] = projection.records;

    expect({
      answer: result.messages.at(-1)?.content,
      modelCalls: modelInvoke.mock.calls.length,
      selectedFields: Object.keys(record?.fieldStates ?? {}),
      unselectedStatistic: record?.unselectedFields.includes(
        testCase.otherField
      ),
    }).toStrictEqual({
      answer: testCase.answer,
      modelCalls: 1,
      selectedFields: [testCase.selectedField],
      unselectedStatistic: true,
    });
  });
});
