import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { agentStateSchemaVersion } from "../../../src/state.js";
import {
  candidateFor,
  compareRequest,
  createAgent,
  createExtractor,
  createLookup,
  createTools,
  searchResult,
} from "../../fixtures/comparison-workflow.js";
import { comparisonResult } from "../../fixtures/workflow-results.js";

describe("comparison workflow state", () => {
  it("explains a saved comparison without rerunning participant searches", async () => {
    const kane = candidateFor("Harry Kane", "kane");
    const mbappe = candidateFor("Kylian Mbappé", "mbappe");
    const firstMessage = "Compare Harry Kane and Kylian Mbappé.";
    const explainMessage = "Explain the previous comparison.";
    const wrongTargetMessage = "Explain the previous comparison with Haaland.";
    const search = vi.fn<PlayerSearch>(searchResult);

    const model = fakeModel()
      .respond(new AIMessage("The comparison has no shared data."))
      .respond(new AIMessage("The saved comparison has no shared data."));

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: createLookup([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
        [explainMessage]: {
          constraints: [],
          continuationAction: "explain",
          kind: "player_comparison",
          players: [],
          teams: [],
        },
        [firstMessage]: compareRequest(["Harry Kane", "Kylian Mbappé"]),
        [wrongTargetMessage]: {
          constraints: [],
          continuationAction: "explain",
          kind: "player_comparison",
          players: [
            {
              lookupName: null,
              mention: "Haaland",
              referenceScope: "explicit",
            },
          ],
          teams: [],
        },
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "saved-comparison-explanation" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const explained = await graph.invoke(
      { messages: [new HumanMessage(explainMessage)] },
      config
    );

    const unrelatedExplanation = await graph.invoke(
      { messages: [new HumanMessage(wrongTargetMessage)] },
      config
    );

    const { outcome } = explained;

    expect({
      answer: explained.messages.at(-1)?.content,
      outcomeSource:
        outcome !== null && "source" in outcome ? outcome.source : null,
      outcomeStatus: outcome?.status,
      repeatedSearchCalls: search.mock.calls.length,
      searchCalls: search.mock.calls.length,
      unrelatedAnswer: unrelatedExplanation.messages.at(-1)?.content,
      unrelatedOutcome: unrelatedExplanation.outcome?.status,
    }).toStrictEqual({
      answer: "The saved comparison has no shared data.",
      outcomeSource: "saved",
      outcomeStatus: "no_comparable_data",
      repeatedSearchCalls: 2,
      searchCalls: 2,
      unrelatedAnswer:
        "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。",
      unrelatedOutcome: "saved_result_unavailable",
    });
  });

  it("retains a completed comparison when its final model explanation fails", async () => {
    const kane = candidateFor("Harry Kane", "kane");
    const mbappe = candidateFor("Kylian Mbappé", "mbappe");
    const message = "Compare Harry Kane and Kylian Mbappé.";
    const search = vi.fn<PlayerSearch>(searchResult);

    const model = fakeModel()
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

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: createLookup([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
        [message]: compareRequest(["Harry Kane", "Kylian Mbappé"]),
      }),
      tools: createTools(search),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "comparison-explanation-outage" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      comparisonPlayers:
        result.conversationContext.activeComparison.players.map(
          ({ candidate: item }) => item.name
        ),
      modelCalls: model.callCount,
      outcome: result.outcome?.status,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      answer:
        "数据查询或计算已经完成，但模型暂时无法生成解释。已完成的结构化结果仍保留，可以继续追问。",
      comparisonPlayers: ["Harry Kane", "Kylian Mbappé"],
      modelCalls: 3,
      outcome: "no_comparable_data",
      searchCalls: 2,
    });
  });

  it("reports an unavailable local comparison source instead of empty evidence", async () => {
    const kane = candidateFor("Harry Kane", "kane");
    const mbappe = candidateFor("Kylian Mbappé", "mbappe");
    const message = "Compare Harry Kane and Kylian Mbappé.";

    const search = vi.fn<PlayerSearch>((input) =>
      JSON.stringify({
        fm: { reason: "FM snapshot missing", status: "unavailable" },
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

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: createLookup([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
        [message]: compareRequest(["Harry Kane", "Kylian Mbappé"]),
      }),
      tools: createTools(search),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "comparison-source-unavailable" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      outcome: result.outcome?.status,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      answer:
        "目前无法从本地数据中取得完成这次请求所需的信息，因此无法给出结果。",
      outcome: "data_unavailable",
      searchCalls: 2,
    });
  });

  it("does not reconstruct a comparison from historical tool messages without saved thread context", async () => {
    const parrott = candidateFor("Troy Parrott", "parrott");
    const addMessage = "Add Troy Parrott to the comparison.";
    const search = vi.fn<PlayerSearch>(searchResult);
    const priorCallId = "historical-comparison-call";

    const historicalMessages = [
      new HumanMessage("Compare Harry Kane and Kylian Mbappé."),
      new AIMessage({
        content: "",
        tool_calls: [
          {
            args: {
              players: [
                {
                  canonicalIdentityId: "old-kane",
                  identityBasis: "reep_registry",
                  playerName: "Harry Kane",
                  sourceRecords: [{ provider: "fm", sourceId: "kane-fm" }],
                },
                {
                  canonicalIdentityId: "old-mbappe",
                  identityBasis: "reep_registry",
                  playerName: "Kylian Mbappé",
                  sourceRecords: [{ provider: "fm", sourceId: "mbappe-fm" }],
                },
              ],
              seasonStartYear: 2024,
            },
            id: priorCallId,
            name: "compare_player_records",
            type: "tool_call",
          },
        ],
      }),
      new ToolMessage({
        content: comparisonResult(["Harry Kane", "Kylian Mbappé"], "ready"),
        name: "compare_player_records",
        tool_call_id: priorCallId,
      }),
      new AIMessage("The historical comparison completed."),
      new HumanMessage(addMessage),
    ];

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: createLookup([parrott]),
      requestUnderstandingExtractor: createExtractor({
        [addMessage]: compareRequest(["Troy Parrott"], [], "add"),
      }),
      tools: createTools(search),
    });

    const result = await graph.invoke(
      {
        messages: historicalMessages,
        stateSchemaVersion: agentStateSchemaVersion,
      },
      { configurable: { thread_id: "no-history-recovery-thread" } }
    );

    expect(search).not.toHaveBeenCalled();
    expect(result.conversationContext.activeComparison.players).toStrictEqual(
      []
    );
    expect(result.messages.at(-1)?.content).toContain("至少两名球员");
  });

  it("does not leak a saved comparison between thread IDs", async () => {
    const kane = candidateFor("Harry Kane", "kane");
    const mbappe = candidateFor("Kylian Mbappé", "mbappe");
    const parrott = candidateFor("Troy Parrott", "parrott");
    const first = "Compare Harry Kane and Kylian Mbappé.";
    const add = "Add Troy Parrott to the comparison.";
    const search = vi.fn<PlayerSearch>(searchResult);

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel().respond(new AIMessage("Comparison checked.")),
      playerIdentityLookup: createLookup([kane, mbappe, parrott]),
      requestUnderstandingExtractor: createExtractor({
        [add]: compareRequest(["Troy Parrott"], [], "add"),
        [first]: compareRequest(["Harry Kane", "Kylian Mbappé"]),
      }),
      tools: createTools(search),
    });

    await graph.invoke(
      { messages: [new HumanMessage(first)] },
      { configurable: { thread_id: "saved-comparison-thread" } }
    );

    const isolated = await graph.invoke(
      { messages: [new HumanMessage(add)] },
      { configurable: { thread_id: "isolated-thread" } }
    );

    expect(search).toHaveBeenCalledTimes(2);
    expect(isolated.conversationContext.activeComparison.players).toStrictEqual(
      []
    );
    expect(isolated.messages.at(-1)?.content).toContain("至少两名球员");
  });
});
