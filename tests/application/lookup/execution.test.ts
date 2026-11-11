import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";

describe("lookup execution", () => {
  it("pins an explicit lookup season to the resolved source records", async () => {
    const mbappe = agentGraphTest.playerCandidate("Kylian Mbappé", "mbappe");
    const message = "Look up Kylian Mbappé's 2024/25 La Liga xG.";

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
            seasonStartYear: 2025,
            sourceRecords: [{ provider: "understat", sourceId: "2370" }],
          },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("The requested Understat row was not found."));

    const lookupTool = agentGraphTest.createSearchTool(search);
    const modelWithTools = model.bindTools([lookupTool]);
    const lookupModelInvoke = vi.spyOn(modelWithTools, "invoke");
    vi.spyOn(model, "bindTools").mockReturnValue(modelWithTools);

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(mbappe),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers("player_lookup", [
          mbappe.name,
        ]),
      }),
      tools: [lookupTool],
    });

    await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "lookup-explicit-season-scope" } }
    );

    const searchInput = search.mock.calls[0]?.[0];

    expect(searchInput?.seasonStartYear).toBe(2024);
    expect(searchInput?.sourceRecords).toStrictEqual([
      { provider: "fm", sourceId: "mbappe-fm" },
      { provider: "understat", sourceId: "mbappe-understat" },
    ]);
    const modelMessages = lookupModelInvoke.mock.calls[0]?.[0];

    const systemMessage = Array.isArray(modelMessages)
      ? modelMessages.find(
          (inputMessage) => inputMessage instanceof SystemMessage
        )
      : undefined;

    const promptContent = z.string().parse(systemMessage?.content);

    expect([
      promptContent.includes("最终回答不要从记忆猜测或复述 source ID"),
      promptContent.includes("请用户补充完整赛季范围"),
      promptContent.includes(
        "球员查询只按 sourceRecords 与可选 seasonStartYear 搜索，不按用户指定赛事过滤"
      ),
      promptContent.includes("xG 在现实中不可用"),
      promptContent.includes(
        "最终回答只报告返回记录中的 season；除非工具结果明确标出 latest snapshot，否则不要声称这就是数据库最新赛季"
      ),
      promptContent.includes(
        "FM 的 techniqueRaw 表示“技术”，dribblingRaw 表示“盘带”；若缺少 dribblingRaw，必须说明未提供"
      ),
      promptContent.includes("不得用 FM 信息替代、推导或描述当前或赛季表现"),
      promptContent.includes(
        "任何强时效性事实都必须由实际返回且覆盖所问时间范围的来源支持"
      ),
    ]).toStrictEqual([true, true, true, true, true, true, true, true]);
  });

  it("executes duplicate identical lookup calls in one model response once", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const message = "Look up Harry Kane.";
    const search = vi.fn<PlayerSearch>(agentGraphTest.emptySearchResult);

    const duplicateCall = {
      args: {
        sourceRecords: [
          { provider: "fm", sourceId: "kane-fm" },
          { provider: "understat", sourceId: "kane-understat" },
        ],
      },
      name: "search_player_records",
    };

    const model = fakeModel()
      .respondWithTools([duplicateCall, duplicateCall])
      .respond(new AIMessage("Harry Kane's data was loaded."));

    const lookupTool = agentGraphTest.createSearchTool(search);

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers("player_lookup", [
          kane.name,
        ]),
      }),
      tools: [lookupTool],
    });

    await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "duplicate-lookup-tool-calls" } }
    );

    expect(search).toHaveBeenCalledOnce();
  });

  it("runs the resolved lookup when the model answers without requesting the search tool", async () => {
    const mbappe = agentGraphTest.playerCandidate("Kylian Mbappé", "mbappe");
    const message = "Look up Kylian Mbappé's 2024/25 La Liga xG.";
    const search = vi.fn<PlayerSearch>(agentGraphTest.emptySearchResult);

    const model = fakeModel()
      .respond(
        new AIMessage(
          "I need the identity-resolved Understat source ID to look this up."
        )
      )
      .respond(new AIMessage("The requested season was searched."));

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(mbappe),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers(
          "player_lookup",
          [mbappe.name],
          {
            constraints: [{ name: "understatSeasonStartYear", value: "2024" }],
          }
        ),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "lookup-model-omitted-tool-call" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      searchCount: search.mock.calls.length,
      searchedRecords: search.mock.calls[0]?.[0].sourceRecords,
      searchedSeason: search.mock.calls[0]?.[0].seasonStartYear,
    }).toStrictEqual({
      answer: "The requested season was searched.",
      searchCount: 1,
      searchedRecords: [
        { provider: "fm", sourceId: "mbappe-fm" },
        { provider: "understat", sourceId: "mbappe-understat" },
      ],
      searchedSeason: 2024,
    });
  });

  it.each(["Look up Harry Kane's xG.", "Look up Harry Kane's 24/25 xG."])(
    "discards an inferred season when no supported range is present: %s",
    async (message) => {
      const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
      const search = vi.fn<PlayerSearch>(agentGraphTest.emptySearchResult);

      const model = fakeModel()
        .respondWithTools([
          {
            args: {
              seasonStartYear: 2025,
              sourceRecords: [{ provider: "understat", sourceId: "wrong-id" }],
            },
            name: "search_player_records",
          },
        ])
        .respond(new AIMessage("The requested Understat row was not found."));

      const lookupTool = agentGraphTest.createSearchTool(search);

      const graph = agentGraphTest.createAgent({
        model,
        playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
        requestUnderstandingExtractor: agentGraphTest.createExtractor({
          [message]: agentGraphTest.requestForPlayers(
            "player_lookup",
            [kane.name],
            {
              constraints: [
                { name: "understatSeasonStartYear", value: "2024" },
              ],
            }
          ),
        }),
        tools: [lookupTool],
      });

      await graph.invoke(
        { messages: [new HumanMessage(message)] },
        { configurable: { thread_id: "lookup-default-latest-season" } }
      );

      const searchInput = search.mock.calls[0]?.[0];

      const searchResult = z
        .string()
        .safeParse(await search.mock.results[0]?.value);

      expect(searchInput).toStrictEqual({
        sourceRecords: [
          { provider: "fm", sourceId: "kane-fm" },
          { provider: "understat", sourceId: "kane-understat" },
        ],
      });
      expect(searchResult.success ? searchResult.data : "").toContain(
        '"requestedUnderstatSeasonStartYear":null'
      );
    }
  );

  it("retries a recognized transient model failure before executing the lookup tool", async () => {
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
      .respond(
        Object.assign(new Error("temporary network failure"), {
          code: "ECONNRESET",
        })
      )
      .respondWithTools([
        { args: { sourceRecords: [] }, name: "search_player_records" },
      ])
      .respond(new AIMessage("The lookup recovered."));

    const message = "Look up Harry Kane.";

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

    const faultLog = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "transient-model-retry" } }
    );

    const logOutput = faultLog.mock.calls
      .flatMap(([logEntry]) => {
        const parsed = z.string().safeParse(logEntry);

        return parsed.success ? [parsed.data] : [];
      })
      .join("\n");

    faultLog.mockRestore();

    expect({
      answer: result.messages.at(-1)?.content,
      modelCalls: model.callCount,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      answer: "The lookup recovered.",
      modelCalls: 3,
      searchCalls: 1,
    });
    expect(logOutput).toContain('"type":"fault"');
    expect(logOutput).toContain('"node":"lookup_player"');
    expect(logOutput).toContain('"threadId":"transient-model-retry"');
    expect(logOutput).not.toContain("Look up Harry Kane.");
  });

  it("reports unavailable identity data instead of asking the scout to clarify", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const search = vi.fn<PlayerSearch>(agentGraphTest.emptySearchResult);
    const message = "Look up Harry Kane.";

    const graph = agentGraphTest.createAgent({
      model: fakeModel(),
      playerIdentityLookup: (mention) => ({
        candidateCount: 0,
        candidates: [],
        candidatesTruncated: false,
        canonicalIdentityId: null,
        clarificationMessage: null,
        mention,
        selectedCandidateId: null,
        selectedName: null,
        status: "data_unavailable",
      }),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers("player_lookup", [
          kane.name,
        ]),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const faultLog = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "identity-data-unavailable" } }
    );

    const logOutput = faultLog.mock.calls
      .flatMap(([entry]) => {
        const parsed = z.string().safeParse(entry);

        return parsed.success ? [parsed.data] : [];
      })
      .join("\n");

    faultLog.mockRestore();

    expect({
      activeLookup: result.conversationContext.activeLookup,
      answer: result.messages.at(-1)?.content,
      pendingClarification: result.pendingClarification,
      searchCalls: search.mock.calls.length,
      status: result.outcome?.status,
    }).toStrictEqual({
      activeLookup: null,
      answer: "无法确认“Harry Kane”对应的球员身份，本次查询已暂停。",
      pendingClarification: null,
      searchCalls: 0,
      status: "identity_data_unavailable",
    });
    expect(logOutput).toContain('"category":"local_data"');
    expect(logOutput).not.toContain("Harry Kane");
  });

  it("keeps a completed result when identity data fails on a later turn", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const firstMessage = "Look up Harry Kane.";
    const secondMessage = "Look up Erling Haaland.";
    const search = vi.fn<PlayerSearch>(agentGraphTest.emptySearchResult);
    let identityLookups = 0;

    const graph = agentGraphTest.createAgent({
      model: fakeModel()
        .respondWithTools([
          { args: { sourceRecords: [] }, name: "search_player_records" },
        ])
        .respond(new AIMessage("The lookup is complete.")),
      playerIdentityLookup: async (mention) => {
        identityLookups += 1;

        if (identityLookups === 1) {
          return await agentGraphTest.resolvedLookup(kane)(mention);
        }

        return {
          candidateCount: 0,
          candidates: [],
          candidatesTruncated: false,
          canonicalIdentityId: null,
          clarificationMessage: null,
          mention,
          selectedCandidateId: null,
          selectedName: null,
          status: "data_unavailable",
        };
      },
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [firstMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          kane.name,
        ]),
        [secondMessage]: agentGraphTest.requestForPlayers("player_lookup", [
          "Erling Haaland",
        ]),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const config = {
      configurable: { thread_id: "identity-failure-keeps-lookup" },
    };

    const first = await graph.invoke(
      {
        messages: [new HumanMessage({ content: firstMessage, id: "lookup-1" })],
      },
      config
    );

    const previousLookup = first.conversationContext.activeLookup;

    const second = await graph.invoke(
      {
        messages: [
          new HumanMessage({ content: secondMessage, id: "lookup-2" }),
        ],
      },
      config
    );

    expect({
      activeLookup: second.conversationContext.activeLookup,
      answer: second.messages.at(-1)?.content,
      identityLookups,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      activeLookup: previousLookup,
      answer:
        "无法确认“Erling Haaland”对应的球员身份，本次查询已暂停。此前已完成的结果仍保留。",
      identityLookups: 2,
      searchCalls: 1,
    });
  });

  it("preserves the previous lookup result after model retry exhaustion", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const firstMessage = "Look up Harry Kane.";
    const secondMessage = "Look up Harry Kane again.";

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
        { args: { sourceRecords: [] }, name: "search_player_records" },
      ])
      .respond(new AIMessage("The first lookup is complete."))
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
      configurable: { thread_id: "model-failure-preserves-lookup" },
    };

    const firstResult = await graph.invoke(
      { messages: [new HumanMessage(firstMessage)] },
      config
    );

    const previousLookup = firstResult.conversationContext.activeLookup;

    const failed = await graph.invoke(
      { messages: [new HumanMessage(secondMessage)] },
      config
    );

    expect({
      activeLookup: failed.conversationContext.activeLookup,
      answer: failed.messages.at(-1)?.content,
      modelCalls: model.callCount,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      activeLookup: previousLookup,
      answer:
        "球员查询模型暂时不可用，本次查询未能完成。请稍后重试。此前已完成的结果仍保留。",
      modelCalls: 5,
      searchCalls: 1,
    });
  });
});
