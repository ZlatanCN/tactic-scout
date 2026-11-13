import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it, vi } from "vitest";

import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";

describe("repeated successful lookup requests", () => {
  it("uses the completed result when the model repeats the same search", async () => {
    const player = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const message = "Look up Harry Kane.";

    const searchResult = JSON.stringify({
      fm: {
        records: [agentGraphTest.fmRecord("Harry Kane", "kane-fm")],
        status: "found",
      },
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

    const search = vi.fn<PlayerSearch>(() => searchResult);

    const repeatedCall = {
      args: { sourceRecords: [] },
      name: "search_player_records",
    };

    const model = fakeModel()
      .respondWithTools([repeatedCall])
      .respondWithTools([repeatedCall])
      .respond(new AIMessage("The returned FM record answers the request."));

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(player),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers("player_lookup", [
          player.name,
        ]),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "repeat-successful-lookup" } }
    );

    const searchCallIds = result.messages.flatMap((item) =>
      item instanceof AIMessage
        ? (item.tool_calls ?? []).flatMap((call) =>
            call.name === "search_player_records" && call.id !== undefined
              ? [call.id]
              : []
          )
        : []
    );

    const searchToolMessages = result.messages.filter(
      (item): item is ToolMessage =>
        item instanceof ToolMessage && item.name === "search_player_records"
    );

    expect({
      activeLookup: result.conversationContext.activeLookup?.resultJson ?? null,
      answer: result.messages.at(-1)?.content,
      outcomeStatus: result.outcome?.status,
      searchCalls: search.mock.calls.length,
    }).toMatchObject({
      activeLookup: searchResult,
      outcomeStatus: "answer_ready",
      searchCalls: 1,
    });
    expect(result.messages.at(-1)?.content).not.toContain(
      "查询触及 3 次搜索上限"
    );
    expect(
      searchToolMessages.map(({ tool_call_id }) => tool_call_id)
    ).toStrictEqual(searchCallIds);
    expect(searchToolMessages.map(({ content }) => content)).toStrictEqual([
      searchResult,
      searchResult,
    ]);
  });
});
