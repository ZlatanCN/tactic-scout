import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import type { ReferenceIdentityLookup } from "../../../src/player-data/resolve-reference.js";
import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { createRequestUnderstandingExtractor } from "../../../src/request-extraction.js";
import {
  candidateFor,
  compareRequest,
  createAgent,
  createExtractor,
  createLookup,
  createTools,
  searchResult,
} from "../../fixtures/comparison-workflow.js";
import {
  testModelContextProfile,
  testModelOutputLimitAdapter,
} from "../../fixtures/model-context.js";

describe("comparison workflow state", () => {
  it("recognizes two explicit aliases as one identity before comparison", async () => {
    const elias = candidateFor("Elias Demo", "demo");
    const message = "Compare Elias Demo with the alias Demo.";

    const identityLookup = vi.fn<ReferenceIdentityLookup>((mention) => ({
      candidateCount: 1,
      candidates: [elias],
      candidatesTruncated: false,
      canonicalIdentityId: elias.canonicalIdentityId,
      clarificationMessage: null,
      mention,
      selectedCandidateId: elias.candidateId,
      selectedName: elias.name,
      status: "resolved",
    }));

    const search = vi.fn<PlayerSearch>(searchResult);
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        comparisonAction: "replace",
        constraints: [],
        kind: "player_comparison",
        players: [
          {
            lookupName: null,
            mention: "Elias Demo",
            referenceScope: "explicit",
            referenceTargetMention: null,
          },
          {
            lookupName: null,
            mention: "Demo",
            referenceScope: "ambiguous",
            referenceTargetMention: null,
          },
        ],
        teams: [],
      }))
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createRequestUnderstandingExtractor(
        model,
        {
          outputLimitAdapter: testModelOutputLimitAdapter,
          profile: testModelContextProfile,
        }
      ),
      tools: createTools(search),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "comparison-same-person-aliases" } }
    );

    expect({
      identityLookups: identityLookup.mock.calls.map(([mention]) => mention),
      outcome: result.outcome?.status,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      identityLookups: ["Elias Demo", "Demo"],
      outcome: "insufficient_distinct_players",
      searchCalls: 0,
    });
  }, 30_000);

  it("clarifies an exact season when relative season extraction is omitted", async () => {
    const message = "Compare Harry Kane and Kylian Mbappé from last season.";

    const players = [
      candidateFor("Harry Kane", "kane"),
      candidateFor("Kylian Mbappé", "mbappe"),
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
      requestUnderstandingExtractor: createRequestUnderstandingExtractor(
        model,
        {
          outputLimitAdapter: testModelOutputLimitAdapter,
          profile: testModelContextProfile,
        }
      ),
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
      candidateFor("Harry Kane", "kane"),
      candidateFor("Kylian Mbappé", "mbappe"),
      candidateFor("Erling Haaland", "haaland"),
      candidateFor("Troy Parrott", "parrott"),
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
    const kane = candidateFor("Harry Kane", "kane");
    const mbappe = candidateFor("Kylian Mbappé", "mbappe");
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
                  appearances: null,
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

    const model = fakeModel().respond(
      new AIMessage("La Liga comparison checked.")
    );

    const modelInvoke = vi.spyOn(model, "invoke");

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
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

    const modelInput = JSON.stringify(modelInvoke.mock.calls.at(-1)?.[0]);

    expect({
      attributeNameMapping: modelInput.includes(
        "technique 表示“技术”，dribbling 表示“盘带”"
      ),
      outcome: result.outcome?.status,
      perPlayerCompetitions: parsedResult.players.map(({ understat }) =>
        understat?.records.map(({ competition }) => competition)
      ),
      sharedScopes: parsedResult.understatScopeGroups,
      status: parsedResult.status,
    }).toStrictEqual({
      attributeNameMapping: true,
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
    const demo = candidateFor("Elias Demo", "demo");
    const midfielder = candidateFor("Synthetic Midfielder", "midfielder");
    const winger = candidateFor("Synthetic Winger", "winger");

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
                appearances: null,
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
});
