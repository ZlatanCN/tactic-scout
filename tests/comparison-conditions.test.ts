import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import type { ReferenceIdentityLookup } from "../src/player-data/resolve-reference.js";
import type { PlayerSearch } from "../src/player-data/search-records.js";
import type { RequestUnderstandingExtractor } from "../src/request-extraction.js";
import type {
  ComparisonAction,
  ReferenceCandidate,
  RequestConstraint,
} from "../src/state.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../src/agent.js");
const { createTools } = await import("../src/tools/search-player-records.js");

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

const comparisonRequest = (
  players: string[],
  constraints: RequestConstraint[] = [],
  comparisonAction: ComparisonAction = "replace"
): ExtractedRequest => ({
  comparisonAction,
  constraints,
  kind: "player_comparison",
  players: players.map((mention) => ({ lookupName: null, mention })),
  teams: [],
});

const playerCandidate = (name: string, id: string): ReferenceCandidate => ({
  candidateId: `reep:${id}`,
  canonicalIdentityId: id,
  exactNameMatch: true,
  identityVerified: true,
  name,
  records: [
    {
      competition: null,
      name,
      provider: "fm",
      season: null,
      sourceId: `${id}-fm`,
      team: null,
    },
  ],
});

const createComparisonHarness = (
  requests: Record<string, ExtractedRequest>,
  confirmationPlayer: string | null = null
) => {
  const candidates = new Map(
    [
      playerCandidate("Harry Kane", "fixture-kane"),
      playerCandidate("Kylian Mbappé", "fixture-mbappe"),
      playerCandidate("Erling Haaland", "fixture-haaland"),
      playerCandidate("Troy Parrott", "fixture-parrott"),
    ].map((candidate) => [candidate.name, candidate])
  );

  const lookup = vi.fn<ReferenceIdentityLookup>((mention) => {
    const candidate = candidates.get(mention);

    if (candidate === undefined) {
      throw new Error(`Unexpected identity lookup: ${mention}`);
    }

    const needsConfirmation = mention === confirmationPlayer;

    return {
      candidateCount: 1,
      candidates: [candidate],
      candidatesTruncated: false,
      canonicalIdentityId: needsConfirmation
        ? null
        : candidate.canonicalIdentityId,
      clarificationMessage: needsConfirmation
        ? "Confirm the additional player."
        : null,
      mention,
      selectedCandidateId: needsConfirmation ? null : candidate.candidateId,
      selectedName: needsConfirmation ? null : candidate.name,
      status: needsConfirmation ? "needs_confirmation" : "resolved",
    };
  });

  const search = vi.fn<PlayerSearch>((input) =>
    JSON.stringify({
      identityGroups: { canonicalGroups: [] },
      query: input.playerName,
    })
  );

  const extract: RequestUnderstandingExtractor = async (message) => {
    const request = await Promise.resolve(requests[message]);

    if (request === undefined) {
      throw new Error(`Unexpected user message: ${message}`);
    }

    return request;
  };

  const model = fakeModel()
    .respond(new AIMessage("Comparison completed."))
    .respond(new AIMessage("Comparison updated."))
    .respond(new AIMessage("Comparison updated again."));

  const graph = createAgent({
    checkpointer: new MemorySaver(),
    model,
    playerIdentityLookup: lookup,
    requestUnderstandingExtractor: extract,
    store: new InMemoryStore(),
    tools: createTools(search),
  });

  return { graph, search };
};

describe("comparison conditions across turns", () => {
  it("inherits the requested season across multiple additions and checkpoints", async () => {
    const firstMessage = "Compare Harry Kane and Kylian Mbappé in 2024/25.";
    const addHaaland = "Add Erling Haaland to the comparison.";
    const addParrott = "Add Troy Parrott to the comparison.";

    const { graph, search } = createComparisonHarness({
      [addHaaland]: comparisonRequest(["Erling Haaland"], [], "add"),
      [addParrott]: comparisonRequest(["Troy Parrott"], [], "add"),
      [firstMessage]: comparisonRequest(
        ["Harry Kane", "Kylian Mbappé"],
        [{ name: "season", value: "2024/25" }]
      ),
    });

    const config = { configurable: { thread_id: "inherited-season" } };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);
    await graph.invoke({ messages: [new HumanMessage(addHaaland)] }, config);
    await graph.invoke({ messages: [new HumanMessage(addParrott)] }, config);
    const snapshot = await graph.getState(config);

    expect(
      search.mock.calls.slice(-4).map(([query]) => ({
        player: query.playerName,
        season: query.seasonStartYear,
      }))
    ).toStrictEqual([
      { player: "Harry Kane", season: 2024 },
      { player: "Kylian Mbappé", season: 2024 },
      { player: "Erling Haaland", season: 2024 },
      { player: "Troy Parrott", season: 2024 },
    ]);
    expect(snapshot.values).toMatchObject({
      conversationContext: {
        activeComparison: {
          constraints: [{ value: "2024/25" }],
          players: [
            { candidate: { name: "Harry Kane" } },
            { candidate: { name: "Kylian Mbappé" } },
            { candidate: { name: "Erling Haaland" } },
            { candidate: { name: "Troy Parrott" } },
          ],
        },
      },
    });
  });

  it("overrides an earlier season using its Chinese alias and remembers the override", async () => {
    const firstMessage = "Compare Harry Kane and Kylian Mbappé in 2024/25.";

    const overrideMessage =
      "Add Erling Haaland and compare the 2025/26 season.";

    const nextMessage = "Add Troy Parrott to the comparison.";

    const { graph, search } = createComparisonHarness({
      [firstMessage]: comparisonRequest(
        ["Harry Kane", "Kylian Mbappé"],
        [{ name: "season", value: "2024/25" }]
      ),
      [nextMessage]: comparisonRequest(["Troy Parrott"], [], "add"),
      [overrideMessage]: comparisonRequest(
        ["Erling Haaland"],
        [{ name: "赛季", value: "2025/26" }],
        "add"
      ),
    });

    const config = { configurable: { thread_id: "overridden-season" } };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);
    await graph.invoke(
      { messages: [new HumanMessage(overrideMessage)] },
      config
    );

    const final = await graph.invoke(
      { messages: [new HumanMessage(nextMessage)] },
      config
    );

    const snapshot = await graph.getState(config);

    expect(
      search.mock.calls.slice(2).map(([query]) => query.seasonStartYear)
    ).toStrictEqual([2025, 2025, 2025, 2025, 2025, 2025, 2025]);
    expect(final.request.constraints).toMatchObject([{ value: "2025/26" }]);
    expect(snapshot.values).toMatchObject({
      conversationContext: {
        activeComparison: { constraints: [{ value: "2025/26" }] },
      },
    });
  });

  it("resets the participants and season for a fresh comparison", async () => {
    const firstMessage = "Compare Harry Kane and Kylian Mbappé in 2024/25.";
    const replacementMessage = "Compare Erling Haaland and Troy Parrott.";

    const { graph, search } = createComparisonHarness({
      [firstMessage]: comparisonRequest(
        ["Harry Kane", "Kylian Mbappé"],
        [{ name: "season", value: "2024/25" }]
      ),
      [replacementMessage]: comparisonRequest([
        "Erling Haaland",
        "Troy Parrott",
      ]),
    });

    const config = { configurable: { thread_id: "replacement-season" } };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);
    await graph.invoke(
      { messages: [new HumanMessage(replacementMessage)] },
      config
    );
    const snapshot = await graph.getState(config);

    expect(
      search.mock.calls.slice(2).map(([query]) => ({
        player: query.playerName,
        season: query.seasonStartYear ?? null,
      }))
    ).toStrictEqual([
      { player: "Erling Haaland", season: null },
      { player: "Troy Parrott", season: null },
    ]);
    expect(snapshot.values).toMatchObject({
      conversationContext: {
        activeComparison: {
          constraints: [],
          players: [
            { candidate: { name: "Erling Haaland" } },
            { candidate: { name: "Troy Parrott" } },
          ],
        },
      },
    });
  });

  it("recovers the requested season from a successful historical comparison", async () => {
    const addMessage = "Add Erling Haaland to the comparison.";

    const { graph, search } = createComparisonHarness({
      [addMessage]: comparisonRequest(["Erling Haaland"], [], "add"),
    });

    const config = { configurable: { thread_id: "historical-season" } };
    const priorCallId = "historical-comparison-with-season";

    await graph.invoke(
      {
        messages: [
          new HumanMessage("Compare Harry Kane and Kylian Mbappé in 2024/25."),
          new AIMessage({
            content: "",
            tool_calls: [
              {
                args: {
                  players: [
                    {
                      canonicalIdentityId: "fixture-kane",
                      playerName: "Harry Kane",
                      sourceRecords: [
                        { provider: "fm", sourceId: "fixture-kane-fm" },
                      ],
                    },
                    {
                      canonicalIdentityId: "fixture-mbappe",
                      playerName: "Kylian Mbappé",
                      sourceRecords: [
                        { provider: "fm", sourceId: "fixture-mbappe-fm" },
                      ],
                    },
                  ],
                  seasonStartYear: 2024,
                  source: "both",
                },
                id: priorCallId,
                name: "compare_player_records",
                type: "tool_call",
              },
            ],
          }),
          new ToolMessage({
            content: JSON.stringify({ status: "no_comparable_data" }),
            name: "compare_player_records",
            tool_call_id: priorCallId,
          }),
          new AIMessage("The historical comparison completed."),
          new HumanMessage(addMessage),
        ],
      },
      config
    );
    const snapshot = await graph.getState(config);

    expect(
      search.mock.calls.map(([query]) => ({
        player: query.playerName,
        season: query.seasonStartYear,
      }))
    ).toStrictEqual([
      { player: "Harry Kane", season: 2024 },
      { player: "Kylian Mbappé", season: 2024 },
      { player: "Erling Haaland", season: 2024 },
    ]);
    expect(snapshot.values).toMatchObject({
      conversationContext: {
        activeComparison: { constraints: [{ value: "2024/25" }] },
      },
    });
  });

  it("keeps the successful season until an additional player's identity is confirmed", async () => {
    const firstMessage = "Compare Harry Kane and Kylian Mbappé in 2024/25.";
    const addMessage = "Add Erling Haaland and compare the 2025/26 season.";

    const { graph, search } = createComparisonHarness(
      {
        [addMessage]: comparisonRequest(
          ["Erling Haaland"],
          [{ name: "赛季", value: "2025/26" }],
          "add"
        ),
        [firstMessage]: comparisonRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [{ name: "season", value: "2024/25" }]
        ),
      },
      "Erling Haaland"
    );

    const config = { configurable: { thread_id: "interrupted-season" } };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(addMessage)] },
      config
    );

    const interruptedSnapshot = await graph.getState(config);

    expect(interrupted).toHaveProperty("__interrupt__");
    expect(search).toHaveBeenCalledTimes(2);
    expect(interruptedSnapshot.values).toMatchObject({
      conversationContext: {
        activeComparison: {
          constraints: [{ value: "2024/25" }],
          players: [
            { candidate: { name: "Harry Kane" } },
            { candidate: { name: "Kylian Mbappé" } },
          ],
        },
      },
    });

    await graph.invoke(new Command({ resume: "1" }), config);
    const resumedSnapshot = await graph.getState(config);

    expect(
      search.mock.calls.slice(2).map(([query]) => query.seasonStartYear)
    ).toStrictEqual([2025, 2025, 2025]);
    expect(resumedSnapshot.values).toMatchObject({
      conversationContext: {
        activeComparison: { constraints: [{ value: "2025/26" }] },
      },
    });
  });

  it("preserves the completed comparison when an addition's data query fails", async () => {
    const firstMessage = "Compare Harry Kane and Kylian Mbappé in 2024/25.";
    const failedAddition = "Add Erling Haaland for the 2025/26 season.";
    const nextAddition = "Add Troy Parrott to the comparison.";

    const { graph, search } = createComparisonHarness({
      [failedAddition]: comparisonRequest(
        ["Erling Haaland"],
        [{ name: "season", value: "2025/26" }],
        "add"
      ),
      [firstMessage]: comparisonRequest(
        ["Harry Kane", "Kylian Mbappé"],
        [{ name: "season", value: "2024/25" }]
      ),
      [nextAddition]: comparisonRequest(["Troy Parrott"], [], "add"),
    });

    const config = { configurable: { thread_id: "failed-addition-season" } };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);
    search.mockImplementationOnce(() => {
      throw new Error("The player-data source is temporarily unavailable.");
    });
    await graph.invoke(
      { messages: [new HumanMessage(failedAddition)] },
      config
    );
    const failedSnapshot = await graph.getState(config);

    expect(failedSnapshot.values).toMatchObject({
      conversationContext: {
        activeComparison: {
          constraints: [{ name: "season", value: "2024/25" }],
          players: [
            { candidate: { name: "Harry Kane" } },
            { candidate: { name: "Kylian Mbappé" } },
          ],
        },
      },
    });

    await graph.invoke({ messages: [new HumanMessage(nextAddition)] }, config);

    expect(
      search.mock.calls.slice(-3).map(([query]) => ({
        player: query.playerName,
        season: query.seasonStartYear,
      }))
    ).toStrictEqual([
      { player: "Harry Kane", season: 2024 },
      { player: "Kylian Mbappé", season: 2024 },
      { player: "Troy Parrott", season: 2024 },
    ]);
  });
});
