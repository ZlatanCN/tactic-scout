import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import type { PlayerSearchInput } from "../src/utils/tools.js";
import type { ReferenceCandidate } from "../src/utils/state.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");
vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");
vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../src/agent.js");
const { createTools } = await import("../src/utils/tools.js");

describe("LangGraph model-tool loop", () => {
  it("runs a tool call, returns its result to the model, and resumes thread messages in memory", async () => {
    const candidate: ReferenceCandidate = {
      candidateId: "fixture:sample-striker",
      name: "Sample Striker",
      canonicalIdentityId: "fixture-sample-striker",
      identityVerified: true,
      exactNameMatch: true,
      records: [],
    };
    const search = vi.fn(async (input: PlayerSearchInput) => JSON.stringify({
      source: "fixture",
      player: input.playerName,
      season: "2025/26",
    }));
    const model = fakeModel()
      .respondWithTools([{
        name: "search_player_records",
        args: { playerName: "Sample Striker" },
      }])
      .respond(new AIMessage("Sample Striker has a 2025/26 fixture record."))
      .respond(new AIMessage("The record is from 2025/26."));
    const graph = createAgent({
      model,
      tools: createTools(search),
      playerIdentityLookup: async (mention) => ({
        status: "resolved",
        mention,
        selectedCandidateId: candidate.candidateId,
        canonicalIdentityId: candidate.canonicalIdentityId,
        selectedName: candidate.name,
        candidates: [candidate],
        candidateCount: 1,
        candidatesTruncated: false,
        clarificationMessage: null,
      }),
      requestUnderstandingExtractor: async (message) => ({
        kind: message.includes("Sample Striker") ? "player_lookup" : "other",
        players: message.includes("Sample Striker")
          ? [{ mention: "Sample Striker", lookupName: null }]
          : [],
        teams: [],
        constraints: [],
      }),
    });
    const config = { configurable: { thread_id: "vitest-memory-thread" } };

    const first = await graph.invoke(
      { messages: [new HumanMessage("Look up Sample Striker.")] },
      config,
    );

    expect(search.mock.calls[0]?.[0]).toMatchObject({
      playerName: "Sample Striker",
      source: "both",
      limit: 3,
    });
    expect(first.messages.some((message) => message instanceof ToolMessage)).toBe(true);
    expect(first.messages.at(-1)?.content).toBe("Sample Striker has a 2025/26 fixture record.");

    const second = await graph.invoke(
      { messages: [new HumanMessage("Which season was it?")] },
      config,
    );

    expect(second.messages.some((message) => message.content === "Look up Sample Striker.")).toBe(true);
    expect(second.messages.at(-1)?.content).toBe("The record is from 2025/26.");
  });

  it("resolves a player mention before the lookup and resumes through Command", async () => {
    const candidate: ReferenceCandidate = {
      candidateId: "reep:harry-kane",
      name: "Harry Kane",
      canonicalIdentityId: "reep-harry-kane",
      identityVerified: true,
      exactNameMatch: false,
      records: [
        {
          provider: "understat",
          sourceId: "647",
          name: "Harry Kane",
          team: "Bayern Munich",
          competition: "Bundesliga",
          season: "2026/27",
        },
        {
          provider: "fm",
          sourceId: "12075123",
          name: "Harry Kane",
          team: null,
          competition: null,
          season: null,
        },
      ],
    };
    const identityLookup = vi.fn(async (mention: string) => ({
      status: "needs_confirmation" as const,
      mention,
      selectedCandidateId: null,
      canonicalIdentityId: null,
      selectedName: null,
      candidates: [candidate],
      candidateCount: 1,
      candidatesTruncated: false,
      clarificationMessage: `Confirm whether “${mention}” means Harry Kane.`,
    }));
    const search = vi.fn(async () => JSON.stringify({ candidates: ["fixture player"] }));
    const model = fakeModel()
      .respondWithTools([{
        name: "search_player_records",
        args: { playerName: "Bayern Munich striker" },
      }])
      .respond(new AIMessage("I found a candidate for the confirmed reference player."));
    const graph = createAgent({
      model,
      tools: createTools(search),
      requestUnderstandingExtractor: async () => ({
        kind: "player_lookup",
        players: [{ mention: "Kane", lookupName: "Kane" }],
        teams: [],
        constraints: [],
      }),
      playerIdentityLookup: identityLookup,
    });
    const config = { configurable: { thread_id: "identity-confirmation-thread" } };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage("Look up Kane's records.")] },
      config,
    );

    expect(interrupted).toHaveProperty("__interrupt__");
    expect(search).not.toHaveBeenCalled();
    expect(identityLookup).toHaveBeenCalledWith("Kane");

    const resumed = await graph.invoke(new Command({ resume: "1" }), config);

    expect(search).toHaveBeenCalledTimes(1);
    expect(resumed.request.status).toBe("ready");
    expect(resumed.request.players[0]?.resolution?.canonicalIdentityId).toBe("reep-harry-kane");
    expect(resumed.messages.at(-1)?.content).toBe("I found a candidate for the confirmed reference player.");
  });

  it("passes through for a full name with a verified Reep identity", async () => {
    const candidate: ReferenceCandidate = {
      candidateId: "reep:harry-kane",
      name: "Harry Kane",
      canonicalIdentityId: "reep-harry-kane",
      identityVerified: true,
      exactNameMatch: true,
      records: [],
    };
    const model = fakeModel().respond(new AIMessage("I will use Harry Kane as the reference."));
    const lookup = vi.fn(async (mention: string) => ({
      status: "resolved" as const,
      mention,
      selectedCandidateId: candidate.candidateId,
      canonicalIdentityId: candidate.canonicalIdentityId,
      selectedName: candidate.name,
      candidates: [candidate],
      candidateCount: 1,
      candidatesTruncated: false,
      clarificationMessage: null,
    }));
    const graph = createAgent({
      model,
      requestUnderstandingExtractor: async () => ({
        kind: "player_lookup",
        players: [{ mention: "Harry Kane", lookupName: "Harry Kane" }],
        teams: [],
        constraints: [],
      }),
      playerIdentityLookup: lookup,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Look up Harry Kane.")] },
      { configurable: { thread_id: "exact-reference-thread" } },
    );

    expect(result).not.toHaveProperty("__interrupt__");
    expect(lookup).toHaveBeenCalledWith("Harry Kane");
    expect(result.request.status).toBe("ready");
    expect(result.request.players[0]?.resolution?.canonicalIdentityId).toBe("reep-harry-kane");
    expect(result.messages.at(-1)?.content).toBe("I will use Harry Kane as the reference.");
  });

  it("remembers a confirmed Chinese alias and pins lookup tools to its identity", async () => {
    const kimmich: ReferenceCandidate = {
      candidateId: "reep:joshua-kimmich",
      name: "Joshua Kimmich",
      canonicalIdentityId: "reep-joshua-kimmich",
      identityVerified: true,
      exactNameMatch: true,
      records: [],
    };
    const identityLookup = vi.fn(async (mention: string) => ({
      status: "resolved" as const,
      mention,
      selectedCandidateId: kimmich.candidateId,
      canonicalIdentityId: kimmich.canonicalIdentityId,
      selectedName: kimmich.name,
      candidates: [kimmich],
      candidateCount: 1,
      candidatesTruncated: false,
      clarificationMessage: null,
    }));
    const search = vi.fn(async (input: PlayerSearchInput) => JSON.stringify({
      player: input.playerName,
    }));
    const model = fakeModel()
      .respondWithTools([{
        name: "search_player_records",
        args: { playerName: "Declan Rice" },
      }])
      .respond(new AIMessage("Joshua Kimmich is the first lookup result."))
      .respondWithTools([{
        name: "search_player_records",
        args: { playerName: "Declan Rice" },
      }])
      .respond(new AIMessage("Joshua Kimmich is the repeated lookup result."));
    const graph = createAgent({
      model,
      tools: createTools(search),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: async (message) => ({
        kind: "player_lookup",
        players: [message.includes("查询")
          ? { mention: "基米希", lookupName: "Joshua Kimmich" }
          : { mention: "Joshua Kimmich", lookupName: "Joshua Kimmich" }],
        teams: [],
        constraints: [],
      }),
    });
    const config = { configurable: { thread_id: "confirmed-player-alias-thread" } };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage("查询基米希的资料")] },
      config,
    );
    expect(interrupted).toHaveProperty("__interrupt__");
    expect(identityLookup).toHaveBeenCalledTimes(1);

    const first = await graph.invoke(new Command({ resume: "1" }), config);
    expect(first.conversationContext.playerAliases).toMatchObject([{
      mention: "基米希",
      reference: { referenceId: "reep-joshua-kimmich" },
    }]);

    const repeated = await graph.invoke(
      { messages: [new HumanMessage("再介绍一下基米希")] },
      config,
    );

    expect(repeated).not.toHaveProperty("__interrupt__");
    expect(identityLookup).toHaveBeenCalledTimes(1);
    expect(repeated.request.players[0]?.resolution?.selectedName).toBe("Joshua Kimmich");
    expect(search.mock.calls.map(([input]) => input.playerName))
      .toEqual(["Joshua Kimmich", "Joshua Kimmich"]);
  });

  it("updates the focus when the user corrects an identity in an other request", async () => {
    const rice: ReferenceCandidate = {
      candidateId: "reep:declan-rice",
      name: "Declan Rice",
      canonicalIdentityId: "reep-declan-rice",
      identityVerified: true,
      exactNameMatch: true,
      records: [],
    };
    const kimmich: ReferenceCandidate = {
      candidateId: "reep:joshua-kimmich",
      name: "Joshua Kimmich",
      canonicalIdentityId: "reep-joshua-kimmich",
      identityVerified: true,
      exactNameMatch: true,
      records: [],
    };
    const identityLookup = vi.fn(async (mention: string) => {
      const candidate = mention === "Joshua Kimmich" ? kimmich : rice;
      return {
        status: candidate === kimmich ? "needs_confirmation" as const : "resolved" as const,
        mention,
        selectedCandidateId: candidate === kimmich ? null : candidate.candidateId,
        canonicalIdentityId: candidate === kimmich ? null : candidate.canonicalIdentityId,
        selectedName: candidate === kimmich ? null : candidate.name,
        candidates: [candidate],
        candidateCount: 1,
        candidatesTruncated: false,
        clarificationMessage: `Confirm whether “${mention}” means ${candidate.name}.`,
      };
    });
    const search = vi.fn(async () => JSON.stringify({ player: "fixture" }));
    const model = fakeModel()
      .respondWithTools([{
        name: "search_player_records",
        args: { playerName: "Declan Rice" },
      }])
      .respond(new AIMessage("Rice profile."))
      .respond(new AIMessage("Understood, I meant Joshua Kimmich."));
    const graph = createAgent({
      model,
      tools: createTools(search),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: async (message) => message.includes("Declan Rice")
        ? {
            kind: "player_lookup",
            players: [{ mention: "Declan Rice", lookupName: null }],
            teams: [],
            constraints: [],
          }
        : {
            kind: "other",
            players: [{ mention: "基米希", lookupName: "Joshua Kimmich" }],
            teams: [],
            constraints: [],
          },
    });
    const config = { configurable: { thread_id: "identity-correction-focus-thread" } };

    const first = await graph.invoke(
      { messages: [new HumanMessage("Look up Declan Rice.")] },
      config,
    );
    expect(first.conversationContext.focusPlayers.map(({ candidate }) => candidate.name))
      .toEqual(["Declan Rice"]);

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage("我说的是基米希")] },
      config,
    );
    expect(interrupted).toHaveProperty("__interrupt__");

    const corrected = await graph.invoke(new Command({ resume: "1" }), config);

    expect(corrected.request.kind).toBe("other");
    expect(corrected.request.players[0]?.resolution?.selectedName).toBe("Joshua Kimmich");
    expect(corrected.conversationContext.focusPlayers.map(({ candidate }) => candidate.name))
      .toEqual(["Joshua Kimmich"]);
    expect(corrected.conversationContext.playerAliases).toContainEqual({
      mention: "基米希",
      reference: {
        referenceId: "reep-joshua-kimmich",
        candidate: kimmich,
      },
    });
  });

  it("asks when one confirmed alias is bound to multiple player identities", async () => {
    const kimmich: ReferenceCandidate = {
      candidateId: "reep:joshua-kimmich",
      name: "Joshua Kimmich",
      canonicalIdentityId: "reep-joshua-kimmich",
      identityVerified: true,
      exactNameMatch: true,
      records: [],
    };
    const anotherPlayer: ReferenceCandidate = {
      candidateId: "reep:another-player",
      name: "Another Player",
      canonicalIdentityId: "reep-another-player",
      identityVerified: true,
      exactNameMatch: true,
      records: [],
    };
    const identityLookup = vi.fn(async (mention: string) => ({
      status: "not_found" as const,
      mention,
      selectedCandidateId: null,
      canonicalIdentityId: null,
      selectedName: null,
      candidates: [],
      candidateCount: 0,
      candidatesTruncated: false,
      clarificationMessage: null,
    }));
    const search = vi.fn(async () => JSON.stringify({ player: "fixture" }));
    const graph = createAgent({
      model: fakeModel(),
      tools: createTools(search),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: async () => ({
        kind: "player_lookup",
        players: [{ mention: "基米希", lookupName: "Joshua Kimmich" }],
        teams: [],
        constraints: [],
      }),
    });

    const result = await graph.invoke(
      {
        messages: [new HumanMessage("介绍一下基米希")],
        conversationContext: {
          focusPlayers: [],
          playerAliases: [
            {
              mention: "基米希",
              reference: {
                referenceId: "reep-joshua-kimmich",
                candidate: kimmich,
              },
            },
            {
              mention: "基米希",
              reference: {
                referenceId: "reep-another-player",
                candidate: anotherPlayer,
              },
            },
          ],
        },
      },
      { configurable: { thread_id: "ambiguous-player-alias-thread" } },
    );

    expect(result).toHaveProperty("__interrupt__");
    expect(identityLookup).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("keeps a prior-focus pronoun separate from a same-turn comparison player", async () => {
    const saebari: ReferenceCandidate = {
      candidateId: "reep:ismael-saibari",
      name: "Ismael Saibari",
      canonicalIdentityId: "reep-ismael-saibari",
      identityVerified: true,
      exactNameMatch: true,
      records: [{
        provider: "fm",
        sourceId: "saibari-fm",
        name: "Ismael Saibari",
        team: null,
        competition: null,
        season: null,
      }],
    };
    const kvaratskhelia: ReferenceCandidate = {
      candidateId: "reep:khvicha-kvaratskhelia",
      name: "Khvicha Kvaratskhelia",
      canonicalIdentityId: "reep-khvicha-kvaratskhelia",
      identityVerified: true,
      exactNameMatch: true,
      records: [{
        provider: "fm",
        sourceId: "kvaratskhelia-fm",
        name: "Khvicha Kvaratskhelia",
        team: null,
        competition: null,
        season: null,
      }],
    };
    const identityLookup = vi.fn(async (mention: string) => {
      const candidate = mention === "Ismael Saibari" ? saebari : kvaratskhelia;
      return {
        status: "resolved" as const,
        mention,
        selectedCandidateId: candidate.candidateId,
        canonicalIdentityId: candidate.canonicalIdentityId,
        selectedName: candidate.name,
        candidates: [candidate],
        candidateCount: 1,
        candidatesTruncated: false,
        clarificationMessage: null,
      };
    });
    const search = vi.fn(async (input: PlayerSearchInput) => JSON.stringify({
      player: input.playerName,
    }));
    const model = fakeModel()
      .respondWithTools([{
        name: "search_player_records",
        args: { playerName: "Ismael Saibari" },
      }])
      .respond(new AIMessage("Ismael Saibari is the lookup result."))
      .respondWithTools([{
        name: "search_player_records",
        args: { playerName: "Declan Rice" },
      }])
      .respond(new AIMessage("Ismael Saibari is the profile result."));
    const graph = createAgent({
      model,
      tools: createTools(search),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: async (message) => message.includes("Ismael Saibari")
        ? {
            kind: "player_lookup",
            players: [{ mention: "Ismael Saibari", lookupName: null }],
            teams: [],
            constraints: [],
          }
        : message.includes("Khvicha Kvaratskhelia")
        ? {
            kind: "player_comparison",
            players: [
              {
                mention: "He",
                lookupName: null,
                referenceScope: "prior_context",
              },
              {
                mention: "Khvicha Kvaratskhelia",
                lookupName: "Khvicha Kvaratskhelia",
              },
            ],
            teams: [],
            constraints: [],
          }
        : {
            kind: "player_lookup",
            players: [{
              mention: "him",
              lookupName: null,
              referenceScope: "prior_context",
            }],
            teams: [],
            constraints: [],
          },
    });
    const config = { configurable: { thread_id: "prior-focus-comparison-thread" } };

    const first = await graph.invoke(
      { messages: [new HumanMessage("Look up Ismael Saibari.")] },
      config,
    );
    expect(first.conversationContext.focusPlayers.map(({ candidate }) => candidate.name))
      .toEqual(["Ismael Saibari"]);
    const comparison = await graph.invoke(
      { messages: [new HumanMessage("He seems worse than Khvicha Kvaratskhelia.")] },
      config,
    );

    expect(identityLookup.mock.calls.map(([mention]) => mention)).toEqual([
      "Ismael Saibari",
      "Khvicha Kvaratskhelia",
    ]);
    expect(comparison.request.players[0]?.referenceScope).toBe("prior_context");
    expect(comparison.request.players[0]?.resolution?.selectedName).toBe("Ismael Saibari");
    expect(comparison.request.players[1]?.resolution?.selectedName).toBe("Khvicha Kvaratskhelia");
    expect(comparison.conversationContext.focusPlayers.map(({ candidate }) => candidate.name))
      .toEqual(["Ismael Saibari"]);
    expect(comparison.messages.at(-1)?.content)
      .toBe("我已经识别到这是球员比较请求；比较流程还未接通，目前可以查询单个球员记录。");

    const followUp = await graph.invoke(
      { messages: [new HumanMessage("Give me his profile.")] },
      config,
    );

    expect(followUp.request.players[0]?.resolution?.selectedName).toBe("Ismael Saibari");
    expect(search.mock.calls.map(([input]) => input.playerName))
      .toEqual(["Ismael Saibari", "Ismael Saibari"]);
    expect(followUp.messages.at(-1)?.content).toBe("Ismael Saibari is the profile result.");
  });
});
