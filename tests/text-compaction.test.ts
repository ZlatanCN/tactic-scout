import { createHash } from "node:crypto";
import { setImmediate as yieldNow } from "node:timers/promises";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import { AgentState } from "../src/state.js";
import type { ContextProcessingState } from "../src/state.js";
import { testModelOutputLimitAdapter } from "./fixtures/model-context.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../src/agent.js");

const modelContextProfile = {
  countingMarginTokens: 64,
  maxInputTokens: 8500,
  maxOutputTokens: 256,
  softTriggerFraction: 0.8,
  targetFraction: 0.6,
};

const anchorAt = (source: string, text: string) => {
  const start = source.indexOf(text);

  return { end: start + text.length, start, text };
};

const mockDeterministicTokenCount = (model: ReturnType<typeof fakeModel>) =>
  vi.spyOn(model, "getNumTokens").mockImplementation(async (input) => {
    const serializedInput = Array.isArray(input)
      ? (JSON.stringify(input) ?? "")
      : input;

    await yieldNow();

    return Math.ceil(serializedInput.length / 4);
  });

describe("automatic text compaction", () => {
  it("compacts an oversized request once, preserves its source, and continues the graph", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane in Bundesliga for 2025/26, excluding Erling Haaland. ${filler}`;

    const instruction =
      "Look up Harry Kane in Bundesliga for 2025/26, excluding Erling Haaland.";

    const compaction = {
      ambiguities: [],
      anchors: [
        { kind: "participant", text: "Harry Kane" },
        { kind: "competition", text: "Bundesliga" },
        { kind: "season", text: "2025/26" },
        { kind: "exclusion", text: "excluding Erling Haaland" },
      ],
      instruction,
      references: [
        { ...anchorAt(original, "Harry Kane"), anchorIndex: 0 },
        { ...anchorAt(original, "Bundesliga"), anchorIndex: 1 },
        { ...anchorAt(original, "2025/26"), anchorIndex: 2 },
        {
          ...anchorAt(original, "excluding Erling Haaland"),
          anchorIndex: 3,
        },
      ],
    };

    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);

    const checkpointer = new MemorySaver();

    const graph = createAgent({
      checkpointer,
      model,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
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
      store: null,
      tools: [],
    });

    const graphConfig = {
      configurable: { thread_id: "text-compaction-graph" },
    };

    const checkpointsBeforeCompaction: ContextProcessingState[] = [];
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    structuredOutput.mockReturnValue(
      RunnableLambda.from(async (input) => {
        modelPayloads.push(input);

        if (modelPayloads.length === 1) {
          const checkpoint = await graph.getState(graphConfig);
          checkpointsBeforeCompaction.push(
            AgentState.parse(checkpoint.values).contextProcessing
          );
        }

        return {
          parsed: {
            ...compaction,
            constraints: [],
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
          raw: new AIMessage("structured response"),
        };
      })
    );

    const result = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage(original)] },
        graphConfig
      )
    );

    const serializedModelInputs = modelPayloads.map((payload) =>
      JSON.stringify(payload)
    );

    const lastSerializedInput = serializedModelInputs.at(-1) ?? "";
    const expectedHash = createHash("sha256").update(original).digest("hex");
    const { allowance } = result.contextProcessing;
    const [checkpoint] = checkpointsBeforeCompaction;

    if (allowance === null || checkpoint === undefined) {
      throw new Error("The compaction allowance checkpoint was not written.");
    }

    expect({
      compactedInstruction: result.contextProcessing?.compaction?.instruction,
      compactedSourceHash: result.contextProcessing?.compaction?.sourceHash,
      modelInputCount: serializedModelInputs.length,
      originalMessage: result.messages[0]?.content,
      originalTextAbsentFromBusinessRequest:
        !lastSerializedInput.includes(filler),
      outcome: result.outcome?.status,
      requestKind: result.request.kind,
      requestPlayer: result.request.players[0]?.mention,
    }).toStrictEqual({
      compactedInstruction: instruction,
      compactedSourceHash: expectedHash,
      modelInputCount: 2,
      originalMessage: original,
      originalTextAbsentFromBusinessRequest: true,
      outcome: "identity_data_unavailable",
      requestKind: "player_lookup",
      requestPlayer: "Harry Kane",
    });
    expect({
      activeTimeIsNonnegative: allowance.consumedActiveTimeMs >= 0,
      checkpointCallCount: checkpoint.allowance?.consumedAdditionalCalls,
      checkpointCompactionHash: checkpoint.compaction?.sourceHash,
      checkpointCompactionStatus: checkpoint.compaction?.status,
      checkpointOperation: checkpoint.allowance?.reservation?.operation,
      checkpointSourceHash: checkpoint.allowance?.reservation?.sourceHash,
      consumedAdditionalCalls: allowance.consumedAdditionalCalls,
      maxActiveTimeMs: allowance.maxActiveTimeMs,
      maxAdditionalCalls: allowance.maxAdditionalCalls,
      reservation: allowance.reservation,
    }).toStrictEqual({
      activeTimeIsNonnegative: true,
      checkpointCallCount: 0,
      checkpointCompactionHash: expectedHash,
      checkpointCompactionStatus: "reserved",
      checkpointOperation: "compact_text",
      checkpointSourceHash: expectedHash,
      consumedAdditionalCalls: 1,
      maxActiveTimeMs: 120_000,
      maxAdditionalCalls: 6,
      reservation: null,
    });
  });

  it("keeps a fitting request on the ordinary one-call path", async () => {
    const model = fakeModel();
    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {
            constraints: [],
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
          raw: new AIMessage("structured response"),
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
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
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage("Look up Harry Kane.")] },
        { configurable: { thread_id: "small-request-no-compaction" } }
      )
    );

    const { allowance } = result.contextProcessing;

    if (allowance === null) {
      throw new Error("The request allowance was not initialized.");
    }

    expect({
      compaction: result.contextProcessing.compaction,
      consumedAdditionalCalls: allowance.consumedAdditionalCalls,
      modelInputCount: modelPayloads.length,
      outcome: result.outcome?.status,
      requestKind: result.request.kind,
    }).toStrictEqual({
      compaction: null,
      consumedAdditionalCalls: 0,
      modelInputCount: 1,
      outcome: "identity_data_unavailable",
      requestKind: "player_lookup",
    });
    expect(allowance.reservation).toBeNull();
  });

  it("rejects a draft that omits supported numeric, exclusion, and position constraints", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane for 2025/26, excluding Erling Haaland at stc. ${filler}`;
    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {
            ambiguities: [],
            anchors: [{ kind: "participant", text: "Harry Kane" }],
            constraints: [],
            instruction: "Look up Harry Kane.",
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
            references: [
              {
                ...anchorAt(original, "Harry Kane"),
                anchorIndex: 0,
              },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage(original)] },
        { configurable: { thread_id: "invalid-compaction-reference" } }
      )
    );

    const { allowance } = result.contextProcessing;
    const lastAssistantMessage = result.messages.at(-1)?.content;

    if (allowance === null) {
      throw new Error("The compaction allowance was not initialized.");
    }

    expect({
      compactionStatus: result.contextProcessing.compaction?.status,
      inputCount: modelPayloads.length,
      originalMessage: result.messages[0]?.content,
      requestKind: result.request.kind,
    }).toStrictEqual({
      compactionStatus: "failed",
      inputCount: 1,
      originalMessage: original,
      requestKind: "other",
    });
    expect(allowance.consumedAdditionalCalls).toBe(1);
    expect(allowance.reservation).toBeNull();
    expect(lastAssistantMessage).toContain("无法安全压缩");
  });

  it("leaves oversized text pending for bounded chunk processing", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(1100);
    const original = `Look up Harry Kane. ${filler}`;
    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {},
          raw: new AIMessage("unexpected response"),
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage(original)] },
        { configurable: { thread_id: "text-needs-chunking" } }
      )
    );

    const { allowance } = result.contextProcessing;
    const lastAssistantMessage = result.messages.at(-1)?.content;

    if (allowance === null) {
      throw new Error("The compaction allowance was not initialized.");
    }

    expect({
      compactionStatus: result.contextProcessing.compaction?.status,
      inputCount: modelPayloads.length,
      originalMessage: result.messages[0]?.content,
      progress: result.contextProcessing.compaction?.progress,
    }).toStrictEqual({
      compactionStatus: "needs_chunking",
      inputCount: 0,
      originalMessage: original,
      progress: { end: original.length, start: 0 },
    });
    expect(allowance.consumedAdditionalCalls).toBe(0);
    expect(allowance.reservation).toBeNull();
    expect(lastAssistantMessage).toContain("拆分或缩短");
  });
});
