import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import type { ReferenceIdentityLookup } from "../src/player-data/resolve-reference.js";
import type { PlayerSearch } from "../src/player-data/search-records.js";
import type { RequestUnderstandingExtractor } from "../src/request-extraction.js";
import type { ReferenceCandidate } from "../src/state.js";
import type { PlayerSearchInput } from "../src/tools/search-player-records.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../src/agent.js");
const { createTools } = await import("../src/tools/search-player-records.js");

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

const createTestExtractor =
  (
    extract: (message: string) => ExtractedRequest
  ): RequestUnderstandingExtractor =>
  async (message) =>
    await Promise.resolve(extract(message));

describe("LangGraph model-tool loop", () => {
  it("runs a tool call, returns its result to the model, and resumes thread messages in memory", async () => {
    const candidate: ReferenceCandidate = {
      candidateId: "fixture:sample-striker",
      canonicalIdentityId: "fixture-sample-striker",
      exactNameMatch: true,
      identityVerified: true,
      name: "Sample Striker",
      records: [],
    };

    const search = vi.fn<PlayerSearch>((input: PlayerSearchInput) =>
      JSON.stringify({
        player: input.playerName,
        season: "2025/26",
        source: "fixture",
      })
    );

    const model = fakeModel()
      .respondWithTools([
        {
          args: { playerName: "Sample Striker" },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("Sample Striker has a 2025/26 fixture record."))
      .respond(new AIMessage("The record is from 2025/26."));

    const graph = createAgent({
      model,
      playerIdentityLookup: (mention) => ({
        candidateCount: 1,
        candidates: [candidate],
        candidatesTruncated: false,
        canonicalIdentityId: candidate.canonicalIdentityId,
        clarificationMessage: null,
        mention,
        selectedCandidateId: candidate.candidateId,
        selectedName: candidate.name,
        status: "resolved",
      }),
      requestUnderstandingExtractor: createTestExtractor((message) => ({
        constraints: [],
        kind: message.includes("Sample Striker") ? "player_lookup" : "other",
        players: message.includes("Sample Striker")
          ? [{ lookupName: null, mention: "Sample Striker" }]
          : [],
        teams: [],
      })),
      tools: createTools(search),
    });

    const config = { configurable: { thread_id: "vitest-memory-thread" } };

    const first = await graph.invoke(
      { messages: [new HumanMessage("Look up Sample Striker.")] },
      config
    );

    expect(search.mock.calls[0]?.[0]).toMatchObject({
      limit: 3,
      playerName: "Sample Striker",
      source: "both",
    });
    expect(
      first.messages.some((message) => message instanceof ToolMessage)
    ).toBeTruthy();
    expect(first.messages.at(-1)?.content).toBe(
      "Sample Striker has a 2025/26 fixture record."
    );

    const second = await graph.invoke(
      { messages: [new HumanMessage("Which season was it?")] },
      config
    );

    expect(
      second.messages.some(
        (message) => message.content === "Look up Sample Striker."
      )
    ).toBeTruthy();
    expect(second.messages.at(-1)?.content).toBe("The record is from 2025/26.");
  });

  it("resolves a player mention before the lookup and resumes through Command", async () => {
    const candidate: ReferenceCandidate = {
      candidateId: "reep:harry-kane",
      canonicalIdentityId: "reep-harry-kane",
      exactNameMatch: false,
      identityVerified: true,
      name: "Harry Kane",
      records: [
        {
          competition: "Bundesliga",
          name: "Harry Kane",
          provider: "understat",
          season: "2026/27",
          sourceId: "647",
          team: "Bayern Munich",
        },
        {
          competition: null,
          name: "Harry Kane",
          provider: "fm",
          season: null,
          sourceId: "12075123",
          team: null,
        },
      ],
    };

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      (mention: string) => ({
        candidateCount: 1,
        candidates: [candidate],
        candidatesTruncated: false,
        canonicalIdentityId: null,
        clarificationMessage: `Confirm whether “${mention}” means Harry Kane.`,
        mention,
        selectedCandidateId: null,
        selectedName: null,
        status: "needs_confirmation" as const,
      })
    );

    const search = vi.fn<PlayerSearch>(() =>
      JSON.stringify({ candidates: ["fixture player"] })
    );

    const model = fakeModel()
      .respondWithTools([
        {
          args: { playerName: "Bayern Munich striker" },
          name: "search_player_records",
        },
      ])
      .respond(
        new AIMessage("I found a candidate for the confirmed reference player.")
      );

    const graph = createAgent({
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createTestExtractor(() => ({
        constraints: [],
        kind: "player_lookup",
        players: [{ lookupName: "Kane", mention: "Kane" }],
        teams: [],
      })),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "identity-confirmation-thread" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage("Look up Kane's records.")] },
      config
    );

    expect({
      identityLookupArguments: identityLookup.mock.calls.map(
        ([mention]) => mention
      ),
      interrupted: Object.hasOwn(interrupted, "__interrupt__"),
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      identityLookupArguments: ["Kane"],
      interrupted: true,
      searchCalls: 0,
    });

    const resumed = await graph.invoke(new Command({ resume: "1" }), config);

    expect(search).toHaveBeenCalledOnce();
    expect(resumed.request).toMatchObject({
      players: [{ resolution: { canonicalIdentityId: "reep-harry-kane" } }],
      status: "ready",
    });
    expect(resumed.messages.at(-1)?.content).toBe(
      "I found a candidate for the confirmed reference player."
    );
  });

  it("passes through for a full name with a verified Reep identity", async () => {
    const candidate: ReferenceCandidate = {
      candidateId: "reep:harry-kane",
      canonicalIdentityId: "reep-harry-kane",
      exactNameMatch: true,
      identityVerified: true,
      name: "Harry Kane",
      records: [],
    };

    const model = fakeModel().respond(
      new AIMessage("I will use Harry Kane as the reference.")
    );

    const lookup = vi.fn<ReferenceIdentityLookup>((mention: string) => ({
      candidateCount: 1,
      candidates: [candidate],
      candidatesTruncated: false,
      canonicalIdentityId: candidate.canonicalIdentityId,
      clarificationMessage: null,
      mention,
      selectedCandidateId: candidate.candidateId,
      selectedName: candidate.name,
      status: "resolved" as const,
    }));

    const graph = createAgent({
      model,
      playerIdentityLookup: lookup,
      requestUnderstandingExtractor: createTestExtractor(() => ({
        constraints: [],
        kind: "player_lookup",
        players: [{ lookupName: "Harry Kane", mention: "Harry Kane" }],
        teams: [],
      })),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Look up Harry Kane.")] },
      { configurable: { thread_id: "exact-reference-thread" } }
    );

    expect(result).not.toHaveProperty("__interrupt__");
    expect(lookup).toHaveBeenCalledWith("Harry Kane");
    expect(result.request.status).toBe("ready");
    expect(result.request.players[0]?.resolution?.canonicalIdentityId).toBe(
      "reep-harry-kane"
    );
    expect(result.messages.at(-1)?.content).toBe(
      "I will use Harry Kane as the reference."
    );
  });

  it("remembers a confirmed Chinese alias and pins lookup tools to its identity", async () => {
    const kimmich: ReferenceCandidate = {
      candidateId: "reep:joshua-kimmich",
      canonicalIdentityId: "reep-joshua-kimmich",
      exactNameMatch: true,
      identityVerified: true,
      name: "Joshua Kimmich",
      records: [
        {
          competition: null,
          name: "Joshua Kimmich",
          provider: "fm",
          season: null,
          sourceId: "kimmich-fm",
          team: null,
        },
      ],
    };

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      (mention: string) => ({
        candidateCount: 1,
        candidates: [kimmich],
        candidatesTruncated: false,
        canonicalIdentityId: kimmich.canonicalIdentityId,
        clarificationMessage: null,
        mention,
        selectedCandidateId: kimmich.candidateId,
        selectedName: kimmich.name,
        status: "resolved" as const,
      })
    );

    const search = vi.fn<PlayerSearch>((input: PlayerSearchInput) =>
      JSON.stringify({
        player: input.playerName,
      })
    );

    const model = fakeModel()
      .respondWithTools([
        {
          args: { playerName: "Declan Rice" },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("Joshua Kimmich is the first lookup result."))
      .respondWithTools([
        {
          args: { playerName: "Declan Rice" },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("Joshua Kimmich is the repeated lookup result."));

    const graph = createAgent({
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createTestExtractor((message) => ({
        constraints: [],
        kind: "player_lookup",
        players: [
          message.includes("查询")
            ? { lookupName: "Joshua Kimmich", mention: "基米希" }
            : { lookupName: "Joshua Kimmich", mention: "Joshua Kimmich" },
        ],
        teams: [],
      })),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "confirmed-player-alias-thread" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage("查询基米希的资料")] },
      config
    );

    expect({
      identityLookupCalls: identityLookup.mock.calls.length,
      interrupted: Object.hasOwn(interrupted, "__interrupt__"),
    }).toStrictEqual({ identityLookupCalls: 1, interrupted: true });

    const first = await graph.invoke(new Command({ resume: "1" }), config);
    expect(first.conversationContext.playerAliases).toMatchObject([
      {
        mention: "基米希",
        reference: { referenceId: "reep-joshua-kimmich" },
      },
    ]);

    const repeated = await graph.invoke(
      { messages: [new HumanMessage("再介绍一下基米希")] },
      config
    );

    expect({
      identityLookupCalls: identityLookup.mock.calls.length,
      interrupted: Object.hasOwn(repeated, "__interrupt__"),
      searchedPlayers: search.mock.calls.map(([input]) => input.playerName),
      selectedName: repeated.request.players[0]?.resolution?.selectedName,
    }).toStrictEqual({
      identityLookupCalls: 1,
      interrupted: false,
      searchedPlayers: ["Joshua Kimmich", "Joshua Kimmich"],
      selectedName: "Joshua Kimmich",
    });
  });

  it("updates the focus when the user corrects an identity in an other request", async () => {
    const rice: ReferenceCandidate = {
      candidateId: "reep:declan-rice",
      canonicalIdentityId: "reep-declan-rice",
      exactNameMatch: true,
      identityVerified: true,
      name: "Declan Rice",
      records: [
        {
          competition: null,
          name: "Declan Rice",
          provider: "fm",
          season: null,
          sourceId: "rice-fm",
          team: null,
        },
      ],
    };

    const kimmich: ReferenceCandidate = {
      candidateId: "reep:joshua-kimmich",
      canonicalIdentityId: "reep-joshua-kimmich",
      exactNameMatch: true,
      identityVerified: true,
      name: "Joshua Kimmich",
      records: [
        {
          competition: null,
          name: "Joshua Kimmich",
          provider: "fm",
          season: null,
          sourceId: "kimmich-fm",
          team: null,
        },
      ],
    };

    const identityLookup = vi.fn<ReferenceIdentityLookup>((mention: string) => {
      const candidate = mention === "Joshua Kimmich" ? kimmich : rice;

      return {
        candidateCount: 1,
        candidates: [candidate],
        candidatesTruncated: false,
        canonicalIdentityId:
          candidate === kimmich ? null : candidate.canonicalIdentityId,
        clarificationMessage: `Confirm whether “${mention}” means ${candidate.name}.`,
        mention,
        selectedCandidateId:
          candidate === kimmich ? null : candidate.candidateId,
        selectedName: candidate === kimmich ? null : candidate.name,
        status:
          candidate === kimmich
            ? ("needs_confirmation" as const)
            : ("resolved" as const),
      };
    });

    const search = vi.fn<PlayerSearch>(() =>
      JSON.stringify({ player: "fixture" })
    );

    const model = fakeModel()
      .respondWithTools([
        {
          args: { playerName: "Declan Rice" },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("Rice profile."))
      .respond(new AIMessage("Understood, I meant Joshua Kimmich."));

    const graph = createAgent({
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createTestExtractor((message) => {
        if (message.includes("Declan Rice")) {
          return {
            constraints: [],
            kind: "player_lookup",
            players: [{ lookupName: null, mention: "Declan Rice" }],
            teams: [],
          };
        }

        return {
          constraints: [],
          kind: "other",
          players: [{ lookupName: "Joshua Kimmich", mention: "基米希" }],
          teams: [],
        };
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "identity-correction-focus-thread" },
    };

    const first = await graph.invoke(
      { messages: [new HumanMessage("Look up Declan Rice.")] },
      config
    );

    expect(
      first.conversationContext.focusPlayers.map(
        ({ candidate }) => candidate.name
      )
    ).toStrictEqual(["Declan Rice"]);

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage("我说的是基米希")] },
      config
    );

    expect(interrupted).toHaveProperty("__interrupt__");

    const corrected = await graph.invoke(new Command({ resume: "1" }), config);

    expect({
      aliases: corrected.conversationContext.playerAliases,
      focusPlayers: corrected.conversationContext.focusPlayers.map(
        ({ candidate }) => candidate.name
      ),
      kind: corrected.request.kind,
      selectedName: corrected.request.players[0]?.resolution?.selectedName,
    }).toMatchObject({
      aliases: [
        {
          mention: "Declan Rice",
          reference: {
            candidate: { name: "Declan Rice" },
            referenceId: "reep-declan-rice",
          },
        },
        {
          mention: "基米希",
          reference: {
            candidate: {
              canonicalIdentityId: "reep-joshua-kimmich",
              name: "Joshua Kimmich",
            },
            referenceId: "reep-joshua-kimmich",
          },
        },
      ],
      focusPlayers: ["Joshua Kimmich"],
      kind: "other",
      selectedName: "Joshua Kimmich",
    });
  });

  it("asks when one confirmed alias is bound to multiple player identities", async () => {
    const kimmich: ReferenceCandidate = {
      candidateId: "reep:joshua-kimmich",
      canonicalIdentityId: "reep-joshua-kimmich",
      exactNameMatch: true,
      identityVerified: true,
      name: "Joshua Kimmich",
      records: [],
    };

    const anotherPlayer: ReferenceCandidate = {
      candidateId: "reep:another-player",
      canonicalIdentityId: "reep-another-player",
      exactNameMatch: true,
      identityVerified: true,
      name: "Another Player",
      records: [],
    };

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      (mention: string) => ({
        candidateCount: 0,
        candidates: [],
        candidatesTruncated: false,
        canonicalIdentityId: null,
        clarificationMessage: null,
        mention,
        selectedCandidateId: null,
        selectedName: null,
        status: "not_found" as const,
      })
    );

    const search = vi.fn<PlayerSearch>(() =>
      JSON.stringify({ player: "fixture" })
    );

    const graph = createAgent({
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createTestExtractor(() => ({
        constraints: [],
        kind: "player_lookup",
        players: [{ lookupName: "Joshua Kimmich", mention: "基米希" }],
        teams: [],
      })),
      tools: createTools(search),
    });

    const result = await graph.invoke(
      {
        conversationContext: {
          focusPlayers: [],
          playerAliases: [
            {
              mention: "基米希",
              reference: {
                candidate: kimmich,
                referenceId: "reep-joshua-kimmich",
              },
            },
            {
              mention: "基米希",
              reference: {
                candidate: anotherPlayer,
                referenceId: "reep-another-player",
              },
            },
          ],
        },
        messages: [new HumanMessage("介绍一下基米希")],
      },
      { configurable: { thread_id: "ambiguous-player-alias-thread" } }
    );

    expect(result).toHaveProperty("__interrupt__");
    expect(identityLookup).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("keeps a prior-focus pronoun separate from a same-turn comparison player", async () => {
    const saebari: ReferenceCandidate = {
      candidateId: "reep:ismael-saibari",
      canonicalIdentityId: "reep-ismael-saibari",
      exactNameMatch: true,
      identityVerified: true,
      name: "Ismael Saibari",
      records: [
        {
          competition: null,
          name: "Ismael Saibari",
          provider: "fm",
          season: null,
          sourceId: "saibari-fm",
          team: null,
        },
      ],
    };

    const kvaratskhelia: ReferenceCandidate = {
      candidateId: "reep:khvicha-kvaratskhelia",
      canonicalIdentityId: "reep-khvicha-kvaratskhelia",
      exactNameMatch: true,
      identityVerified: true,
      name: "Khvicha Kvaratskhelia",
      records: [
        {
          competition: null,
          name: "Khvicha Kvaratskhelia",
          provider: "fm",
          season: null,
          sourceId: "kvaratskhelia-fm",
          team: null,
        },
      ],
    };

    const identityLookup = vi.fn<ReferenceIdentityLookup>((mention: string) => {
      const candidate = mention === "Ismael Saibari" ? saebari : kvaratskhelia;

      return {
        candidateCount: 1,
        candidates: [candidate],
        candidatesTruncated: false,
        canonicalIdentityId: candidate.canonicalIdentityId,
        clarificationMessage: null,
        mention,
        selectedCandidateId: candidate.candidateId,
        selectedName: candidate.name,
        status: "resolved" as const,
      };
    });

    const search = vi.fn<PlayerSearch>((input: PlayerSearchInput) =>
      JSON.stringify({
        identityGroups: { canonicalGroups: [] },
        query: input.playerName,
      })
    );

    const model = fakeModel()
      .respondWithTools([
        {
          args: { playerName: "Ismael Saibari" },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("Ismael Saibari is the lookup result."))
      .respond(
        new AIMessage(
          "The local data does not include comparable records for both players."
        )
      )
      .respondWithTools([
        {
          args: { playerName: "Declan Rice" },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("Ismael Saibari is the profile result."));

    const graph = createAgent({
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createTestExtractor((message) => {
        if (message.includes("Ismael Saibari")) {
          return {
            constraints: [],
            kind: "player_lookup",
            players: [{ lookupName: null, mention: "Ismael Saibari" }],
            teams: [],
          };
        }

        if (message.includes("Khvicha Kvaratskhelia")) {
          return {
            constraints: [],
            kind: "player_comparison",
            players: [
              {
                lookupName: null,
                mention: "He",
                referenceScope: "prior_context",
              },
              {
                lookupName: "Khvicha Kvaratskhelia",
                mention: "Khvicha Kvaratskhelia",
              },
            ],
            teams: [],
          };
        }

        return {
          constraints: [],
          kind: "player_lookup",
          players: [
            {
              lookupName: null,
              mention: "him",
              referenceScope: "prior_context",
            },
          ],
          teams: [],
        };
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "prior-focus-comparison-thread" },
    };

    const first = await graph.invoke(
      { messages: [new HumanMessage("Look up Ismael Saibari.")] },
      config
    );

    expect(first.conversationContext.focusPlayers).toMatchObject([
      { candidate: { name: "Ismael Saibari" } },
    ]);

    const comparison = await graph.invoke(
      {
        messages: [
          new HumanMessage("He seems worse than Khvicha Kvaratskhelia."),
        ],
      },
      config
    );

    expect({
      focusPlayers: comparison.conversationContext.focusPlayers.map(
        ({ candidate }) => candidate.name
      ),
      identityLookups: identityLookup.mock.calls.map(([mention]) => mention),
      message: comparison.messages.at(-1)?.content,
      players: comparison.request.players.map((player) => ({
        referenceScope: player.referenceScope,
        selectedName: player.resolution?.selectedName,
      })),
      searchedForComparison: search.mock.calls
        .slice(1)
        .map(([input]) => input.playerName),
    }).toStrictEqual({
      focusPlayers: ["Ismael Saibari"],
      identityLookups: ["Ismael Saibari", "Khvicha Kvaratskhelia"],
      message:
        "The local data does not include comparable records for both players.",
      players: [
        {
          referenceScope: "prior_context",
          selectedName: "Ismael Saibari",
        },
        {
          referenceScope: "explicit",
          selectedName: "Khvicha Kvaratskhelia",
        },
      ],
      searchedForComparison: ["Ismael Saibari", "Khvicha Kvaratskhelia"],
    });

    const followUp = await graph.invoke(
      { messages: [new HumanMessage("Give me his profile.")] },
      config
    );

    expect({
      response: followUp.messages.at(-1)?.content,
      searchedPlayers: search.mock.calls.map(([input]) => input.playerName),
      selectedName: followUp.request.players[0]?.resolution?.selectedName,
    }).toStrictEqual({
      response: "Ismael Saibari is the profile result.",
      searchedPlayers: [
        "Ismael Saibari",
        "Ismael Saibari",
        "Khvicha Kvaratskhelia",
        "Ismael Saibari",
      ],
      selectedName: "Ismael Saibari",
    });
  });

  it("adds a player to the comparison in the same thread without leaking it to another thread", async () => {
    const candidates = new Map<string, ReferenceCandidate>([
      [
        "Kylian Mbappé",
        {
          candidateId: "reep:kylian-mbappe",
          canonicalIdentityId: "reep-kylian-mbappe",
          exactNameMatch: true,
          identityVerified: true,
          name: "Kylian Mbappé",
          records: [],
        },
      ],
      [
        "Troy Parrott",
        {
          candidateId: "reep:troy-parrott",
          canonicalIdentityId: "reep-troy-parrott",
          exactNameMatch: true,
          identityVerified: true,
          name: "Troy Parrott",
          records: [],
        },
      ],
      [
        "Erling Haaland",
        {
          candidateId: "reep:erling-haaland",
          canonicalIdentityId: "reep-erling-haaland",
          exactNameMatch: true,
          identityVerified: true,
          name: "Erling Haaland",
          records: [],
        },
      ],
    ]);

    const identityLookup = vi.fn<ReferenceIdentityLookup>((mention) => {
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
        status: "resolved" as const,
      };
    });

    const search = vi.fn<PlayerSearch>((input: PlayerSearchInput) =>
      JSON.stringify({
        identityGroups: { canonicalGroups: [] },
        query: input.playerName,
      })
    );

    const model = fakeModel()
      .respond(new AIMessage("The first comparison completed."))
      .respond(new AIMessage("The three-player comparison completed."));

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createTestExtractor((message) =>
        message.includes("Erling Haaland")
          ? {
              comparisonAction: "add",
              constraints: [],
              kind: "player_comparison",
              players: [{ lookupName: null, mention: "Erling Haaland" }],
              teams: [],
            }
          : {
              comparisonAction: "replace",
              constraints: [],
              kind: "player_comparison",
              players: [
                { lookupName: null, mention: "Kylian Mbappé" },
                { lookupName: null, mention: "Troy Parrott" },
              ],
              teams: [],
            }
      ),
      store: new InMemoryStore(),
      tools: createTools(search),
    });

    const comparisonThread = {
      configurable: { thread_id: "comparison-context-thread" },
    };

    const firstComparison = await graph.invoke(
      {
        messages: [new HumanMessage("Compare Kylian Mbappé and Troy Parrott.")],
      },
      comparisonThread
    );

    expect(
      firstComparison.conversationContext.activeComparison.players.map(
        ({ candidate }) => candidate.name
      )
    ).toStrictEqual(["Kylian Mbappé", "Troy Parrott"]);

    const expandedComparison = await graph.invoke(
      {
        messages: [
          new HumanMessage("Also add Erling Haaland to the comparison."),
        ],
      },
      comparisonThread
    );

    expect({
      action: expandedComparison.request.comparisonAction,
      activeComparison:
        expandedComparison.conversationContext.activeComparison.players.map(
          ({ candidate }) => candidate.name
        ),
      message: expandedComparison.messages.at(-1)?.content,
      players: expandedComparison.request.players.map(
        (player) => player.resolution?.selectedName
      ),
      searchedPlayers: search.mock.calls
        .slice(2)
        .map(([input]) => input.playerName),
    }).toStrictEqual({
      action: "add",
      activeComparison: ["Kylian Mbappé", "Troy Parrott", "Erling Haaland"],
      message: "The three-player comparison completed.",
      players: ["Kylian Mbappé", "Troy Parrott", "Erling Haaland"],
      searchedPlayers: ["Kylian Mbappé", "Troy Parrott", "Erling Haaland"],
    });

    const separateThread = await graph.invoke(
      {
        messages: [
          new HumanMessage("Also add Erling Haaland to the comparison."),
        ],
      },
      { configurable: { thread_id: "separate-comparison-thread" } }
    );

    expect({
      activeComparison:
        separateThread.conversationContext.activeComparison.players,
      message: separateThread.messages.at(-1)?.content,
      playerCount: separateThread.request.players.length,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      activeComparison: [],
      message:
        "当前线程没有可继续添加的球员比较。请先提供至少两名球员开始比较。",
      playerCount: 1,
      searchCalls: 5,
    });
  });

  it("recovers the last comparison participants from thread history", async () => {
    const haaland: ReferenceCandidate = {
      candidateId: "reep:erling-haaland",
      canonicalIdentityId: "reep-erling-haaland",
      exactNameMatch: true,
      identityVerified: true,
      name: "Erling Haaland",
      records: [],
    };

    const identityLookup = vi.fn<ReferenceIdentityLookup>((mention) => ({
      candidateCount: 1,
      candidates: [haaland],
      candidatesTruncated: false,
      canonicalIdentityId: haaland.canonicalIdentityId,
      clarificationMessage: null,
      mention,
      selectedCandidateId: haaland.candidateId,
      selectedName: haaland.name,
      status: "resolved" as const,
    }));

    const search = vi.fn<PlayerSearch>((input: PlayerSearchInput) =>
      JSON.stringify({
        identityGroups: { canonicalGroups: [] },
        query: input.playerName,
      })
    );

    const model = fakeModel().respond(
      new AIMessage("The recovered three-player comparison completed.")
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createTestExtractor(() => ({
        comparisonAction: "add",
        constraints: [],
        kind: "player_comparison",
        players: [{ lookupName: null, mention: "Erling Haaland" }],
        teams: [],
      })),
      store: new InMemoryStore(),
      tools: createTools(search),
    });

    const priorComparisonId = "previous-comparison-call";

    const result = await graph.invoke(
      {
        messages: [
          new HumanMessage("Compare Kylian Mbappé and Troy Parrott."),
          new AIMessage({
            content: "",
            tool_calls: [
              {
                args: {
                  players: [
                    {
                      canonicalIdentityId: "reep-kylian-mbappe",
                      identityBasis: "reep_registry",
                      playerName: "Kylian Mbappé",
                      sourceRecords: [
                        { provider: "fm", sourceId: "mbappe-fm" },
                      ],
                    },
                    {
                      canonicalIdentityId: "reep-troy-parrott",
                      identityBasis: "reep_registry",
                      playerName: "Troy Parrott",
                      sourceRecords: [
                        { provider: "fm", sourceId: "parrott-fm" },
                      ],
                    },
                  ],
                  source: "both",
                },
                id: priorComparisonId,
                name: "compare_player_records",
                type: "tool_call",
              },
            ],
          }),
          new ToolMessage({
            content: JSON.stringify({ status: "no_comparable_data" }),
            name: "compare_player_records",
            tool_call_id: priorComparisonId,
          }),
          new AIMessage("The earlier comparison completed."),
          new HumanMessage("Also add Erling Haaland to the comparison."),
        ],
      },
      { configurable: { thread_id: "historical-comparison-thread" } }
    );

    expect({
      activeComparison: result.conversationContext.activeComparison.players.map(
        ({ candidate }) => candidate.name
      ),
      players: result.request.players.map(
        (player) => player.resolution?.selectedName
      ),
      searchedPlayers: search.mock.calls.map(([input]) => input.playerName),
    }).toStrictEqual({
      activeComparison: ["Kylian Mbappé", "Troy Parrott", "Erling Haaland"],
      players: ["Kylian Mbappé", "Troy Parrott", "Erling Haaland"],
      searchedPlayers: ["Kylian Mbappé", "Troy Parrott", "Erling Haaland"],
    });
  });
});
