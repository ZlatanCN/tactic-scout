import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import {
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import { createAnswerNode } from "../src/nodes/assistant.js";
import type { ReferenceIdentityLookup } from "../src/player-data/resolve-reference.js";
import type { PlayerSearch } from "../src/player-data/search-records.js";
import { createRequestUnderstandingExtractor } from "../src/request-extraction.js";
import type { RequestUnderstandingExtractor } from "../src/request-extraction.js";
import type { ReferenceCandidate } from "../src/state.js";
import {
  ActiveRecommendationSchema,
  AgentState,
  createInitialConversationContext,
} from "../src/state.js";
import type { RecommendPlayerCandidates } from "../src/tools/recommend-player-candidates.js";
import type { RecommendTeamPlayerCandidatesInput } from "../src/tools/recommend-team-player-candidates.js";
import type { PlayerSearchInput } from "../src/tools/search-player-records.js";
import {
  recommendationResult,
  recommendationResultData,
  teamRecommendationResult,
} from "./fixtures/workflow-results.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../src/agent.js");
const { createTools } = await import("../src/tools/search-player-records.js");

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

type EmptySearchResult = {
  fm?: { records: unknown[]; status: "not_found" };
  identityGroups: {
    canonicalGroups: unknown[];
    registryStatus: "not_needed";
    unlinkedRecords: unknown[];
  };
  query: PlayerSearchInput["sourceRecords"];
  requestedUnderstatSeasonStartYear?: number | null;
  understat?: { records: unknown[]; status: "not_found" };
};

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

const resolvedLookupFromCandidates = (
  candidates: ReferenceCandidate[]
): ReferenceIdentityLookup => {
  const byName = new Map(
    candidates.map((candidate) => [candidate.name, candidate])
  );

  return async (mention) => {
    const candidate = await Promise.resolve(byName.get(mention));

    if (candidate === undefined) {
      throw new Error(`Unexpected identity lookup: ${mention}`);
    }

    return await resolvedLookup(candidate)(mention);
  };
};

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

const emptySearchResult = (input: PlayerSearchInput): string => {
  const hasFmSource = input.sourceRecords.some(
    ({ provider }) => provider === "fm"
  );

  const hasUnderstatSource = input.sourceRecords.some(
    ({ provider }) => provider === "understat"
  );

  const result: EmptySearchResult = {
    identityGroups: {
      canonicalGroups: [],
      registryStatus: "not_needed",
      unlinkedRecords: [],
    },
    query: input.sourceRecords,
  };

  if (hasFmSource) {
    result.fm = { records: [], status: "not_found" };
  }

  if (hasUnderstatSource) {
    result.requestedUnderstatSeasonStartYear = input.seasonStartYear ?? null;
    result.understat = { records: [], status: "not_found" };
  }

  return JSON.stringify(result);
};

const emptySearch: PlayerSearch = (input) => emptySearchResult(input);

const fmRecord = (name: string, sourceRecordId: string) => ({
  attributes: {
    accelerationRaw: null,
    decisionsRaw: null,
    finishingRaw: null,
    first_touchRaw: null,
    off_the_ballRaw: null,
    paceRaw: null,
    passingRaw: null,
    strengthRaw: null,
    techniqueRaw: null,
    visionRaw: null,
  },
  birthDate: null,
  currentAbility: null,
  heightCm: null,
  identitySourceId: sourceRecordId,
  naturalPositions: null,
  player: name,
  potentialAbility: null,
  source: "Football Manager",
  sourceRecordId,
});

const createSearchTool = (search: PlayerSearch) => createTools(search)[0];

describe("LangGraph player workflows", () => {
  it("pins an explicit lookup season to the resolved source records", async () => {
    const mbappe = playerCandidate("Kylian Mbappé", "mbappe");
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

    const lookupTool = createSearchTool(search);
    const modelWithTools = model.bindTools([lookupTool]);
    const lookupModelInvoke = vi.spyOn(modelWithTools, "invoke");
    vi.spyOn(model, "bindTools").mockReturnValue(modelWithTools);

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(mbappe),
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_lookup", [mbappe.name]),
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
    const kane = playerCandidate("Harry Kane", "kane");
    const message = "Look up Harry Kane.";
    const search = vi.fn<PlayerSearch>(emptySearchResult);

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

    const lookupTool = createSearchTool(search);

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_lookup", [kane.name]),
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
    const mbappe = playerCandidate("Kylian Mbappé", "mbappe");
    const message = "Look up Kylian Mbappé's 2024/25 La Liga xG.";
    const search = vi.fn<PlayerSearch>(emptySearchResult);

    const model = fakeModel()
      .respond(
        new AIMessage(
          "I need the identity-resolved Understat source ID to look this up."
        )
      )
      .respond(new AIMessage("The requested season was searched."));

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(mbappe),
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_lookup", [mbappe.name], {
          constraints: [{ name: "understatSeasonStartYear", value: "2024" }],
        }),
      }),
      tools: [createSearchTool(search)],
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
      const kane = playerCandidate("Harry Kane", "kane");
      const search = vi.fn<PlayerSearch>(emptySearchResult);

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

      const lookupTool = createSearchTool(search);

      const graph = createAgent({
        model,
        playerIdentityLookup: resolvedLookup(kane),
        requestUnderstandingExtractor: createExtractor({
          [message]: requestForPlayers("player_lookup", [kane.name], {
            constraints: [{ name: "understatSeasonStartYear", value: "2024" }],
          }),
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
    const kane = playerCandidate("Harry Kane", "kane");

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
    const kane = playerCandidate("Harry Kane", "kane");
    const firstMessage = "Look up Harry Kane.";
    const secondMessage = "Look up Erling Haaland.";
    const search = vi.fn<PlayerSearch>(emptySearchResult);
    let identityLookups = 0;

    const graph = createAgent({
      model: fakeModel()
        .respondWithTools([
          { args: { sourceRecords: [] }, name: "search_player_records" },
        ])
        .respond(new AIMessage("The lookup is complete.")),
      playerIdentityLookup: async (mention) => {
        identityLookups += 1;

        if (identityLookups === 1) {
          return await resolvedLookup(kane)(mention);
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
      requestUnderstandingExtractor: createExtractor({
        [firstMessage]: requestForPlayers("player_lookup", [kane.name]),
        [secondMessage]: requestForPlayers("player_lookup", ["Erling Haaland"]),
      }),
      tools: [createSearchTool(search)],
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
    const kane = playerCandidate("Harry Kane", "kane");
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
        "球员查询模型暂时不可用，本次查询未能完成。请稍后重试。此前已完成的结果仍保留。",
      modelCalls: 5,
      searchCalls: 1,
    });
  });

  it("does not answer a lookup follow-up from an older player after a different lookup fails", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const mbappe = playerCandidate("Kylian Mbappé", "mbappe");
    const firstMessage = "Look up Harry Kane.";
    const failedMessage = "Look up Kylian Mbappé again.";
    const followUp = "Which season was in the previous lookup?";

    const search = vi
      .fn<PlayerSearch>(emptySearchResult)
      .mockImplementationOnce(emptySearchResult);

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

    const identityLookup = resolvedLookupFromCandidates([kane, mbappe]);

    const model = fakeModel()
      .respondWithTools([searchCall])
      .respond(new AIMessage("Harry Kane's data loaded."))
      .respondWithTools([searchCall]);

    const graph = createAgent({
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createExtractor({
        [failedMessage]: requestForPlayers("player_lookup", ["Kylian Mbappé"]),
        [firstMessage]: requestForPlayers("player_lookup", ["Harry Kane"]),
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
      tools: [createSearchTool(search)],
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

  it("reuses a saved lookup when a follow-up names a data source, not another player", async () => {
    const player = playerCandidate("Mikel Oyarzabal", "mikel");

    const firstMessage =
      "Look up Mikel Oyarzabal's 2026/27 La Liga FM profile and performance.";

    const followUp = "What xA did Understat report?";

    const search = vi.fn<PlayerSearch>((input) =>
      JSON.stringify({
        fm: { records: [fmRecord(player.name, "mikel-fm")], status: "found" },
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

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: resolvedLookup(player),
      requestUnderstandingExtractor: createExtractor({
        [firstMessage]: requestForPlayers("player_lookup", [player.name]),
        [followUp]: requestForPlayers("player_lookup", ["Understat"]),
      }),
      tools: [createSearchTool(search)],
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

    expect({
      answer: result.messages.at(-1)?.content,
      firstActiveLookup:
        firstResult.conversationContext.activeLookup?.player.candidate.name,
      firstOutcome: firstResult.outcome?.status,
      lookupFollowUp: result.outcome?.status,
      requestPlayers: result.request.players,
      searchCalls: search.mock.calls.length,
    }).toMatchObject({
      answer: "The saved Understat result reports xA 1.41.",
      firstActiveLookup: "Mikel Oyarzabal",
      firstOutcome: "answer_ready",
      lookupFollowUp: "lookup_follow_up",
      requestPlayers: [],
      searchCalls: 1,
    });
  });

  it("retains a completed player recommendation when its final explanation fails", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const message = "Find striker alternatives to Kane.";
    const recommendation = recommendationResult("ready");
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
        result.conversationContext.activeRecommendation?.status,
      answer: result.messages.at(-1)?.content,
      outcome: result.outcome?.status,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      activeRecommendation: "ready",
      answer:
        "数据查询或计算已经完成，但模型暂时无法生成解释。已完成的结构化结果仍保留，可以继续追问。",
      outcome: "ready",
      recommendationCalls: 1,
    });
  });

  it("explains a saved player recommendation without rerunning identity or data tools", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const firstMessage = "Find striker alternatives to Kane.";
    const explainMessage = "Explain the previous player recommendation.";

    const wrongTargetMessage =
      "Explain the previous player recommendation for Kylian Mbappé.";

    const recommendation = recommendationResult("no_candidates");
    const recommend = vi.fn<RecommendPlayerCandidates>(() => recommendation);
    const identityLookup = vi.fn<ReferenceIdentityLookup>(resolvedLookup(kane));

    const model = fakeModel()
      .respond(new AIMessage("No candidates were returned."))
      .respond(new AIMessage("The saved result contains no candidates."));

    const graph = createAgent({
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createExtractor({
        [explainMessage]: {
          constraints: [],
          continuationAction: "explain",
          kind: "player_recommendation",
          players: [],
          teams: [],
        },
        [firstMessage]: requestForPlayers("player_recommendation", ["Kane"], {
          recommendation: { position: "stc" },
        }),
        [wrongTargetMessage]: requestForPlayers(
          "player_recommendation",
          ["Kylian Mbappé"],
          { continuationAction: "explain" }
        ),
      }),
      tools: createTools(emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "saved-recommendation-explanation" },
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
      identityLookups: identityLookup.mock.calls.length,
      outcomeSource:
        outcome !== null && outcome !== undefined && "source" in outcome
          ? outcome.source
          : null,
      outcomeStatus: outcome?.status,
      recommendationCalls: recommend.mock.calls.length,
      repeatedIdentityLookups: identityLookup.mock.calls.length,
      unrelatedAnswer: unrelatedExplanation.messages.at(-1)?.content,
      unrelatedOutcome: unrelatedExplanation.outcome?.status,
    }).toStrictEqual({
      answer: "The saved result contains no candidates.",
      identityLookups: 1,
      outcomeSource: "saved",
      outcomeStatus: "no_candidates",
      recommendationCalls: 1,
      repeatedIdentityLookups: 1,
      unrelatedAnswer:
        "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。",
      unrelatedOutcome: "saved_result_unavailable",
    });
  });

  it("instructs recommendation answers to include every candidate's CA and PA", async () => {
    const kane = playerCandidate("Harry Kane", "kane");

    const message =
      "Find high-potential striker alternatives to Kane aged 21 or younger.";

    const defaults = recommendationResultData("ready", "stc", {
      filters: {
        includePotential: true,
        maxAge: 21,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        resultLimit: 5,
      },
    });

    const recommendation = JSON.stringify({
      ...defaults,
      currentCandidates: [
        {
          age: 21,
          attributes: [],
          currentAbility: 146,
          currentDistance: 0.47,
          fmId: "fm-close-01",
          name: "Synthetic Close Candidate",
          positionRating: 20,
          potentialAbility: 181,
          rank: 1,
          sourceRecordId: "fm-close-record-01",
        },
        {
          age: 18,
          attributes: [],
          currentAbility: 124,
          currentDistance: 2.71,
          fmId: "fm-future-01",
          name: "Synthetic Future Prospect",
          positionRating: 19,
          potentialAbility: 195,
          rank: 2,
          sourceRecordId: "fm-future-record-01",
        },
      ],
      filterCounts: {
        ...defaults.filterCounts,
        excludedMissingPotentialForPotentialList: 1,
      },
      potentialCandidates: [
        {
          age: 19,
          attributes: [],
          currentAbility: 121,
          currentDistance: 3.42,
          fmId: "fm-high-pa-01",
          name: "Synthetic High Potential Candidate",
          positionRating: 18,
          potentialAbility: 199,
          rank: 1,
          sourceRecordId: "fm-high-pa-record-01",
        },
      ],
      references: [
        {
          currentAbility: 150,
          fmId: "fm-ref-01",
          name: "Synthetic Reference",
          positionRating: 20,
          potentialAbility: 178,
          sourceRecordId: "fm-ref-record-01",
        },
      ],
    });

    const model = fakeModel().respond(
      new AIMessage("The candidate list is ready.")
    );

    const modelInvoke = vi.spyOn(model, "invoke");

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [message]: requestForPlayers("player_recommendation", ["Kane"], {
          recommendation: {
            includePotential: true,
            maxAge: 21,
            position: "stc",
          },
        }),
      }),
      tools: createTools(emptySearch, () => recommendation),
    });

    await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "recommendation-answer-completeness" } }
    );

    const modelInput = JSON.stringify(modelInvoke.mock.calls.at(-1)?.[0]);

    const filterStagesFullyDefined = [
      "afterPotentialAbility 是再应用 PA 条件后的数量",
      "afterIdentityExclusion 是应用请求中的身份排除规则后剩余的数量",
      "currentAttributeComplete 是身份排除后属性完整、能计算 currentDistance 的数量",
      "除非工具列出具体对象，否则不要推断具体排除了谁或属于哪类身份",
      "名单长度不等于任何阶段数量",
      "球员推荐只能从 filters.resultLimit 读取名单上限",
      "resultLimit 分别限制 currentCandidates 和 potentialCandidates 各自的名单数",
      "resultLimit 为 1 时，两份名单可以各返回 1 名球员",
      "不得从名单长度或 afterIdentityExclusion 推断上限",
    ].every((promptRule) => modelInput.includes(promptRule));

    expect({
      allCurrentCandidates: modelInput.includes(
        "逐条列出 currentCandidates 中的每一个候选"
      ),
      allPotentialCandidates: modelInput.includes(
        "高潜名单的每一行也必须包括姓名、FM ID、年龄、位置评分、CA、PA 和 currentDistance"
      ),
      filterStagesFullyDefined:
        filterStagesFullyDefined &&
        !modelInput.includes("球队推荐中的队内球员"),
      filteredCounts: modelInput.includes(
        "filterCounts.eligiblePositionProfiles"
      ),
      missingPa: modelInput.includes("potentialAbility 为 null"),
      paContextOnly: modelInput.includes("PA 仅作为资料展示"),
      positionRatingScaleBounded: modelInput.includes(
        "位置评分只报告工具返回的数值"
      ),
      potentialCandidateDataPassed:
        modelInput.includes("Synthetic High Potential Candidate") &&
        modelInput.includes("199") &&
        modelInput.includes("3.42"),
      zeroPositionProfilesOnlyWhenCountIsZero: modelInput.includes(
        "只有 filterCounts.eligiblePositionProfiles 为 0，才能说没有位置合格画像"
      ),
    }).toStrictEqual({
      allCurrentCandidates: true,
      allPotentialCandidates: true,
      filterStagesFullyDefined: true,
      filteredCounts: true,
      missingPa: true,
      paContextOnly: true,
      positionRatingScaleBounded: true,
      potentialCandidateDataPassed: true,
      zeroPositionProfilesOnlyWhenCountIsZero: true,
    });
  });

  it("uses structured candidates when an answer claims a nonempty current list is empty", async () => {
    const candidate = {
      age: 23,
      attributes: [],
      currentAbility: 135,
      currentDistance: 13.2916,
      fmId: "fm-ansu-fati",
      name: "Ansu Fati",
      positionRating: 17,
      potentialAbility: 175,
      rank: 1,
      sourceRecordId: "fm-ansu-fati-record",
    };

    const recommendation = recommendationResultData("ready", "stc", {
      currentCandidates: [candidate],
      filters: {
        includePotential: true,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: 175,
        resultLimit: 5,
      },
      potentialCandidates: [candidate],
    });

    const state = AgentState.parse({
      messages: [
        new HumanMessage(
          "根据 Synthetic Reference 推荐 PA 至少 175 的 STC 高潜球员。"
        ),
      ],
      outcome: {
        kind: "player_recommendation",
        resultJson: JSON.stringify(recommendation),
        source: "executed",
        status: "ready",
      },
    });

    const graph = new StateGraph(AgentState)
      .addNode(
        "answer",
        createAnswerNode(
          fakeModel().respond(
            new AIMessage(
              "当前能力相似名单为空，因此没有可列出的 currentDistance 排名候选。高潜名单包含 Ansu Fati。"
            )
          )
        )
      )
      .addEdge(START, "answer")
      .addEdge("answer", END)
      .compile();

    const result = await graph.invoke(state);
    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect(answer).toContain("Ansu Fati");
    expect(answer).toContain("PA 下限 175");
    expect(answer).toContain("currentDistance 13.2916");
    expect(answer).not.toContain("当前能力相似名单为空");
  });

  it("uses structured filters when an answer claims unset filters were applied", async () => {
    const candidate = {
      age: 24,
      attributes: [],
      currentAbility: 140,
      currentDistance: 0.5,
      fmId: "fm-filter-candidate",
      name: "Filter Candidate",
      positionRating: 20,
      potentialAbility: 160,
      rank: 1,
      sourceRecordId: "fm-filter-candidate-record",
    };

    const recommendation = recommendationResultData("ready", "stc", {
      currentCandidates: [candidate],
      filterCounts: {
        afterAge: 5,
        afterCurrentAbility: 5,
        afterIdentityExclusion: 5,
        afterPotentialAbility: 5,
        currentAttributeComplete: 5,
        eligiblePositionProfiles: 5,
        excludedMissingAttribute: 0,
        excludedMissingFmIdCandidates: 0,
        excludedMissingPotentialForPotentialList: 0,
      },
      filters: {
        includePotential: false,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        resultLimit: 5,
      },
    });

    const state = AgentState.parse({
      messages: [
        new HumanMessage("根据 Synthetic Reference 推荐 STC 位置相似球员。"),
      ],
      outcome: {
        kind: "player_recommendation",
        resultJson: JSON.stringify(recommendation),
        source: "executed",
        status: "ready",
      },
    });

    const graph = new StateGraph(AgentState)
      .addNode(
        "answer",
        createAnswerNode(
          fakeModel().respond(
            new AIMessage(
              "应用年龄、CA 和 PA 条件后各阶段均为 5 人；应用身份排除规则后为 3 人。"
            )
          )
        )
      )
      .addEdge(START, "answer")
      .addEdge("answer", END)
      .compile();

    const result = await graph.invoke(state);
    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      ageAppliedClaim: answer.includes("应用年龄条件后"),
      ageAsOfDate: answer.includes("年龄按 2026-11-04 计算"),
      caAppliedClaim: answer.includes("应用 CA 条件后"),
      noAgeFilter: answer.includes("年龄限制未设置"),
      noCaFilter: answer.includes("CA 下限未设置"),
      noPaFilter: answer.includes("PA 下限未设置"),
      paAppliedClaim: answer.includes("应用 PA 条件后"),
    }).toStrictEqual({
      ageAppliedClaim: false,
      ageAsOfDate: true,
      caAppliedClaim: false,
      noAgeFilter: true,
      noCaFilter: true,
      noPaFilter: true,
      paAppliedClaim: false,
    });
  });

  it("applies recommendation corrections to content-block model answers", async () => {
    const resultJson = recommendationResult("ready", "stc");

    const state = AgentState.parse({
      messages: [new HumanMessage("Recommend STC players.")],
      outcome: {
        kind: "player_recommendation",
        resultJson,
        source: "executed",
        status: "ready",
      },
    });

    const graph = new StateGraph(AgentState)
      .addNode(
        "answer",
        createAnswerNode(
          fakeModel().respond(
            new AIMessage([{ text: "年龄范围已用于筛选候选。", type: "text" }])
          )
        )
      )
      .addEdge(START, "answer")
      .addEdge("answer", END)
      .compile();

    const result = await graph.invoke(state);
    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      ageAsOfDate: answer.includes("年龄按 2026-11-04 计算"),
      repeatsUnsetFilterClaim: answer.includes("应用年龄、CA 和 PA 条件后"),
      saysNoAgeFilter: answer.includes("年龄限制未设置"),
    }).toStrictEqual({
      ageAsOfDate: true,
      repeatsUnsetFilterClaim: false,
      saysNoAgeFilter: true,
    });
  });

  it("corrects team answers that claim null filters were applied", async () => {
    const team = { country: "England", id: 42, name: "Arsenal" };

    const input: RecommendTeamPlayerCandidatesInput = {
      includePotential: false,
      maxAge: null,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: "stc",
      referenceFmIds: ["team-reference"],
      referenceMode: "squad",
      resultLimit: 5,
      roster: {
        members: [],
        retrievedAt: "2026-11-03T00:00:00.000Z",
        team,
      },
      team,
    };

    const resultJson = teamRecommendationResult("ready", input, {
      currentCandidates: [
        {
          age: 24,
          attributes: [],
          currentAbility: 140,
          currentDistance: 0.5,
          fmId: "team-candidate",
          name: "Team Candidate",
          positionRating: 20,
          potentialAbility: 160,
          rank: 1,
          sourceRecordId: "team-candidate-record",
        },
      ],
    });

    const state = AgentState.parse({
      messages: [new HumanMessage("为 Arsenal 推荐 stc 球员。")],
      outcome: {
        kind: "team_recommendation",
        resultJson,
        source: "executed",
        status: "ready",
      },
    });

    const graph = new StateGraph(AgentState)
      .addNode(
        "answer",
        createAnswerNode(
          fakeModel().respond(
            new AIMessage(
              "应用年龄条件后有 5 个，应用 CA 条件后有 5 个，应用 PA 条件后有 5 个。"
            )
          )
        )
      )
      .addEdge(START, "answer")
      .addEdge("answer", END)
      .compile();

    const result = await graph.invoke(state);
    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      ageAppliedClaim: answer.includes("应用年龄条件后"),
      caAppliedClaim: answer.includes("应用 CA 条件后"),
      candidate: answer.includes("Team Candidate"),
      noAgeFilter: answer.includes("年龄限制未设置"),
      noCaFilter: answer.includes("CA 下限未设置"),
      noPaFilter: answer.includes("PA 下限未设置"),
      paAppliedClaim: answer.includes("应用 PA 条件后"),
    }).toStrictEqual({
      ageAppliedClaim: false,
      caAppliedClaim: false,
      candidate: true,
      noAgeFilter: true,
      noCaFilter: true,
      noPaFilter: true,
      paAppliedClaim: false,
    });
  });

  it.each([
    "工具未提供团队参考画像的成员筛选标准或计算方法。",
    "工具未提供这些参考对象的筛选标准或计算方法。",
  ])(
    "corrects team answers that deny the provided basis: %s",
    async (falseBasisClaim) => {
      const team = { country: "Testland", id: 901, name: "Synthetic Town FC" };

      const input: RecommendTeamPlayerCandidatesInput = {
        includePotential: false,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceFmIds: [],
        referenceMode: "squad",
        resultLimit: 5,
        roster: {
          members: [],
          retrievedAt: "2025-11-20T12:00:00.000Z",
          team,
        },
        team,
      };

      const resultJson = teamRecommendationResult("ready", input);

      const state = AgentState.parse({
        messages: [new HumanMessage("为 Synthetic Town FC 推荐 stc 球员。")],
        outcome: {
          kind: "team_recommendation",
          resultJson,
          source: "executed",
          status: "ready",
        },
      });

      const graph = new StateGraph(AgentState)
        .addNode(
          "answer",
          createAnswerNode(
            fakeModel().respond(
              new AIMessage([
                {
                  text: falseBasisClaim,
                  type: "text",
                },
              ])
            )
          )
        )
        .addEdge(START, "answer")
        .addEdge("answer", END)
        .compile();

      const result = await graph.invoke(state);
      const answer = z.string().parse(result.messages.at(-1)?.content);

      expect({
        hasGroundedBasis: answer.includes(
          "参考画像计算方式：选取目标位置评分至少 15 且该位置所需属性完整的队内 FM 画像，对该位置所需属性取等权平均。"
        ),
        repeatsMissingBasisClaim: answer.includes("未在结果中说明"),
      }).toStrictEqual({
        hasGroundedBasis: true,
        repeatsMissingBasisClaim: false,
      });
    }
  );

  it("names reference profiles when an answer claims no exclusion identities were returned", async () => {
    const team = { country: "England", id: 42, name: "Arsenal" };

    const input: RecommendTeamPlayerCandidatesInput = {
      includePotential: false,
      maxAge: null,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: "stc",
      referenceFmIds: ["team-reference"],
      referenceMode: "squad",
      resultLimit: 5,
      roster: {
        members: [],
        retrievedAt: "2026-11-03T00:00:00.000Z",
        team,
      },
      team,
    };

    const candidate = {
      age: 24,
      attributes: [],
      currentAbility: 140,
      currentDistance: 0.5,
      fmId: "team-candidate",
      name: "Team Candidate",
      positionRating: 20,
      potentialAbility: 160,
      rank: 1,
      sourceRecordId: "team-candidate-record",
    };

    const reference = {
      currentAbility: 150,
      fmId: "team-reference",
      name: "Team Reference",
      positionRating: 20,
      potentialAbility: 180,
      sourceRecordId: "team-reference-record",
    };

    const resultJson = teamRecommendationResult("ready", input, {
      currentCandidates: [candidate],
      referenceFmIds: [reference.fmId],
      references: [reference],
    });

    const state = AgentState.parse({
      messages: [new HumanMessage("为 Arsenal 推荐 stc 球员。")],
      outcome: {
        kind: "team_recommendation",
        resultJson,
        source: "executed",
        status: "ready",
      },
    });

    const graph = new StateGraph(AgentState)
      .addNode(
        "answer",
        createAnswerNode(
          fakeModel().respond(
            new AIMessage("工具未提供身份排除的具体对象，无法判断排除了谁。")
          )
        )
      )
      .addEdge(START, "answer")
      .addEdge("answer", END)
      .compile();

    const result = await graph.invoke(state);
    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      listsReference: answer.includes("Team Reference"),
      namesExclusion: answer.includes("从候选中排除"),
      repeatsUnsupportedClaim: answer.includes("工具未提供身份排除的具体对象"),
    }).toStrictEqual({
      listsReference: true,
      namesExclusion: true,
      repeatsUnsupportedClaim: false,
    });
  });

  it("commits a lookup tool result before retrying the next model step", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const message = "Look up Harry Kane.";

    const lookupResult = JSON.stringify({
      fm: { records: [fmRecord("Harry Kane", "kane-fm")], status: "found" },
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
        "球员数据查询已完成，但模型暂时无法生成解释。查询结果已保存，可以继续追问。",
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
    const kane = playerCandidate("Harry Kane", "kane");
    const mbappe = playerCandidate("Kylian Mbappé", "mbappe");
    const firstMessage = "Look up Harry Kane.";
    const secondMessage = "Look up Kylian Mbappé.";
    const search = vi.fn<PlayerSearch>(emptySearchResult);

    const identityLookup = resolvedLookupFromCandidates([kane, mbappe]);

    const searchCall = {
      args: { sourceRecords: [] },
      name: "search_player_records",
    };

    const model = fakeModel()
      .respondWithTools([searchCall])
      .respond(new AIMessage("Harry Kane records loaded."))
      .respondWithTools(Array.from({ length: 4 }, () => searchCall));

    const graph = createAgent({
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createExtractor({
        [firstMessage]: requestForPlayers("player_lookup", ["Harry Kane"]),
        [secondMessage]: requestForPlayers("player_lookup", ["Kylian Mbappé"]),
      }),
      tools: [createSearchTool(search)],
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

  it("commits a valid empty lookup result to the active lookup context", async () => {
    const kane = playerCandidate("Harry Kane", "kane");

    const sourceRecords = [
      { provider: "fm" as const, sourceId: "kane-fm" },
      { provider: "understat" as const, sourceId: "kane-understat" },
    ];

    const lookupResult = emptySearchResult({ sourceRecords });
    const search = vi.fn<PlayerSearch>(() => lookupResult);

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
    const kane = playerCandidate("Harry Kane", "kane");
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

  it("answers a lookup follow-up from the saved result without rerunning the search", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
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
      .respond(new AIMessage("The saved result covers the 2025/26 season."));

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [firstMessage]: requestForPlayers("player_lookup", ["Harry Kane"]),
        [followUp]: followUpRequest,
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
      outcomeStatus: followUpResult.outcome?.status,
      pendingClarification: followUpResult.pendingClarification,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      activeLookup: lookupResult,
      followUpAnswer: "The saved result covers the 2025/26 season.",
      outcomeStatus: "lookup_follow_up",
      pendingClarification: null,
      searchCalls: 1,
    });
  });

  it("does not explain a saved lookup for a different explicitly named player", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const mbappe = playerCandidate("Kylian Mbappé", "mbappe");
    const firstMessage = "Look up Harry Kane.";
    const explainMessage = "Explain the previous lookup for Kylian Mbappé.";
    const search = vi.fn<PlayerSearch>(emptySearchResult);

    const searchCall = {
      args: { sourceRecords: [] },
      name: "search_player_records",
    };

    const graph = createAgent({
      model: fakeModel()
        .respondWithTools([searchCall])
        .respond(new AIMessage("Harry Kane's records loaded.")),
      playerIdentityLookup: resolvedLookupFromCandidates([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
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
        [firstMessage]: requestForPlayers("player_lookup", ["Harry Kane"]),
      }),
      tools: [createSearchTool(search)],
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
    const kane = playerCandidate("Harry Kane", "kane");
    const firstMessage = "Look up Harry Kane.";

    const explainMessage =
      "Explain the previous lookup for Harry Kane in 2024/25.";

    const search = vi.fn<PlayerSearch>(emptySearchResult);

    const searchCall = {
      args: { sourceRecords: [] },
      name: "search_player_records",
    };

    const graph = createAgent({
      model: fakeModel()
        .respondWithTools([searchCall])
        .respond(new AIMessage("Harry Kane's latest records loaded.")),
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
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
        [firstMessage]: requestForPlayers("player_lookup", ["Harry Kane"]),
      }),
      tools: [createSearchTool(search)],
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

  it("does not reuse a previous lookup after a different season request fails", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const kaneMessage = "Look up Harry Kane.";
    const failedMessage = "Look up Harry Kane's 2024/25 Understat data again.";
    const followUp = "Which season was in the previous lookup?";

    const search = vi
      .fn<PlayerSearch>(emptySearchResult)
      .mockImplementationOnce((input) => emptySearchResult(input))
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

    const graph = createAgent({
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [failedMessage]: requestForPlayers("player_lookup", ["Harry Kane"]),
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
        [kaneMessage]: requestForPlayers("player_lookup", ["Harry Kane"]),
      }),
      tools: [createSearchTool(search)],
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
        recommendationResult("no_candidates")
      )
      .mockReturnValueOnce(
        JSON.stringify({
          commonNaturalPositions: ["stc", "mc"],
          positionOptions: ["stc", "mc"],
          references: [],
          status: "position_required",
        })
      )
      .mockReturnValue(recommendationResult("no_candidates"));

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

  it("applies a condition-only refinement extracted without a workflow kind", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const firstMessage = "Find striker alternatives to Kane under 23.";
    const refineMessage = "Lower the age limit to 21.";

    const recommend = vi.fn<RecommendPlayerCandidates>((input) =>
      JSON.stringify(
        recommendationResultData("no_candidates", "stc", {
          filters: {
            includePotential: input.includePotential,
            maxAge: input.maxAge,
            minimumCurrentAbility: input.minimumCurrentAbility,
            minimumPotentialAbility: input.minimumPotentialAbility,
            resultLimit: input.resultLimit ?? 5,
          },
        })
      )
    );

    const model = fakeModel()
      .respond(new AIMessage("No candidates meet the original filters."))
      .respond(new AIMessage("No candidates meet the refined filters."));

    const extractor = createExtractor({
      [firstMessage]: requestForPlayers("player_recommendation", ["Kane"], {
        recommendation: { maxAge: 23, position: "stc" },
        recommendationAction: "replace",
      }),
      [refineMessage]: requestForPlayers(null, [], {
        continuationAction: "refine",
        recommendation: { maxAge: 21 },
        recommendationAction: "refine",
      }),
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: extractor,
      tools: createTools(emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "recommendation-refine-null-kind" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const refined = await graph.invoke(
      { messages: [new HumanMessage(refineMessage)] },
      config
    );

    expect({
      activeMaxAge: refined.conversationContext.activeRecommendation?.maxAge,
      calls: recommend.mock.calls.length,
      refinedMaxAge: recommend.mock.calls[1]?.[0].maxAge,
      workflow: refined.request.kind,
    }).toStrictEqual({
      activeMaxAge: 21,
      calls: 2,
      refinedMaxAge: 21,
      workflow: "player_recommendation",
    });
  });

  it("recovers an explicit Chinese age ceiling omitted by request extraction", async () => {
    const kane = playerCandidate("Harry Kane", "kane");
    const firstMessage = "Find striker alternatives to Kane under 23.";
    const refineMessage = "把年龄上限设为 21 岁。";
    const correctionMessage = "把年龄上限从 21 岁改为 18 岁。";

    const recommend = vi.fn<RecommendPlayerCandidates>((input) =>
      JSON.stringify(
        recommendationResultData("no_candidates", "stc", {
          filters: {
            includePotential: input.includePotential,
            maxAge: input.maxAge,
            minimumCurrentAbility: input.minimumCurrentAbility,
            minimumPotentialAbility: input.minimumPotentialAbility,
            resultLimit: input.resultLimit ?? 5,
          },
        })
      )
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel()
        .respond(new AIMessage("Initial recommendation saved."))
        .respond(new AIMessage("Age-refined recommendation saved."))
        .respond(new AIMessage("Corrected recommendation saved.")),
      playerIdentityLookup: resolvedLookup(kane),
      requestUnderstandingExtractor: createExtractor({
        [correctionMessage]: requestForPlayers(null, [], {
          continuationAction: "refine",
          recommendation: { maxAge: 21 },
          recommendationAction: "refine",
        }),
        [firstMessage]: requestForPlayers("player_recommendation", ["Kane"], {
          recommendation: { maxAge: 23, position: "stc" },
          recommendationAction: "replace",
        }),
        [refineMessage]: requestForPlayers(null, [], {
          continuationAction: "refine",
          recommendationAction: "refine",
        }),
      }),
      tools: createTools(emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "chinese-age-refinement-fallback" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const refined = await graph.invoke(
      { messages: [new HumanMessage(refineMessage)] },
      config
    );

    const corrected = await graph.invoke(
      { messages: [new HumanMessage(correctionMessage)] },
      config
    );

    expect({
      activeMaxAge: refined.conversationContext.activeRecommendation?.maxAge,
      calls: recommend.mock.calls.length,
      correctedMaxAge:
        corrected.conversationContext.activeRecommendation?.maxAge,
      correctedToolMaxAge: recommend.mock.calls[2]?.[0].maxAge,
      refinedMaxAge: recommend.mock.calls[1]?.[0].maxAge,
    }).toStrictEqual({
      activeMaxAge: 21,
      calls: 3,
      correctedMaxAge: 18,
      correctedToolMaxAge: 18,
      refinedMaxAge: 21,
    });
  });

  it("keeps a condition-only refinement through structured-output repair after identity confirmation", async () => {
    const reference = playerCandidate("Synthetic Reference", "reference");

    const addedReference = playerCandidate(
      "Synthetic Close Candidate",
      "close"
    );

    const firstMessage =
      "请把 Synthetic Reference 作为参考球员，推荐 STC 位置相似球员。";

    const addMessage = "再加上 Synthetic Close Candidate 作为参考。";
    const refineMessage = "把年龄上限设为 21 岁。";
    const repairAttempts = new Map<string, number>();

    const identityLookup: ReferenceIdentityLookup = (mention) =>
      mention === reference.name
        ? {
            candidateCount: 1,
            candidates: [reference],
            candidatesTruncated: false,
            canonicalIdentityId: reference.canonicalIdentityId,
            clarificationMessage: null,
            mention,
            selectedCandidateId: reference.candidateId,
            selectedName: reference.name,
            status: "resolved",
          }
        : {
            candidateCount: 1,
            candidates: [addedReference],
            candidatesTruncated: false,
            canonicalIdentityId: null,
            clarificationMessage: "Please confirm Synthetic Close Candidate.",
            mention,
            selectedCandidateId: null,
            selectedName: null,
            status: "needs_confirmation",
          };

    const recommend = vi.fn<RecommendPlayerCandidates>((input) =>
      JSON.stringify(
        recommendationResultData("no_candidates", "stc", {
          filters: {
            includePotential: input.includePotential,
            maxAge: input.maxAge,
            minimumCurrentAbility: input.minimumCurrentAbility,
            minimumPotentialAbility: input.minimumPotentialAbility,
            resultLimit: input.resultLimit ?? 5,
          },
        })
      )
    );

    const model = fakeModel()
      .respond(new AIMessage("Initial recommendation saved."))
      .respond(new AIMessage("Added reference recommendation saved."))
      .respond(new AIMessage("Age-refined recommendation saved."));

    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from((messages: BaseMessage[]) => {
        const userMessage = z.string().parse(messages.at(-1)?.content);

        const input = z
          .object({
            currentMessage: z.string(),
            validationFeedback: z.string().optional(),
          })
          .passthrough()
          .parse(JSON.parse(userMessage));

        if (input.currentMessage === refineMessage) {
          const attempts = repairAttempts.get(refineMessage) ?? 0;
          repairAttempts.set(refineMessage, attempts + 1);

          if (input.validationFeedback === undefined) {
            throw Object.assign(new Error("Invalid structured request."), {
              name: "OutputParserException",
            });
          }

          return requestForPlayers(null, [], {
            continuationAction: "refine",
            recommendation: { maxAge: 21 },
            recommendationAction: "refine",
          });
        }

        if (input.currentMessage === firstMessage) {
          return requestForPlayers(
            "player_recommendation",
            ["Synthetic Reference"],
            {
              recommendation: { position: "stc" },
              recommendationAction: "replace",
            }
          );
        }

        return requestForPlayers(
          "player_recommendation",
          ["Synthetic Close Candidate"],
          {
            continuationAction: "refine",
            recommendationAction: "add",
          }
        );
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createRequestUnderstandingExtractor(model),
      tools: createTools(emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "recommend-refine-after-extraction-repair" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(addMessage)] },
      config
    );

    await graph.invoke(new Command({ resume: "1" }), config);

    const refined = await graph.invoke(
      { messages: [new HumanMessage(refineMessage)] },
      config
    );

    expect({
      activeMaxAge: refined.conversationContext.activeRecommendation?.maxAge,
      interruptAsked: Object.hasOwn(interrupted, "__interrupt__"),
      recommendationCalls: recommend.mock.calls.length,
      refinedMaxAge: recommend.mock.calls.at(-1)?.[0].maxAge,
      structuredOutputRepairs: repairAttempts.get(refineMessage),
    }).toStrictEqual({
      activeMaxAge: 21,
      interruptAsked: true,
      recommendationCalls: 3,
      refinedMaxAge: 21,
      structuredOutputRepairs: 2,
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
      recommendationResult("no_candidates")
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

  it("keeps existing recommendation references before newly added references", async () => {
    const existingReference = playerCandidate(
      "Existing Reference",
      "z-reference"
    );

    const addedReference = playerCandidate("Added Reference", "a-reference");
    const firstMessage = "Find STC alternatives based on Existing Reference.";
    const addMessage = "Add Added Reference as a reference.";

    const recommend = vi.fn<RecommendPlayerCandidates>((input) =>
      JSON.stringify(
        recommendationResultData("ready", "stc", {
          filters: {
            includePotential: input.includePotential,
            maxAge: input.maxAge,
            minimumCurrentAbility: input.minimumCurrentAbility,
            minimumPotentialAbility: input.minimumPotentialAbility,
            resultLimit: input.resultLimit ?? 5,
          },
          referenceFmIds: input.referenceGroups.flatMap(({ fmIds }) => fmIds),
        })
      )
    );

    const model = fakeModel()
      .respond(new AIMessage("Initial recommendation saved."))
      .respond(new AIMessage("Added reference recommendation saved."));

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: resolvedLookupFromCandidates([
        existingReference,
        addedReference,
      ]),
      requestUnderstandingExtractor: createExtractor({
        [addMessage]: requestForPlayers(
          "player_recommendation",
          ["Added Reference"],
          { recommendationAction: "add" }
        ),
        [firstMessage]: requestForPlayers(
          "player_recommendation",
          ["Existing Reference"],
          {
            recommendation: {
              includePotential: false,
              position: "stc",
              resultLimit: 5,
            },
            recommendationAction: "replace",
          }
        ),
      }),
      tools: createTools(emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "recommendation-reference-order" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);
    await graph.invoke({ messages: [new HumanMessage(addMessage)] }, config);

    expect(
      recommend.mock.calls[1]?.[0].referenceGroups.map(({ fmIds }) => fmIds)
    ).toStrictEqual([["z-reference-fm"], ["a-reference-fm"]]);
  });

  it("does not run a recommendation when an extracted hard condition is unsupported", async () => {
    const kane = playerCandidate("Harry Kane", "kane");

    const recommend = vi.fn<RecommendPlayerCandidates>(() =>
      recommendationResult("ready")
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
      recommendationResult("ready")
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
      recommendationResult("ready")
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
    const readyResult = recommendationResult("ready");

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
