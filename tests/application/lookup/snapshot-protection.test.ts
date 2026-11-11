import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it, vi } from "vitest";

import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";

describe("saved lookup snapshot protection", () => {
  it("does not answer a lookup follow-up from an older player after a different lookup fails", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const mbappe = agentGraphTest.playerCandidate("Kylian Mbappé", "mbappe");
    const firstMessage = "Look up Harry Kane.";
    const failedMessage = "Look up Kylian Mbappé again.";
    const followUp = "Which season was in the previous lookup?";

    const search = vi
      .fn<PlayerSearch>(agentGraphTest.emptySearchResult)
      .mockImplementationOnce(agentGraphTest.emptySearchResult);

    search.mockImplementationOnce((input) =>
      JSON.stringify({
        fm: { reason: "FM snapshot unavailable", status: "unavailable" },
        identityGroups: {
          canonicalGroups: [],
          registryStatus: "not_needed",
          unlinkedRecords: [],
        },
        query: input.sourceRecords,
        requestedUnderstatSeasonStartYear: input.seasonStartYear ?? null,
        understat: { records: [], status: "not_found" },
      })
    );

    const searchCall = {
      args: { sourceRecords: [] },
      name: "search_player_records",
    };

    const identityLookup = agentGraphTest.resolvedLookupFromCandidates([
      kane,
      mbappe,
    ]);

    const model = fakeModel()
      .respondWithTools([searchCall])
      .respond(new AIMessage("Harry Kane's data loaded."))
      .respondWithTools([searchCall]);

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [failedMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          "Kylian Mbappé",
        ]),
        [firstMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
        [followUp]: {
          constraints: [],
          kind: "player_lookup",
          players: [
            {
              lookupName: null,
              mention: "the previous lookup",
              recommendationRole: "reference",
              referenceScope: "prior_context",
              referenceTargetMention: null,
            },
          ],
          teams: [],
        },
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const config = {
      configurable: { thread_id: "lookup-followup-after-unrelated-failure" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);
    await graph.invoke({ messages: [new HumanMessage(failedMessage)] }, config);

    const result = await graph.invoke(
      { messages: [new HumanMessage(followUp)] },
      config
    );

    expect({
      activePlayer:
        result.conversationContext.activeLookup?.player.candidate.name,
      answer: result.messages.at(-1)?.content,
      outcome: result.outcome?.status,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      activePlayer: "Harry Kane",
      answer: "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。",
      outcome: "saved_result_unavailable",
      searchCalls: 2,
    });
  });

  it("commits a valid empty lookup result to the active lookup context", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");

    const sourceRecords = [
      { provider: "fm" as const, sourceId: "kane-fm" },
      { provider: "understat" as const, sourceId: "kane-understat" },
    ];

    const lookupResult = agentGraphTest.emptySearchResult({ sourceRecords });
    const search = vi.fn<PlayerSearch>(() => lookupResult);

    const model = fakeModel()
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("No local records were found."));

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        "Look up Harry Kane.": agentGraphTest.requestForPlayers(
          "player_lookup",
          ["Harry Kane"]
        ),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Look up Harry Kane.")] },
      { configurable: { thread_id: "lookup-without-data" } }
    );

    expect(result.conversationContext.activeLookup?.resultJson).toContain(
      '"registryStatus":"not_needed"'
    );

    expect({
      focusPlayers: result.conversationContext.focusPlayers.map(
        ({ referenceId }) => referenceId
      ),
      sourceRecords: search.mock.calls[0]?.[0].sourceRecords,
    }).toStrictEqual({
      focusPlayers: ["canonical-kane"],
      sourceRecords,
    });
  });

  it("preserves the previous Active lookup when a later source result is unavailable", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const firstMessage = "Look up Harry Kane.";
    const secondMessage = "Refresh Harry Kane's local lookup.";

    const firstLookupResult = JSON.stringify({
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

    const unavailableResult = JSON.stringify({
      fm: { reason: "FM snapshot unavailable", status: "unavailable" },
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

    let searchCalls = 0;

    const search = vi.fn<PlayerSearch>(() => {
      searchCalls += 1;

      return searchCalls === 1 ? firstLookupResult : unavailableResult;
    });

    const model = fakeModel()
      .respondWithTools([
        { args: { sourceRecords: [] }, name: "search_player_records" },
      ])
      .respond(new AIMessage("The first lookup is complete."))
      .respondWithTools([
        { args: { sourceRecords: [] }, name: "search_player_records" },
      ])
      .respond(new AIMessage("The local source could not be refreshed."));

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [firstMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
        [secondMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const config = {
      configurable: { thread_id: "lookup-local-source-unavailable" },
    };

    const first = await graph.invoke(
      { messages: [new HumanMessage(firstMessage)] },
      config
    );

    const previousLookup = first.conversationContext.activeLookup;

    const second = await graph.invoke(
      { messages: [new HumanMessage(secondMessage)] },
      config
    );

    expect({
      activeLookup: second.conversationContext.activeLookup,
      answer: second.messages.at(-1)?.content,
      modelCalls: model.callCount,
      outcomeStatus: second.outcome?.status,
      searchCalls,
    }).toStrictEqual({
      activeLookup: previousLookup,
      answer:
        "目前无法从本地数据中取得完成这次请求所需的信息，因此无法给出结果。此前已完成的结果仍保留。",
      modelCalls: 3,
      outcomeStatus: "data_unavailable",
      searchCalls: 2,
    });
  });

  it("does not reuse a previous lookup after a different season request fails", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const kaneMessage = "Look up Harry Kane.";
    const failedMessage = "Look up Harry Kane's 2024/25 Understat data again.";
    const followUp = "Which season was in the previous lookup?";

    const search = vi
      .fn<PlayerSearch>(agentGraphTest.emptySearchResult)
      .mockImplementationOnce((input) =>
        agentGraphTest.emptySearchResult(input)
      )
      .mockImplementationOnce((input) =>
        JSON.stringify({
          fm: { reason: "FM snapshot unavailable", status: "unavailable" },
          identityGroups: {
            canonicalGroups: [],
            registryStatus: "not_needed",
            unlinkedRecords: [],
          },
          query: input.sourceRecords,
          requestedUnderstatSeasonStartYear: input.seasonStartYear ?? null,
          understat: { records: [], status: "not_found" },
        })
      );

    const searchCall = {
      args: { sourceRecords: [] },
      name: "search_player_records",
    };

    const model = fakeModel()
      .respondWithTools([searchCall])
      .respond(new AIMessage("Harry Kane's records loaded."))
      .respondWithTools([searchCall]);

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [failedMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
        [followUp]: {
          constraints: [],
          kind: "player_lookup",
          players: [
            {
              lookupName: null,
              mention: "the previous lookup",
              recommendationRole: "reference",
              referenceScope: "prior_context",
              referenceTargetMention: null,
            },
          ],
          teams: [],
        },
        [kaneMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const config = {
      configurable: { thread_id: "lookup-followup-after-unrelated-failure" },
    };

    await graph.invoke({ messages: [new HumanMessage(kaneMessage)] }, config);
    await graph.invoke({ messages: [new HumanMessage(failedMessage)] }, config);

    const result = await graph.invoke(
      { messages: [new HumanMessage(followUp)] },
      config
    );

    expect({
      activePlayer:
        result.conversationContext.activeLookup?.player.candidate.name,
      answer: result.messages.at(-1)?.content,
      outcome: result.outcome?.status,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      activePlayer: "Harry Kane",
      answer: "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。",
      outcome: "saved_result_unavailable",
      searchCalls: 2,
    });
  });
});
