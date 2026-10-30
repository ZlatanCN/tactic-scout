import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import type { ReferenceIdentityLookup } from "../src/player-data/resolve-reference.js";
import type { PlayerSearch } from "../src/player-data/search-records.js";
import { createRequestUnderstandingExtractor } from "../src/request-extraction.js";
import type { RequestUnderstandingExtractor } from "../src/request-extraction.js";
import type { ReferenceCandidate } from "../src/state.js";
import { ActiveComparisonSchema } from "../src/state.js";
import type { PlayerSearchInput } from "../src/tools/search-player-records.js";
import { comparisonResult } from "./fixtures/workflow-results.js";

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
  comparisonAction: "replace" | "add" | "refine" = "replace"
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
    identityGroups: {
      canonicalGroups: [],
      registryStatus: "not_needed",
      unlinkedRecords: [],
    },
    query: input.sourceRecords,
    requestedUnderstatSeasonStartYear: input.seasonStartYear ?? null,
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
  it("clarifies an exact season when relative season extraction is omitted", async () => {
    const message = "Compare Harry Kane and Kylian Mbappé from last season.";

    const players = [
      candidate("Harry Kane", "kane"),
      candidate("Kylian Mbappé", "mbappe"),
    ];

    const search = vi.fn<PlayerSearch>((input) => searchResult(input));

    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => compareRequest(players.map(({ name }) => name)))
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: createLookup(players),
      requestUnderstandingExtractor: createRequestUnderstandingExtractor(model),
      tools: createTools(search),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      {
        configurable: { thread_id: "comparison-relative-season-clarification" },
      }
    );

    expect({
      pendingKind: result.pendingClarification?.kind,
      searchCalls: search.mock.calls.length,
      status: result.outcome?.status,
    }).toStrictEqual({
      pendingKind: "season",
      searchCalls: 0,
      status: "season_clarification_required",
    });
  });

  it("inherits explicitly requested season and competition when adding players to a saved comparison", async () => {
    const players = [
      candidate("Harry Kane", "kane"),
      candidate("Kylian Mbappé", "mbappe"),
      candidate("Erling Haaland", "haaland"),
      candidate("Troy Parrott", "parrott"),
    ];

    const first = "Compare Harry Kane and Kylian Mbappé in 2024/25 La Liga.";

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
          [
            { name: "season", value: "2024/25" },
            { name: "competition", value: "La Liga" },
          ]
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
      constraints: [
        { name: "season", value: "2024/25" },
        { name: "competition", value: "La Liga" },
      ],
      players: [
        { candidate: { name: "Harry Kane" } },
        { candidate: { name: "Kylian Mbappé" } },
        { candidate: { name: "Erling Haaland" } },
        { candidate: { name: "Troy Parrott" } },
      ],
    });
    expect(final.messages.at(-1)?.content).toBe("Third comparison checked.");
  });

  it("filters Understat rows to an explicitly requested competition scope", async () => {
    const kane = candidate("Harry Kane", "kane");
    const mbappe = candidate("Kylian Mbappé", "mbappe");
    const message = "Compare Harry Kane and Kylian Mbappé in La Liga 2024/25.";

    const search = vi.fn<PlayerSearch>(async (input) => {
      await Promise.resolve();

      return JSON.stringify({
        identityGroups: {
          canonicalGroups: [],
          registryStatus: "not_needed",
          unlinkedRecords: [],
        },
        query: input.sourceRecords,
        requestedUnderstatSeasonStartYear: input.seasonStartYear ?? null,
        understat: {
          records: input.sourceRecords.flatMap(({ provider, sourceId }) =>
            provider === "understat"
              ? ["EPL", "La_liga"].map((competition) => ({
                  assists: 1,
                  competition,
                  expectedAssists: 0.5,
                  expectedGoals: 1.2,
                  goals: 1,
                  keyPasses: 4,
                  minutes: 900,
                  nonPenaltyExpectedGoals: 1.1,
                  player: sourceId,
                  position: "F",
                  season: "2024/25",
                  shots: 10,
                  source: "Understat",
                  sourcePlayerId: sourceId,
                  team: "Fixture FC",
                }))
              : []
          ),
          status: "found",
        },
      });
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel().respond(new AIMessage("La Liga comparison checked.")),
      playerIdentityLookup: createLookup([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
        [message]: compareRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [
            { name: "season", value: "2024/25" },
            { name: "competition", value: "La Liga" },
          ]
        ),
      }),
      tools: createTools(search),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "comparison-league-scope" } }
    );

    const parsedResult = z
      .object({
        players: z.array(
          z.object({
            understat: z
              .object({
                records: z.array(z.object({ competition: z.string() })),
              })
              .nullable(),
          })
        ),
        status: z.string(),
        understatScopeGroups: z.array(
          z.object({
            competition: z.string(),
            coverage: z.object({
              coveredPlayerCount: z.number(),
              coversAllParticipants: z.boolean(),
              participantCount: z.number(),
            }),
            season: z.string(),
          })
        ),
      })
      .parse(JSON.parse(result.outcome?.resultJson ?? "null"));

    expect({
      outcome: result.outcome?.status,
      perPlayerCompetitions: parsedResult.players.map(({ understat }) =>
        understat?.records.map(({ competition }) => competition)
      ),
      sharedScopes: parsedResult.understatScopeGroups,
      status: parsedResult.status,
    }).toStrictEqual({
      outcome: "ready",
      perPlayerCompetitions: [["La_liga"], ["La_liga"]],
      sharedScopes: [
        {
          competition: "La_liga",
          coverage: {
            coveredPlayerCount: 2,
            coversAllParticipants: true,
            participantCount: 2,
          },
          season: "2024/25",
        },
      ],
      status: "ready",
    });
  });

  it("marks an overlapping Understat scope that does not cover every player", async () => {
    const demo = candidate("Elias Demo", "demo");
    const midfielder = candidate("Synthetic Midfielder", "midfielder");
    const winger = candidate("Synthetic Winger", "winger");

    const understatBySourceId = new Map([
      ["demo-understat", "EPL"],
      ["midfielder-understat", "EPL"],
      ["winger-understat", "La_liga"],
    ]);

    const message =
      "Compare Elias Demo, Synthetic Midfielder and Synthetic Winger for 2024/25.";

    const search = vi.fn<PlayerSearch>((input) => {
      const sourceId = input.sourceRecords.find(
        ({ provider }) => provider === "understat"
      )?.sourceId;

      const competition = understatBySourceId.get(sourceId ?? "");

      const records =
        sourceId === undefined || competition === undefined
          ? []
          : [
              {
                assists: 1,
                competition,
                expectedAssists: 0.5,
                expectedGoals: 1.2,
                goals: 1,
                keyPasses: 4,
                minutes: 900,
                nonPenaltyExpectedGoals: 1.1,
                player: sourceId,
                position: "F",
                season: "2024/25",
                shots: 10,
                source: "Understat",
                sourcePlayerId: sourceId,
                team: "Fixture FC",
              },
            ];

      return JSON.stringify({
        fm: { records: [], status: "not_found" },
        identityGroups: {
          canonicalGroups: [],
          registryStatus: "not_needed",
          unlinkedRecords: [],
        },
        query: input.sourceRecords,
        requestedUnderstatSeasonStartYear: input.seasonStartYear ?? null,
        understat: {
          records,
          status: records.length > 0 ? "found" : "not_found",
        },
      });
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel().respond(new AIMessage("Comparison completed.")),
      playerIdentityLookup: createLookup([demo, midfielder, winger]),
      requestUnderstandingExtractor: createExtractor({
        [message]: compareRequest(
          [demo.name, midfielder.name, winger.name],
          [{ name: "season", value: "2024/25" }]
        ),
      }),
      tools: createTools(search),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "comparison-partial-understat-scope" } }
    );

    const parsedResult = z
      .object({
        coverage: z.object({
          commonUnderstatScopeCount: z.number(),
          hasUnderstatRecords: z.boolean(),
          playerCount: z.number(),
        }),
        status: z.string(),
        understatScopeGroups: z.array(
          z.object({
            competition: z.string(),
            coverage: z.object({
              coveredPlayerCount: z.number(),
              coversAllParticipants: z.boolean(),
              participantCount: z.number(),
            }),
            players: z.array(
              z.object({
                playerName: z.string(),
                record: z
                  .object({
                    competition: z.string(),
                    sourcePlayerId: z.string(),
                  })
                  .nullable(),
              })
            ),
            season: z.string(),
          })
        ),
      })
      .parse(JSON.parse(result.outcome?.resultJson ?? "null"));

    expect({
      commonUnderstatScopeCount:
        parsedResult.coverage.commonUnderstatScopeCount,
      coverage: parsedResult.understatScopeGroups[0]?.coverage,
      coveredEplPlayers: parsedResult.understatScopeGroups[0]?.players
        .filter(({ record }) => record !== null)
        .map(({ playerName }) => playerName),
      hasUnderstatRecords: parsedResult.coverage.hasUnderstatRecords,
      missingEplPlayers: parsedResult.understatScopeGroups[0]?.players
        .filter(({ record }) => record === null)
        .map(({ playerName }) => playerName),
      status: parsedResult.status,
    }).toStrictEqual({
      commonUnderstatScopeCount: 0,
      coverage: {
        coveredPlayerCount: 2,
        coversAllParticipants: false,
        participantCount: 3,
      },
      coveredEplPlayers: [demo.name, midfielder.name],
      hasUnderstatRecords: true,
      missingEplPlayers: [winger.name],
      status: "ready",
    });
  });

  it("keeps rejecting unsupported comparison filters", async () => {
    const kane = candidate("Harry Kane", "kane");
    const mbappe = candidate("Kylian Mbappé", "mbappe");

    const message =
      "Compare Harry Kane and Kylian Mbappé by a custom attribute.";

    const search = vi.fn<PlayerSearch>(searchResult);

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: createLookup([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
        [message]: compareRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [{ name: "attribute", value: "custom" }]
        ),
      }),
      tools: createTools(search),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "comparison-unsupported-filter" } }
    );

    expect({
      outcome: result.outcome?.status,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      outcome: "unsupported_constraints",
      searchCalls: 0,
    });
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

  it("refines comparison conditions while inheriting the completed participants", async () => {
    const kane = candidate("Harry Kane", "kane");
    const mbappe = candidate("Kylian Mbappé", "mbappe");
    const firstMessage = "Compare Harry Kane and Kylian Mbappé in 2024/25.";
    const refineMessage = "Change the comparison season to 2025/26.";
    const search = vi.fn<PlayerSearch>(searchResult);

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel()
        .respond(new AIMessage("The first comparison has no shared records."))
        .respond(
          new AIMessage("The refined comparison has no shared records.")
        ),
      playerIdentityLookup: createLookup([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
        [firstMessage]: compareRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [{ name: "season", value: "2024/25" }]
        ),
        [refineMessage]: compareRequest(
          [],
          [{ name: "season", value: "2025/26" }],
          "refine"
        ),
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "comparison-condition-refinement" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const refined = await graph.invoke(
      { messages: [new HumanMessage(refineMessage)] },
      config
    );

    expect({
      participants: refined.conversationContext.activeComparison.players.map(
        ({ candidate: item }) => item.name
      ),
      requestedSeasons: search.mock.calls.map(
        ([input]) => input.seasonStartYear
      ),
      storedSeason: refined.conversationContext.activeComparison.constraints,
    }).toStrictEqual({
      participants: ["Harry Kane", "Kylian Mbappé"],
      requestedSeasons: [2024, 2024, 2025, 2025],
      storedSeason: [{ name: "season", value: "2025/26" }],
    });
  });

  it("continues a failed condition-only comparison refinement from its saved participants and conditions", async () => {
    const kane = candidate("Harry Kane", "kane");
    const mbappe = candidate("Kylian Mbappé", "mbappe");
    const firstMessage = "Compare Harry Kane and Kylian Mbappé in 2024/25.";
    const failedRefinement = "Change the comparison season to 2025/26.";
    const nextRefinement = "Also restrict the comparison to EPL.";

    const search = vi.fn<PlayerSearch>((input) => {
      if (input.seasonStartYear === 2025) {
        return JSON.stringify({
          fm: { records: [], status: "not_found" },
          identityGroups: { canonicalGroups: [] },
          query: input.sourceRecords,
          understat: { reason: "Snapshot unavailable", status: "unavailable" },
        });
      }

      return searchResult(input);
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel()
        .respond(new AIMessage("Initial comparison."))
        .respond(new AIMessage("The saved comparison was refined.")),
      playerIdentityLookup: createLookup([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
        [failedRefinement]: compareRequest(
          [],
          [{ name: "season", value: "2025/26" }],
          "refine"
        ),
        [firstMessage]: compareRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [{ name: "season", value: "2024/25" }]
        ),
        [nextRefinement]: {
          constraints: [{ name: "competition", value: "EPL" }],
          continuationAction: "refine",
          kind: null,
          players: [],
          teams: [],
        },
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "failed-comparison-refine-baseline" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const failed = await graph.invoke(
      { messages: [new HumanMessage(failedRefinement)] },
      config
    );

    const resumed = await graph.invoke(
      { messages: [new HumanMessage(nextRefinement)] },
      config
    );

    expect({
      failedOutcome: failed.outcome?.status,
      participants: resumed.conversationContext.activeComparison.players.map(
        ({ candidate: item }) => item.name
      ),
      requestedSeasons: search.mock.calls.map(
        ([input]) => input.seasonStartYear
      ),
      scopes: resumed.conversationContext.activeComparison.constraints,
    }).toStrictEqual({
      failedOutcome: "data_unavailable",
      participants: ["Harry Kane", "Kylian Mbappé"],
      requestedSeasons: [2024, 2024, 2025, 2025, 2024, 2024],
      scopes: [
        { name: "season", value: "2024/25" },
        { name: "competition", value: "EPL" },
      ],
    });
  });

  it("explains a saved comparison without rerunning participant searches", async () => {
    const kane = candidate("Harry Kane", "kane");
    const mbappe = candidate("Kylian Mbappé", "mbappe");
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

  it("reports an unavailable local comparison source instead of empty evidence", async () => {
    const kane = candidate("Harry Kane", "kane");
    const mbappe = candidate("Kylian Mbappé", "mbappe");
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
      answer: "本地数据快照缺少完成这次请求所需的记录，因此目前无法给出结果。",
      outcome: "data_unavailable",
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
