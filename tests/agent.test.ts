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
    const graph = createAgent({ model, tools: createTools(search) });
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

  it("pauses on an ambiguous reference and resolves it with Command resume", async () => {
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
      referenceMentionExtractor: async () => ({ referenceMention: "Kane", lookupName: "Kane" }),
      referenceIdentityLookup: identityLookup,
    });
    const config = { configurable: { thread_id: "identity-confirmation-thread" } };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage("Find a replacement for Kane.")] },
      config,
    );

    expect(interrupted).toHaveProperty("__interrupt__");
    expect(search).not.toHaveBeenCalled();
    expect(identityLookup).toHaveBeenCalledWith("Kane");

    const resumed = await graph.invoke(new Command({ resume: "1" }), config);

    expect(search).toHaveBeenCalledTimes(1);
    expect(resumed.referenceResolution.status).toBe("resolved");
    expect(resumed.referenceResolution.canonicalIdentityId).toBe("reep-harry-kane");
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
      referenceMentionExtractor: async () => ({ referenceMention: "Harry Kane", lookupName: "Harry Kane" }),
      referenceIdentityLookup: lookup,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Find a replacement for Harry Kane.")] },
      { configurable: { thread_id: "exact-reference-thread" } },
    );

    expect(result).not.toHaveProperty("__interrupt__");
    expect(lookup).toHaveBeenCalledWith("Harry Kane");
    expect(result.referenceResolution.status).toBe("resolved");
    expect(result.referenceResolution.canonicalIdentityId).toBe("reep-harry-kane");
    expect(result.messages.at(-1)?.content).toBe("I will use Harry Kane as the reference.");
  });
});
