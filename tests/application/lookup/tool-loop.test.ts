import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";

describe("lookup tool-loop and provider-call limits", () => {
  it("commits a lookup tool result before retrying the next model step", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const message = "Look up Harry Kane.";

    const lookupResult = JSON.stringify({
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

    const search = vi.fn<PlayerSearch>(() => lookupResult);

    const model = fakeModel()
      .respondWithTools([
        { args: { sourceRecords: [] }, name: "search_player_records" },
      ])
      .respond(
        Object.assign(new Error("temporary network failure"), {
          code: "ECONNRESET",
        })
      )
      .respond(
        Object.assign(new Error("temporary network failure"), {
          code: "ECONNRESET",
        })
      )
      .respond(
        Object.assign(new Error("temporary network failure"), {
          code: "ECONNRESET",
        })
      );

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "lookup-result-before-explanation" } }
    );

    expect({
      activeLookup: result.conversationContext.activeLookup,
      answer: result.messages.at(-1)?.content,
      focus: result.conversationContext.focusPlayers.map(
        ({ referenceId }) => referenceId
      ),
      searchCalls: search.mock.calls.length,
    }).toMatchObject({
      activeLookup: {
        player: { referenceId: "canonical-kane" },
        resultJson: lookupResult,
      },
      answer:
        "球员数据查询已完成，但模型暂时无法生成解释。查询结果已保存，可以继续追问。",
      focus: ["canonical-kane"],
      searchCalls: 1,
    });
  });

  it("limits batched lookup searches to three and resets the allowance on a new user turn", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const firstMessage = "Look up Harry Kane.";
    const secondMessage = "Search for Harry Kane again.";

    const search = vi.fn<PlayerSearch>((input) =>
      JSON.stringify({
        fm: { records: [], status: "not_found" },
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
      .respondWithTools(Array.from({ length: 4 }, () => searchCall))
      .respondWithTools([searchCall])
      .respond(new AIMessage("The next turn received a fresh allowance."))
      .respondWithTools(Array.from({ length: 4 }, () => searchCall));

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

    const config = { configurable: { thread_id: "lookup-search-limit" } };

    const limited = await graph.invoke(
      { messages: [new HumanMessage(firstMessage)] },
      config
    );

    expect({
      activeLookup:
        limited.conversationContext.activeLookup?.player.referenceId ?? null,
      answer: limited.messages.at(-1)?.content,
      searchCallsAfterLimit: search.mock.calls.length,
      status: limited.outcome?.status,
    }).toStrictEqual({
      activeLookup: null,
      answer:
        "本轮球员查询触及 3 次搜索上限，本次查询未完成。请缩小查询范围后重试。",
      searchCallsAfterLimit: 1,
      status: "lookup_search_limit",
    });

    const nextTurn = await graph.invoke(
      { messages: [new HumanMessage(secondMessage)] },
      config
    );

    expect({
      answer: nextTurn.messages.at(-1)?.content,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      answer: "The next turn received a fresh allowance.",
      searchCalls: 2,
    });

    const otherThread = await graph.invoke(
      { messages: [new HumanMessage(firstMessage)] },
      { configurable: { thread_id: "lookup-search-limit-other-thread" } }
    );

    expect({
      answer: otherThread.messages.at(-1)?.content,
      searchCalls: search.mock.calls.length,
      status: otherThread.outcome?.status,
    }).toStrictEqual({
      answer:
        "本轮球员查询触及 3 次搜索上限，本次查询未完成。请缩小查询范围后重试。",
      searchCalls: 3,
      status: "lookup_search_limit",
    });
  });

  it("preserves the previous player snapshot when a different lookup reaches its search limit", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const mbappe = agentGraphTest.playerCandidate("Kylian Mbappé", "mbappe");
    const firstMessage = "Look up Harry Kane.";
    const secondMessage = "Look up Kylian Mbappé.";
    const search = vi.fn<PlayerSearch>(agentGraphTest.emptySearchResult);

    const identityLookup = agentGraphTest.resolvedLookupFromCandidates([
      kane,
      mbappe,
    ]);

    const searchCall = {
      args: { sourceRecords: [] },
      name: "search_player_records",
    };

    const model = fakeModel()
      .respondWithTools([searchCall])
      .respond(new AIMessage("Harry Kane records loaded."))
      .respondWithTools(Array.from({ length: 4 }, () => searchCall));

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [firstMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
        [secondMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          "Kylian Mbappé",
        ]),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const config = {
      configurable: { thread_id: "lookup-limit-preserves-previous-player" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const limited = await graph.invoke(
      { messages: [new HumanMessage(secondMessage)] },
      config
    );

    expect({
      activeLookup:
        limited.conversationContext.activeLookup?.player.referenceId,
      focus: limited.conversationContext.focusPlayers.map(
        ({ referenceId }) => referenceId
      ),
      searchCalls: search.mock.calls.length,
      status: limited.outcome?.status,
    }).toStrictEqual({
      activeLookup: "canonical-kane",
      focus: ["canonical-kane"],
      searchCalls: 2,
      status: "lookup_search_limit",
    });
  });

  it("lets unexpected search tool errors reject the graph", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const message = "Look up Harry Kane.";

    const search = vi.fn<PlayerSearch>(() => {
      throw new TypeError("unexpected local search bug");
    });

    const model = fakeModel().respondWithTools([
      { args: { sourceRecords: [] }, name: "search_player_records" },
    ]);

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const config = {
      configurable: { thread_id: "lookup-tool-programming-error" },
    };

    await expect(
      graph.invoke({ messages: [new HumanMessage(message)] }, config)
    ).rejects.toThrow("unexpected local search bug");

    expect(search).toHaveBeenCalledOnce();

    const checkpoint = z
      .object({
        values: z.object({
          faultTolerance: z.object({ lookupSearchExecutions: z.number() }),
        }),
      })
      .safeParse(structuredClone(await graph.getState(config)));

    expect(checkpoint.success).toBeTruthy();

    if (!checkpoint.success) {
      throw new Error("The search execution counter was not checkpointed.");
    }

    expect(checkpoint.data.values.faultTolerance.lookupSearchExecutions).toBe(
      1
    );
  });

  it("pins lookup reads to the exact source IDs selected by identity resolution", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");

    const search = vi.fn<PlayerSearch>((input) =>
      JSON.stringify({
        fm: { records: [], status: "not_found" },
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

    const model = fakeModel()
      .respondWithTools([
        {
          args: {
            playerName: "Wrong Namesake",
            sourceRecords: [{ provider: "fm", sourceId: "wrong-id" }],
          },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("I found the confirmed player's records."));

    const lookupTool = agentGraphTest.createSearchTool(search);
    const modelWithLookupTool = model.bindTools([lookupTool]);
    const modelInvoke = vi.spyOn(modelWithLookupTool, "invoke");
    vi.spyOn(model, "bindTools").mockReturnValue(modelWithLookupTool);

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        "Look up Harry Kane.": agentGraphTest.requestForPlayers(
          "player_lookup",
          ["Harry Kane"]
        ),
      }),
      tools: [lookupTool],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Look up Harry Kane.")] },
      { configurable: { thread_id: "exact-id-lookup" } }
    );

    const toolCallMessage = result.messages.findLast(
      (message): message is AIMessage =>
        message instanceof AIMessage && (message.tool_calls ?? []).length > 0
    );

    const toolResultMessage = result.messages.findLast(
      (message): message is ToolMessage => message instanceof ToolMessage
    );

    const toolCallId = toolCallMessage?.tool_calls?.[0]?.id;
    const modelInput = JSON.stringify(modelInvoke.mock.calls.at(-1)?.[0]);

    expect(search.mock.calls[0]?.[0]).toStrictEqual({
      sourceRecords: [
        { provider: "fm", sourceId: "kane-fm" },
        { provider: "understat", sourceId: "kane-understat" },
      ],
    });
    expect(
      result.messages.some((message) => message instanceof ToolMessage)
    ).toBeTruthy();
    expect({
      modelReceivedPairedToolCallId:
        toolCallId !== undefined && modelInput.includes(toolCallId),
      modelReceivedProjection: modelInput.includes("version"),
      originalToolResultWasPreserved:
        toolResultMessage !== undefined &&
        z
          .string()
          .parse(toolResultMessage.content)
          .includes('"requestedUnderstatSeasonStartYear":null'),
      stateToolPairIsValid: toolResultMessage?.tool_call_id === toolCallId,
    }).toStrictEqual({
      modelReceivedPairedToolCallId: true,
      modelReceivedProjection: true,
      originalToolResultWasPreserved: true,
      stateToolPairIsValid: true,
    });
    expect(result.conversationContext.focusPlayers).toMatchObject([
      { referenceId: "canonical-kane" },
    ]);
    expect(result.messages.at(-1)?.content).toBe(
      "I found the confirmed player's records."
    );
  });
});
