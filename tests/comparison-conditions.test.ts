import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import type { ReferenceIdentityLookup } from "../src/player-data/resolve-reference.js";
import type { PlayerSearch } from "../src/player-data/search-records.js";
import type { RequestUnderstandingExtractor } from "../src/request-extraction.js";
import type { ReferenceCandidate } from "../src/state.js";
import { ActiveComparisonSchema } from "../src/state.js";
import type { PlayerSearchInput } from "../src/tools/search-player-records.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../src/agent.js");
const { createTools } = await import("../src/tools/search-player-records.js");

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

const candidate = (name: string, id: string): ReferenceCandidate => ({
  candidateId: `candidate-${id}`,
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

const compareRequest = (
  players: string[],
  constraints: ExtractedRequest["constraints"] = [],
  comparisonAction: "replace" | "add" = "replace"
): ExtractedRequest => ({
  comparisonAction,
  constraints,
  kind: "player_comparison",
  players: players.map((mention) => ({
    lookupName: null,
    mention,
    recommendationRole: "reference",
  })),
  teams: [],
});

const searchResult = (input: PlayerSearchInput): string =>
  JSON.stringify({
    fm: { records: [], status: "not_found" },
    identityGroups: { canonicalGroups: [] },
    query: input.sourceRecords,
    understat: { records: [], status: "not_found" },
  });

const createLookup = (
  candidates: ReferenceCandidate[]
): ReferenceIdentityLookup => {
  const byName = new Map(candidates.map((item) => [item.name, item]));

  return (mention) => {
    const selected = byName.get(mention);

    if (selected === undefined) {
      throw new Error(`Unexpected identity lookup: ${mention}`);
    }

    return {
      candidateCount: 1,
      candidates: [selected],
      candidatesTruncated: false,
      canonicalIdentityId: selected.canonicalIdentityId,
      clarificationMessage: null,
      mention,
      selectedCandidateId: selected.candidateId,
      selectedName: selected.name,
      status: "resolved",
    };
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

describe("comparison workflow state", () => {
  it("inherits an explicitly requested season when adding players to a saved comparison", async () => {
    const players = [
      candidate("Harry Kane", "kane"),
      candidate("Kylian Mbappé", "mbappe"),
      candidate("Erling Haaland", "haaland"),
      candidate("Troy Parrott", "parrott"),
    ];

    const first = "Compare Harry Kane and Kylian Mbappé in 2024/25.";
    const addHaaland = "Add Erling Haaland to the comparison.";
    const addParrott = "Add Troy Parrott to the comparison.";
    const search = vi.fn<PlayerSearch>(searchResult);

    const model = fakeModel()
      .respond(new AIMessage("First comparison checked."))
      .respond(new AIMessage("Second comparison checked."))
      .respond(new AIMessage("Third comparison checked."));

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: createLookup(players),
      requestUnderstandingExtractor: createExtractor({
        [addHaaland]: compareRequest(["Erling Haaland"], [], "add"),
        [addParrott]: compareRequest(["Troy Parrott"], [], "add"),
        [first]: compareRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [{ name: "season", value: "2024/25" }]
        ),
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "comparison-season-thread" },
    };

    await graph.invoke({ messages: [new HumanMessage(first)] }, config);
    await graph.invoke({ messages: [new HumanMessage(addHaaland)] }, config);

    const final = await graph.invoke(
      { messages: [new HumanMessage(addParrott)] },
      config
    );

    expect(
      search.mock.calls.map(([query]) => query.seasonStartYear)
    ).toStrictEqual([2024, 2024, 2024, 2024, 2024, 2024, 2024, 2024, 2024]);
    expect(final.conversationContext.activeComparison).toMatchObject({
      constraints: [{ name: "season", value: "2024/25" }],
      players: [
        { candidate: { name: "Harry Kane" } },
        { candidate: { name: "Kylian Mbappé" } },
        { candidate: { name: "Erling Haaland" } },
        { candidate: { name: "Troy Parrott" } },
      ],
    });
    expect(final.messages.at(-1)?.content).toBe("Third comparison checked.");
  });

  it("interrupts on an unparseable hard season and resumes the same comparison", async () => {
    const kane = candidate("Harry Kane", "kane");
    const mbappe = candidate("Kylian Mbappé", "mbappe");
    const message = "Compare Harry Kane and Kylian Mbappé in the 2026 season.";
    const search = vi.fn<PlayerSearch>(searchResult);

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel().respond(new AIMessage("Comparison checked.")),
      playerIdentityLookup: createLookup([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
        [message]: compareRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [{ name: "season", value: "2026赛季" }]
        ),
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "clarify-season-thread" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      config
    );

    const resumed = await graph.invoke(
      new Command({ resume: "2026/27" }),
      config
    );

    expect(interrupted).toHaveProperty("__interrupt__");
    expect(
      search.mock.calls.map(([query]) => query.seasonStartYear)
    ).toStrictEqual([2026, 2026]);
    expect(
      resumed.conversationContext.activeComparison.constraints
    ).toStrictEqual([{ name: "season", value: "2026/27" }]);
  });

  it("propagates unexpected data-tool errors without replacing the previous comparison", async () => {
    const kane = candidate("Harry Kane", "kane");
    const mbappe = candidate("Kylian Mbappé", "mbappe");
    const parrott = candidate("Troy Parrott", "parrott");
    const first = "Compare Harry Kane and Kylian Mbappé in 2024/25.";
    const addParrott = "Add Troy Parrott to the comparison.";

    const search = vi.fn<PlayerSearch>((input) => {
      if (
        input.sourceRecords.some((record) => record.sourceId === "parrott-fm")
      ) {
        throw new Error("Fixture data read failed.");
      }

      return searchResult(input);
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel().respond(new AIMessage("First comparison checked.")),
      playerIdentityLookup: createLookup([kane, mbappe, parrott]),
      requestUnderstandingExtractor: createExtractor({
        [addParrott]: compareRequest(["Troy Parrott"], [], "add"),
        [first]: compareRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [{ name: "season", value: "2024/25" }]
        ),
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "comparison-failure-thread" },
    };

    const firstResult = await graph.invoke(
      { messages: [new HumanMessage(first)] },
      config
    );

    const remembered = firstResult.conversationContext.activeComparison;

    await expect(
      graph.invoke({ messages: [new HumanMessage(addParrott)] }, config)
    ).rejects.toThrow("Fixture data read failed.");

    const failedState = z
      .object({
        values: z.object({
          conversationContext: z.object({
            activeComparison: ActiveComparisonSchema,
          }),
        }),
      })
      .safeParse(structuredClone(await graph.getState(config)));

    expect(failedState.success).toBeTruthy();

    if (!failedState.success) {
      throw new Error("The checkpoint did not retain the previous comparison.");
    }

    expect(
      failedState.data.values.conversationContext.activeComparison
    ).toStrictEqual(remembered);
  });

  it("retains a completed comparison when its final model explanation fails", async () => {
    const kane = candidate("Harry Kane", "kane");
    const mbappe = candidate("Kylian Mbappé", "mbappe");
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

  it("does not reconstruct a comparison from historical tool messages without saved thread context", async () => {
    const parrott = candidate("Troy Parrott", "parrott");
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
        content: JSON.stringify({ status: "ready" }),
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
      { messages: historicalMessages },
      { configurable: { thread_id: "no-history-recovery-thread" } }
    );

    expect(search).not.toHaveBeenCalled();
    expect(result.conversationContext.activeComparison.players).toStrictEqual(
      []
    );
    expect(result.messages.at(-1)?.content).toContain("至少两名球员");
  });

  it("does not leak a saved comparison between thread IDs", async () => {
    const kane = candidate("Harry Kane", "kane");
    const mbappe = candidate("Kylian Mbappé", "mbappe");
    const parrott = candidate("Troy Parrott", "parrott");
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
