import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";
import type { ExtractedRequest } from "../../fixtures/agent-graph.js";

describe("saved lookup follow-up reuse", () => {
  it("reuses a saved lookup when a follow-up names a data source, not another player", async () => {
    const player = agentGraphTest.playerCandidate("Mikel Oyarzabal", "mikel");

    const firstMessage =
      "Look up Mikel Oyarzabal's 2026/27 La Liga FM profile and performance.";

    const followUp = "What xA did Understat report?";

    const search = vi.fn<PlayerSearch>((input) =>
      JSON.stringify({
        fm: {
          records: [agentGraphTest.fmRecord(player.name, "mikel-fm")],
          status: "found",
        },
        identityGroups: {
          canonicalGroups: [
            {
              canonicalIdentityId: "canonical-mikel",
              name: player.name,
              records: [
                {
                  identitySourceId: "mikel-fm",
                  name: player.name,
                  provider: "fm",
                  recordId: "mikel-fm",
                },
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
        query: input.sourceRecords,
        requestedUnderstatSeasonStartYear: input.seasonStartYear ?? null,
        understat: {
          records: [
            {
              appearances: 9,
              assists: 2,
              competition: "La_liga",
              expectedAssists: 1.4065424017608166,
              expectedGoals: 2.2992119416594505,
              goals: 2,
              keyPasses: 11,
              minutes: 606,
              nonPenaltyExpectedGoals: 2.2992119416594505,
              player: player.name,
              position: "F M S",
              season: "2026/27",
              shots: 19,
              source: "Understat",
              sourcePlayerId: "mikel-understat",
              team: "Real Sociedad",
            },
          ],
          status: "found",
        },
      })
    );

    const model = fakeModel()
      .respondWithTools([
        {
          args: {
            seasonStartYear: 2026,
            sourceRecords: [
              { provider: "fm", sourceId: "mikel-fm" },
              { provider: "understat", sourceId: "mikel-understat" },
            ],
          },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("The Mikel Oyarzabal lookup is complete."))
      .respond(new AIMessage("The saved Understat result reports xA 1.41."));

    const lookupTool = agentGraphTest.createSearchTool(search);
    const modelWithLookupTool = model.bindTools([lookupTool]);
    vi.spyOn(model, "bindTools").mockReturnValue(modelWithLookupTool);
    const modelInvoke = vi.spyOn(model, "invoke");

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(player),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [firstMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          player.name,
        ]),
        [followUp]: agentGraphTest.requestForPlayers("player_lookup", [
          "Understat",
        ]),
      }),
      tools: [lookupTool],
    });

    const config = {
      configurable: { thread_id: "lookup-follow-up-source-mention" },
    };

    const firstResult = await graph.invoke(
      { messages: [new HumanMessage(firstMessage)] },
      config
    );

    const result = await graph.invoke(
      { messages: [new HumanMessage(followUp)] },
      config
    );

    const followUpModelInput = JSON.stringify(
      modelInvoke.mock.calls.at(-1)?.[0]
    );

    expect({
      answer: result.messages.at(-1)?.content,
      firstActiveLookup:
        firstResult.conversationContext.activeLookup?.player.candidate.name,
      firstOutcome: firstResult.outcome?.status,
      lookupFollowUp: result.outcome?.status,
      modelInputContainsExpectedAssistsValue: followUpModelInput.includes(
        `\\"expectedAssists\\":{\\"state\\":\\"value\\"`
      ),
      modelInputContainsProjection: followUpModelInput.includes(
        "Scouting evidence projection JSON:"
      ),
      modelInputContainsSourceRecord:
        followUpModelInput.includes("mikel-understat"),
      modelInputContainsUnselectedMetricValue: followUpModelInput.includes(
        `\\"nonPenaltyExpectedGoals\\":{\\"state\\":\\"value\\"`
      ),
      requestPlayers: result.request.players,
      searchCalls: search.mock.calls.length,
    }).toMatchObject({
      answer: "The saved Understat result reports xA 1.41.",
      firstActiveLookup: "Mikel Oyarzabal",
      firstOutcome: "answer_ready",
      lookupFollowUp: "lookup_follow_up",
      modelInputContainsExpectedAssistsValue: true,
      modelInputContainsProjection: true,
      modelInputContainsSourceRecord: true,
      modelInputContainsUnselectedMetricValue: false,
      requestPlayers: [],
      searchCalls: 1,
    });
  });

  it("answers a lookup follow-up from the saved result without rerunning the search", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const firstMessage = "Look up Harry Kane.";
    const followUp = "刚才查到的是什么赛季？";

    const lookupResult = JSON.stringify({
      fm: { records: [], status: "not_found" },
      identityGroups: {
        canonicalGroups: [],
        registryStatus: "not_needed",
        unlinkedRecords: [],
      },
      query: [
        { provider: "fm", sourceId: "kane-fm" },
        { provider: "understat", sourceId: "kane-understat" },
      ],
      requestedUnderstatSeasonStartYear: null,
      understat: { records: [], status: "not_found" },
    });

    const search = vi.fn<PlayerSearch>(() => lookupResult);

    const followUpRequest: ExtractedRequest = {
      constraints: [],
      kind: "player_lookup",
      players: [
        {
          lookupName: null,
          mention: "刚才查到的",
          recommendationRole: "reference",
          referenceScope: "prior_context",
          referenceTargetMention: null,
        },
      ],
      teams: [],
    };

    const model = fakeModel()
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("The local records are loaded."))
      .respond(
        new AIMessage(
          "Understat returned no season record; the query used the default snapshot scope."
        )
      );

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [firstMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
        [followUp]: followUpRequest,
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const config = {
      configurable: { thread_id: "lookup-follow-up-thread" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const followUpResult = await graph.invoke(
      { messages: [new HumanMessage(followUp)] },
      config
    );

    expect({
      activeLookup: followUpResult.conversationContext.activeLookup?.resultJson,
      followUpAnswer: followUpResult.messages.at(-1)?.content,
      outcomeStatus: followUpResult.outcome?.status,
      pendingClarification: followUpResult.pendingClarification,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      activeLookup: lookupResult,
      followUpAnswer:
        "Understat returned no season record; the query used the default snapshot scope.",
      outcomeStatus: "lookup_follow_up",
      pendingClarification: null,
      searchCalls: 1,
    });
  });

  it("does not explain a saved lookup for a different explicitly named player", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const mbappe = agentGraphTest.playerCandidate("Kylian Mbappé", "mbappe");
    const firstMessage = "Look up Harry Kane.";
    const explainMessage = "Explain the previous lookup for Kylian Mbappé.";
    const search = vi.fn<PlayerSearch>(agentGraphTest.emptySearchResult);

    const searchCall = {
      args: { sourceRecords: [] },
      name: "search_player_records",
    };

    const graph = agentGraphTest.createAgent({
      model: fakeModel()
        .respondWithTools([searchCall])
        .respond(new AIMessage("Harry Kane's records loaded.")),
      playerIdentityLookup: agentGraphTest.resolvedLookupFromCandidates([
        kane,
        mbappe,
      ]),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [explainMessage]: {
          constraints: [],
          continuationAction: "explain",
          kind: "player_lookup",
          players: [
            {
              lookupName: null,
              mention: "Kylian Mbappé",
              recommendationRole: "reference",
              referenceScope: "explicit",
              referenceTargetMention: null,
            },
          ],
          teams: [],
        },
        [firstMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const config = {
      configurable: { thread_id: "saved-lookup-target-mismatch" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const explained = await graph.invoke(
      { messages: [new HumanMessage(explainMessage)] },
      config
    );

    expect({
      activePlayer:
        explained.conversationContext.activeLookup?.player.candidate.name,
      answer: explained.messages.at(-1)?.content,
      outcome: explained.outcome?.status,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      activePlayer: "Harry Kane",
      answer: "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。",
      outcome: "saved_result_unavailable",
      searchCalls: 1,
    });
  });

  it("does not explain a saved lookup as a different explicitly requested season", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const firstMessage = "Look up Harry Kane.";

    const explainMessage =
      "Explain the previous lookup for Harry Kane in 2024/25.";

    const search = vi.fn<PlayerSearch>(agentGraphTest.emptySearchResult);

    const searchCall = {
      args: { sourceRecords: [] },
      name: "search_player_records",
    };

    const graph = agentGraphTest.createAgent({
      model: fakeModel()
        .respondWithTools([searchCall])
        .respond(new AIMessage("Harry Kane's latest records loaded.")),
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [explainMessage]: {
          constraints: [],
          continuationAction: "explain",
          kind: "player_lookup",
          players: [
            {
              lookupName: null,
              mention: "Harry Kane",
              recommendationRole: "reference",
              referenceScope: "explicit",
              referenceTargetMention: null,
            },
          ],
          teams: [],
        },
        [firstMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const config = {
      configurable: { thread_id: "saved-lookup-season-mismatch" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const explained = await graph.invoke(
      { messages: [new HumanMessage(explainMessage)] },
      config
    );

    expect({
      answer: explained.messages.at(-1)?.content,
      outcome: explained.outcome?.status,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      answer: "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。",
      outcome: "saved_result_unavailable",
      searchCalls: 1,
    });
  });
});
