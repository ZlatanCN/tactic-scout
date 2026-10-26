import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import type { ReferenceIdentityLookup } from "../src/player-data/resolve-reference.js";
import type { PlayerSearch } from "../src/player-data/search-records.js";
import type { RequestUnderstandingExtractor } from "../src/request-extraction.js";
import type { ReferenceCandidate } from "../src/state.js";
import { createInitialConversationContext } from "../src/state.js";
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

  it("does not replace the last successful recommendation when the next tool call fails", async () => {
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

    const failed = await graph.invoke(
      { messages: [new HumanMessage(refineMessage)] },
      config
    );

    expect({
      activeRecommendation: failed.conversationContext.activeRecommendation,
      response: failed.messages.at(-1)?.content,
      toolCalls: recommend.mock.calls.length,
    }).toMatchObject({
      activeRecommendation: previousRecommendation,
      response:
        "本次数据计算失败，之前完成的查询结果仍然保留。请检查本地数据后重试。",
      toolCalls: 2,
    });
  });
});
