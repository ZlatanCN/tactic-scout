import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import type { ReferenceIdentityLookup } from "../src/player-data/resolve-reference.js";
import type { PlayerSearch } from "../src/player-data/search-records.js";
import type { RequestUnderstandingExtractor } from "../src/request-extraction.js";
import type { ReferenceCandidate } from "../src/state.js";
import {
  ActiveRecommendationSchema,
  createInitialConversationContext,
} from "../src/state.js";
import type { RecommendPlayerCandidates } from "../src/tools/recommend-player-candidates.js";
import type { PlayerSearchInput } from "../src/tools/search-player-records.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../src/agent.js");
const { createTools } = await import("../src/tools/search-player-records.js");

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

const playerCandidate = (name: string, id: string): ReferenceCandidate => ({
  candidateId: `reep:${id}`,
  canonicalIdentityId: `canonical-${id}`,
  exactNameMatch: true,
  identityBasis: "reep_registry",
  identityVerified: true,
  name,
  records: [
    {
      canonicalIdentityId: `canonical-${id}`,
      competition: null,
      identityVerified: true,
      name,
      provider: "fm",
      season: null,
      sourceId: `${id}-fm`,
      team: null,
    },
    {
      canonicalIdentityId: `canonical-${id}`,
      competition: "Bundesliga",
      identityVerified: true,
      name,
      provider: "understat",
      season: "2025/26",
      sourceId: `${id}-understat`,
      team: "Fixture FC",
    },
  ],
});

const resolvedLookup =
  (candidate: ReferenceCandidate): ReferenceIdentityLookup =>
  (mention) => ({
    candidateCount: 1,
    candidates: [candidate],
    candidatesTruncated: false,
    canonicalIdentityId: candidate.canonicalIdentityId,
    clarificationMessage: null,
    mention,
    selectedCandidateId: candidate.candidateId,
    selectedName: candidate.name,
    status: "resolved",
  });

const createExtractor =
  (requests: Record<string, ExtractedRequest>): RequestUnderstandingExtractor =>
  async (message) => {
    const request = await Promise.resolve(requests[message]);

    if (request === undefined) {
      throw new Error(`Unexpected test message: ${message}`);
    }

    return request;
  };

const requestForPlayers = (
  kind: ExtractedRequest["kind"],
  players: string[],
  extra: Partial<ExtractedRequest> = {}
): ExtractedRequest => ({
  constraints: [],
  kind,
  players: players.map((mention) => ({
    lookupName: null,
    mention,
    recommendationRole: "reference",
  })),
  teams: [],
  ...extra,
});

const emptySearchResult = (input: PlayerSearchInput): string =>
  JSON.stringify({
    fm: { records: [], status: "not_found" },
    identityGroups: { canonicalGroups: [] },
    query: input.sourceRecords,
    understat: { records: [], status: "not_found" },
  });

const emptySearch: PlayerSearch = (input) => emptySearchResult(input);

const createSearchTool = (search: PlayerSearch) => createTools(search)[0];

describe("LangGraph player workflows", () => {
  it("retries a recognized transient model failure before executing the lookup tool", async () => {
    const kane = playerCandidate("Harry Kane", "kane");

    const search = vi.fn<PlayerSearch>((input) =>
      JSON.stringify({
        fm: { records: [], status: "found" },
        identityGroups: { canonicalGroups: [] },
        query: input.sourceRecords,
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

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_lookup", ["Harry Kane"]),
      }),
      tools: [createSearchTool(search)],
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
    const kane = playerCandidate("Harry Kane", "kane");
    const search = vi.fn<PlayerSearch>(emptySearchResult);
    const message = "Look up Harry Kane.";

    const graph = createAgent({
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
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_lookup", [kane.name]),
      }),
      tools: [createSearchTool(search)],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "identity-data-unavailable" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      pendingClarification: result.pendingClarification,
      searchCalls: search.mock.calls.length,
      status: result.outcome?.status,
    }).toStrictEqual({
      answer:
        "本地球员身份资料无法读取。本次请求没有执行，之前完成的结果仍然保留。",
      pendingClarification: null,
      searchCalls: 0,
      status: "identity_data_unavailable",
    });
  });

  it("preserves the previous lookup result after model retry exhaustion", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const firstMessage = "Look up Harry Kane.";
    const secondMessage = "Look up Harry Kane again.";

    const search = vi.fn<PlayerSearch>((input) =>
      JSON.stringify({
        fm: { records: [], status: "found" },
        identityGroups: { canonicalGroups: [] },
        query: input.sourceRecords,
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

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [firstMessage]: requestForPlayers("player_lookup", ["Harry Kane"]),
        [secondMessage]: requestForPlayers("player_lookup", ["Harry Kane"]),
      }),
      tools: [createSearchTool(search)],
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
        "球员查询模型暂时不可用，本次没有完成查询或切换已确认的球员身份。请稍后重试。",
      modelCalls: 5,
      searchCalls: 1,
    });
  });

  it("retains a completed player recommendation when its final explanation fails", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const message = "Find striker alternatives to Kane.";
    const recommendation = JSON.stringify({ position: "stc", status: "ready" });
    const recommend = vi.fn<RecommendPlayerCandidates>(() => recommendation);

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
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_recommendation", ["Kane"], {
          recommendation: { includePotential: false, position: "stc" },
        }),
      }),
      tools: createTools(emptySearch, recommend),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "recommendation-explanation-outage" } }
    );

    expect({
      activeRecommendation:
        result.conversationContext.activeRecommendation?.resultJson,
      answer: result.messages.at(-1)?.content,
      outcome: result.outcome?.status,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      activeRecommendation: recommendation,
      answer:
        "数据查询或计算已经完成，但模型暂时无法生成解释。已完成的结构化结果仍保留，可以继续追问。",
      outcome: "ready",
      recommendationCalls: 1,
    });
  });

  it("commits a lookup tool result before retrying the next model step", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const message = "Look up Harry Kane.";

    const lookupResult = JSON.stringify({
      fm: { records: [{ season: "2025/26" }], status: "found" },
      identityGroups: { canonicalGroups: [] },
      query: [],
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

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_lookup", ["Harry Kane"]),
      }),
      tools: [createSearchTool(search)],
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
        "球员查询模型暂时不可用，本次没有完成查询或切换已确认的球员身份。请稍后重试。",
      focus: ["canonical-kane"],
      searchCalls: 1,
    });
  });

  it("limits batched lookup searches to three and resets the allowance on a new user turn", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const firstMessage = "Look up Harry Kane.";
    const secondMessage = "Search for Harry Kane again.";

    const search = vi.fn<PlayerSearch>((input) =>
      JSON.stringify({
        fm: { records: [], status: "found" },
        identityGroups: { canonicalGroups: [] },
        query: input.sourceRecords,
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

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [firstMessage]: requestForPlayers("player_lookup", ["Harry Kane"]),
        [secondMessage]: requestForPlayers("player_lookup", ["Harry Kane"]),
      }),
      tools: [createSearchTool(search)],
    });

    const config = { configurable: { thread_id: "lookup-search-limit" } };

    const limited = await graph.invoke(
      { messages: [new HumanMessage(firstMessage)] },
      config
    );

    expect({
      activeLookup:
        limited.conversationContext.activeLookup?.player.referenceId,
      answer: limited.messages.at(-1)?.content,
      searchCallsAfterLimit: search.mock.calls.length,
      status: limited.outcome?.status,
    }).toStrictEqual({
      activeLookup: "canonical-kane",
      answer:
        "本轮球员查询最多执行 3 次搜索。已完成的搜索结果已保留，请基于现有结果继续追问，或发起新一轮查询。",
      searchCallsAfterLimit: 3,
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
      searchCalls: 4,
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
        "本轮球员查询最多执行 3 次搜索。已完成的搜索结果已保留，请基于现有结果继续追问，或发起新一轮查询。",
      searchCalls: 7,
      status: "lookup_search_limit",
    });
  });

  it("lets unexpected search tool errors reject the graph", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const message = "Look up Harry Kane.";

    const search = vi.fn<PlayerSearch>(() => {
      throw new TypeError("unexpected local search bug");
    });

    const model = fakeModel().respondWithTools([
      { args: { sourceRecords: [] }, name: "search_player_records" },
    ]);

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_lookup", ["Harry Kane"]),
      }),
      tools: [createSearchTool(search)],
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
    const kane = playerCandidate("Harry Kane", "kane");

    const search = vi.fn<PlayerSearch>((input) =>
      JSON.stringify({
        fm: { records: [], status: "found" },
        identityGroups: { canonicalGroups: [] },
        query: input.sourceRecords,
        understat: { records: [], status: "found" },
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

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        "Look up Harry Kane.": requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
      }),
      tools: [createSearchTool(search)],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Look up Harry Kane.")] },
      { configurable: { thread_id: "exact-id-lookup" } }
    );

    expect(search.mock.calls[0]?.[0]).toStrictEqual({
      sourceRecords: [
        { provider: "fm", sourceId: "kane-fm" },
        { provider: "understat", sourceId: "kane-understat" },
      ],
    });
    expect(
      result.messages.some((message) => message instanceof ToolMessage)
    ).toBeTruthy();
    expect(result.conversationContext.focusPlayers).toMatchObject([
      { referenceId: "canonical-kane" },
    ]);
    expect(result.messages.at(-1)?.content).toBe(
      "I found the confirmed player's records."
    );
  });

  it("does not change conversation focus when the confirmed identity has no local data", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const search = vi.fn<PlayerSearch>(emptySearchResult);

    const model = fakeModel()
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("No local records were found."));

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        "Look up Harry Kane.": requestForPlayers("player_lookup", [
          "Harry Kane",
        ]),
      }),
      tools: [createSearchTool(search)],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Look up Harry Kane.")] },
      { configurable: { thread_id: "lookup-without-data" } }
    );

    expect({
      focusPlayers: result.conversationContext.focusPlayers,
      sourceRecords: search.mock.calls[0]?.[0].sourceRecords,
    }).toStrictEqual({
      focusPlayers: [],
      sourceRecords: [
        { provider: "fm", sourceId: "kane-fm" },
        { provider: "understat", sourceId: "kane-understat" },
      ],
    });
  });

  it("answers a lookup follow-up from the saved result without rerunning the search", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const firstMessage = "Look up Harry Kane.";
    const followUp = "Which season was it?";

    const lookupResult = JSON.stringify({
      fm: { records: [], status: "found" },
      identityGroups: { canonicalGroups: [] },
      query: [],
      understat: { records: [], status: "found" },
    });

    const search = vi.fn<PlayerSearch>(() => lookupResult);

    const model = fakeModel()
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("The local records are loaded."))
      .respond(new AIMessage("The saved result covers the 2025/26 season."));

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [firstMessage]: requestForPlayers("player_lookup", ["Harry Kane"]),
        [followUp]: requestForPlayers("player_lookup", []),
      }),
      tools: [createSearchTool(search)],
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
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      activeLookup: lookupResult,
      followUpAnswer: "The saved result covers the 2025/26 season.",
      searchCalls: 1,
    });
  });

  it("remembers a confirmed Chinese alias and resolves it without another identity lookup", async () => {
    const kimmich = playerCandidate("Joshua Kimmich", "kimmich");

    const identityLookup = vi.fn<ReferenceIdentityLookup>((mention) => ({
      candidateCount: 1,
      candidates: [kimmich],
      candidatesTruncated: false,
      canonicalIdentityId: null,
      clarificationMessage: `Confirm whether “${mention}” means Joshua Kimmich.`,
      mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "needs_confirmation",
    }));

    const search = vi.fn<PlayerSearch>((input) =>
      JSON.stringify({
        fm: { records: [], status: "found" },
        identityGroups: { canonicalGroups: [] },
        query: input.sourceRecords,
      })
    );

    const model = fakeModel()
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("The first Kimmich lookup is complete."))
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("The repeated Kimmich lookup is complete."));

    const first = "查询基米希的资料";
    const second = "再介绍一下基米希";

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createExtractor({
        [first]: requestForPlayers("player_lookup", ["基米希"]),
        [second]: requestForPlayers("player_lookup", ["基米希"]),
      }),
      tools: [createSearchTool(search)],
    });

    const config = {
      configurable: { thread_id: "confirmed-alias-thread" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(first)] },
      config
    );

    const completed = await graph.invoke(new Command({ resume: "1" }), config);

    const repeated = await graph.invoke(
      { messages: [new HumanMessage(second)] },
      config
    );

    expect(interrupted).toHaveProperty("__interrupt__");
    expect(identityLookup).toHaveBeenCalledOnce();
    expect(
      search.mock.calls.map(([input]) => input.sourceRecords)
    ).toStrictEqual([
      [
        { provider: "fm", sourceId: "kimmich-fm" },
        { provider: "understat", sourceId: "kimmich-understat" },
      ],
      [
        { provider: "fm", sourceId: "kimmich-fm" },
        { provider: "understat", sourceId: "kimmich-understat" },
      ],
    ]);
    expect(completed.conversationContext.playerAliases).toMatchObject([
      {
        mention: "基米希",
        reference: { referenceId: "canonical-kimmich" },
      },
    ]);
    expect(repeated.messages.at(-1)?.content).toBe(
      "The repeated Kimmich lookup is complete."
    );
  });

  it("executes comparison directly and commits an empty completed comparison for later additions", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const mbappe = playerCandidate("Kylian Mbappé", "mbappe");
    const parrott = playerCandidate("Troy Parrott", "parrott");

    const candidates = new Map(
      [kane, mbappe, parrott].map((candidate) => [candidate.name, candidate])
    );

    const identityLookup: ReferenceIdentityLookup = (mention) => {
      const candidate = candidates.get(mention);

      if (candidate === undefined) {
        throw new Error(`Unexpected identity lookup: ${mention}`);
      }

      return {
        candidateCount: 1,
        candidates: [candidate],
        candidatesTruncated: false,
        canonicalIdentityId: candidate.canonicalIdentityId,
        clarificationMessage: null,
        mention,
        selectedCandidateId: candidate.candidateId,
        selectedName: candidate.name,
        status: "resolved",
      };
    };

    const search = vi.fn<PlayerSearch>(emptySearchResult);
    const firstMessage = "Compare Harry Kane and Kylian Mbappé.";
    const addMessage = "Add Troy Parrott to the comparison.";

    const model = fakeModel()
      .respond(new AIMessage("No comparable data was available."))
      .respond(new AIMessage("The three-player comparison was checked."));

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createExtractor({
        [addMessage]: requestForPlayers("player_comparison", ["Troy Parrott"], {
          comparisonAction: "add",
        }),
        [firstMessage]: requestForPlayers("player_comparison", [
          "Harry Kane",
          "Kylian Mbappé",
        ]),
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "comparison-thread" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const completed = await graph.invoke(
      { messages: [new HumanMessage(addMessage)] },
      config
    );

    expect(search).toHaveBeenCalledTimes(5);
    expect(search.mock.calls[0]?.[0].sourceRecords).toStrictEqual([
      { provider: "fm", sourceId: "kane-fm" },
      { provider: "understat", sourceId: "kane-understat" },
    ]);
    expect(completed.conversationContext.activeComparison.players).toHaveLength(
      3
    );
    expect(
      search.mock.calls
        .slice(2)
        .map(([query]) => query.sourceRecords[0]?.sourceId)
    ).toStrictEqual(["kane-fm", "mbappe-fm", "parrott-fm"]);
    expect(completed.messages.at(-1)?.content).toBe(
      "The three-player comparison was checked."
    );
  });

  it("resumes position clarification and refines a completed recommendation without losing identities", async () => {
    const kane = playerCandidate("Harry Kane", "kane");

    const recommend = vi
      .fn<RecommendPlayerCandidates>(() =>
        JSON.stringify({ position: "stc", status: "no_candidates" })
      )
      .mockReturnValueOnce(
        JSON.stringify({
          commonNaturalPositions: ["stc", "mc"],
          positionOptions: ["stc", "mc"],
          references: [],
          status: "position_required",
        })
      )
      .mockReturnValue(
        JSON.stringify({ position: "stc", status: "no_candidates" })
      );

    const initialMessage = "Find young high-potential alternatives to Kane.";
    const refineMessage = "只看当前能力，不考虑 PA";

    const extractor: RequestUnderstandingExtractor = async (message) => {
      if (message === initialMessage) {
        return await Promise.resolve(
          requestForPlayers("player_recommendation", ["Kane"], {
            recommendation: {
              includePotential: true,
              maxAge: 23,
              position: null,
              resultLimit: 5,
            },
            recommendationAction: "replace",
          })
        );
      }

      return await Promise.resolve(
        requestForPlayers("player_recommendation", [], {
          recommendation: { includePotential: true },
        })
      );
    };

    const model = fakeModel()
      .respond(new AIMessage("No candidates meet the requested filters."))
      .respond(new AIMessage("The refined list still has no candidates."));

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: extractor,
      tools: createTools(emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "recommendation-refinement-thread" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(initialMessage)] },
      config
    );

    const completed = await graph.invoke(
      new Command({ resume: "中锋" }),
      config
    );

    const refined = await graph.invoke(
      { messages: [new HumanMessage(refineMessage)] },
      config
    );

    expect({
      completedRecommendation:
        completed.conversationContext.activeRecommendation,
      initialInput: recommend.mock.calls[0]?.[0],
      interrupted: Object.hasOwn(interrupted, "__interrupt__"),
      refineInput: recommend.mock.calls[2]?.[0],
      refinedRecommendation: refined.conversationContext.activeRecommendation,
      resumedPosition: recommend.mock.calls[1]?.[0].position,
      toolCalls: recommend.mock.calls.length,
    }).toMatchObject({
      completedRecommendation: {
        maxAge: 23,
        position: "stc",
        referencePlayers: [{ referenceId: "canonical-kane" }],
        status: "no_candidates",
      },
      initialInput: {
        includePotential: true,
        maxAge: 23,
        position: null,
        referenceGroups: [{ fmIds: ["kane-fm"] }],
      },
      interrupted: true,
      refineInput: {
        includePotential: false,
        maxAge: 23,
        minimumPotentialAbility: null,
        position: "stc",
        referenceGroups: [{ fmIds: ["kane-fm"] }],
      },
      refinedRecommendation: {
        includePotential: false,
        referencePlayers: [{ referenceId: "canonical-kane" }],
      },
      resumedPosition: "stc",
      toolCalls: 3,
    });
  });

  it("asks the user to choose a source profile when one identity has multiple FM records", async () => {
    const kane = playerCandidate("Harry Kane", "kane");

    const firstFmRecord = kane.records.find(
      (record) => record.provider === "fm"
    );

    if (firstFmRecord === undefined) {
      throw new Error("The Kane fixture needs an FM profile.");
    }

    const multiProfileKane: ReferenceCandidate = {
      ...kane,
      records: [...kane.records, { ...firstFmRecord, sourceId: "kane-fm-alt" }],
    };

    const recommend = vi.fn<RecommendPlayerCandidates>(() =>
      JSON.stringify({ position: "stc", status: "no_candidates" })
    );

    const message = "Find STC alternatives to Kane.";

    const graph = createAgent({
      model: fakeModel().respond(new AIMessage("No candidates were found.")),
      playerIdentityLookup: resolvedLookup(multiProfileKane),
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_recommendation", ["Kane"], {
          recommendation: { includePotential: false, position: "stc" },
        }),
      }),
      tools: createTools(emptySearch, recommend),
    });

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "ambiguous-fm-profile" } }
    );

    const resumed = await graph.invoke(new Command({ resume: "2" }), {
      configurable: { thread_id: "ambiguous-fm-profile" },
    });

    expect({
      interrupted: Object.hasOwn(interrupted, "__interrupt__"),
      savedFmIds:
        resumed.conversationContext.activeRecommendation?.referencePlayers[0]?.candidate.records
          .filter((record) => record.provider === "fm")
          .map((record) => record.sourceId),
      selectedFmIds: recommend.mock.calls[0]?.[0].referenceGroups[0]?.fmIds,
      toolCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      interrupted: true,
      savedFmIds: ["kane-fm-alt"],
      selectedFmIds: ["kane-fm-alt"],
      toolCalls: 1,
    });
  });

  it("does not run a recommendation when an extracted hard condition is unsupported", async () => {
    const kane = playerCandidate("Harry Kane", "kane");

    const recommend = vi.fn<RecommendPlayerCandidates>(() =>
      JSON.stringify({ position: "stc", status: "ready" })
    );

    const message = "Find alternatives to Kane under a £50m budget.";

    const graph = createAgent({
      model: fakeModel(),
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_recommendation", ["Kane"], {
          constraints: [{ name: "budget", value: "£50m" }],
          recommendation: {
            includePotential: false,
            position: "stc",
            resultLimit: 5,
          },
        }),
      }),
      tools: createTools(emptySearch, recommend),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "unsupported-recommendation-condition" } }
    );

    expect(recommend).not.toHaveBeenCalled();
    expect(result.messages.at(-1)?.content).toContain(
      "没有按删减后的条件生成候选"
    );
    expect(result.conversationContext.activeRecommendation).toBeNull();
  });

  it("clarifies a vague youth request and resumes with the retained reference player", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const message = "Find young alternatives to Kane.";

    const recommend = vi.fn<RecommendPlayerCandidates>(() =>
      JSON.stringify({ position: "stc", status: "ready" })
    );

    const graph = createAgent({
      model: fakeModel().respond(
        new AIMessage("The age-limited list is ready.")
      ),
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_recommendation", ["Kane"], {
          recommendation: { includePotential: true, position: "stc" },
        }),
      }),
      tools: createTools(emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "youth-age-clarification" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      config
    );

    const resumed = await graph.invoke(
      new Command({ resume: "23岁以下" }),
      config
    );

    expect({
      ageLimit: recommend.mock.calls[0]?.[0].maxAge,
      interrupted: Object.hasOwn(interrupted, "__interrupt__"),
      referenceGroups: recommend.mock.calls[0]?.[0].referenceGroups,
      savedAge: resumed.conversationContext.activeRecommendation?.maxAge,
    }).toMatchObject({
      ageLimit: 23,
      interrupted: true,
      referenceGroups: [{ fmIds: ["kane-fm"] }],
      savedAge: 23,
    });
  });

  it("preserves reference and exclusion roles when the extractor misses confirmed aliases", async () => {
    const kimmich = playerCandidate("Joshua Kimmich", "kimmich");
    const haaland = playerCandidate("Erling Haaland", "haaland");
    const message = "给基米希找替代者，不要哈兰德";

    const identityLookup = vi.fn<ReferenceIdentityLookup>(() => {
      throw new Error("Confirmed aliases should not be re-resolved.");
    });

    const recommend = vi.fn<RecommendPlayerCandidates>(() =>
      JSON.stringify({ position: "stc", status: "ready" })
    );

    const conversationContext = {
      ...createInitialConversationContext(),
      playerAliases: [
        {
          mention: "基米希",
          reference: {
            candidate: kimmich,
            referenceId: "canonical-kimmich",
          },
        },
        {
          mention: "哈兰德",
          reference: {
            candidate: haaland,
            referenceId: "canonical-haaland",
          },
        },
      ],
    };

    const graph = createAgent({
      model: fakeModel().respond(new AIMessage("The exclusion was applied.")),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_recommendation", [], {
          recommendation: { includePotential: false, position: "stc" },
        }),
      }),
      tools: createTools(emptySearch, recommend),
    });

    const result = await graph.invoke(
      {
        conversationContext,
        messages: [new HumanMessage(message)],
      },
      { configurable: { thread_id: "alias-recommendation-roles" } }
    );

    expect({
      excludeGroups: recommend.mock.calls[0]?.[0].excludeGroups,
      identityLookups: identityLookup.mock.calls.length,
      referenceGroups: recommend.mock.calls[0]?.[0].referenceGroups,
      roles: result.request.players.map((player) => player.recommendationRole),
    }).toMatchObject({
      excludeGroups: [{ fmIds: ["haaland-fm"] }],
      identityLookups: 0,
      referenceGroups: [{ fmIds: ["kimmich-fm"] }],
      roles: ["reference", "exclude"],
    });
  });

  it("commits an already resolved participant alias before interrupting on another identity", async () => {
    const kimmich = playerCandidate("Joshua Kimmich", "kimmich");
    const kane = playerCandidate("Harry Kane", "kane");
    const message = "Compare Joshua Kimmich and Harry Kane.";

    const identityLookup: ReferenceIdentityLookup = (mention) =>
      mention === "Joshua Kimmich"
        ? {
            candidateCount: 1,
            candidates: [kimmich],
            candidatesTruncated: false,
            canonicalIdentityId: kimmich.canonicalIdentityId,
            clarificationMessage: null,
            mention,
            selectedCandidateId: kimmich.candidateId,
            selectedName: kimmich.name,
            status: "resolved",
          }
        : {
            candidateCount: 1,
            candidates: [kane],
            candidatesTruncated: false,
            canonicalIdentityId: null,
            clarificationMessage: "Please confirm Harry Kane.",
            mention,
            selectedCandidateId: null,
            selectedName: null,
            status: "needs_confirmation",
          };

    const search = vi.fn<PlayerSearch>(emptySearchResult);

    const graph = createAgent({
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_comparison", [
          "Joshua Kimmich",
          "Harry Kane",
        ]),
      }),
      tools: createTools(search),
    });

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "early-alias-commit" } }
    );

    expect({
      confirmedAlias: interrupted.conversationContext.playerAliases,
      focusPlayers: interrupted.conversationContext.focusPlayers,
      interrupted: Object.hasOwn(interrupted, "__interrupt__"),
      searchCalls: search.mock.calls.length,
    }).toMatchObject({
      confirmedAlias: [
        {
          mention: "Joshua Kimmich",
          reference: { referenceId: "canonical-kimmich" },
        },
      ],
      focusPlayers: [],
      interrupted: true,
      searchCalls: 0,
    });
  });

  it("propagates unexpected tool errors without replacing the last successful recommendation", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const firstMessage = "Find striker alternatives to Kane under 23.";
    const refineMessage = "Lower the age limit to 21.";
    const readyResult = JSON.stringify({ position: "stc", status: "ready" });

    const recommend = vi
      .fn<RecommendPlayerCandidates>(() => readyResult)
      .mockReturnValueOnce(readyResult)
      .mockImplementationOnce(() => {
        throw new Error("Fixture recommendation read failed.");
      });

    const model = fakeModel().respond(
      new AIMessage("The first list is ready.")
    );

    const extractor: RequestUnderstandingExtractor = async (message) => {
      const selectedRequest =
        message === firstMessage
          ? requestForPlayers("player_recommendation", ["Kane"], {
              recommendation: {
                includePotential: false,
                maxAge: 23,
                position: "stc",
              },
            })
          : requestForPlayers("player_recommendation", [], {
              recommendation: { maxAge: 21 },
            });

      return await Promise.resolve(selectedRequest);
    };

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: extractor,
      tools: createTools(emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "recommendation-tool-failure" },
    };

    const first = await graph.invoke(
      { messages: [new HumanMessage(firstMessage)] },
      config
    );

    const previousRecommendation =
      first.conversationContext.activeRecommendation;

    await expect(
      graph.invoke({ messages: [new HumanMessage(refineMessage)] }, config)
    ).rejects.toThrow("Fixture recommendation read failed.");

    const failedState = z
      .object({
        values: z.object({
          conversationContext: z.object({
            activeRecommendation: ActiveRecommendationSchema.nullable(),
          }),
        }),
      })
      .safeParse(structuredClone(await graph.getState(config)));

    expect({
      activeRecommendation: failedState.success
        ? failedState.data.values.conversationContext.activeRecommendation
        : null,
      toolCalls: recommend.mock.calls.length,
    }).toMatchObject({
      activeRecommendation: previousRecommendation,
      toolCalls: 2,
    });
  });
});
