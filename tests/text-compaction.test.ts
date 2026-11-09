import { createHash } from "node:crypto";
import { setImmediate as yieldNow } from "node:timers/promises";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { AgentState, createInitialConversationContext } from "../src/state.js";
import { testModelOutputLimitAdapter } from "./fixtures/model-context.js";

type AgentStateType = ReturnType<typeof AgentState.parse>;

type ContextProcessingState = AgentStateType["contextProcessing"];

type ReferenceCandidate =
  AgentStateType["conversationContext"]["playerAliases"][number]["reference"]["candidate"];

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

const knownKaneCandidate = {
  candidateId: "reep:kane",
  canonicalIdentityId: "canonical-kane",
  exactNameMatch: true,
  identityBasis: "reep_registry",
  identityVerified: true,
  name: "Harry Kane",
  records: [
    {
      canonicalIdentityId: "canonical-kane",
      competition: null,
      identityVerified: true,
      name: "Harry Kane",
      provider: "fm",
      season: null,
      sourceId: "kane-fm",
      team: null,
    },
  ],
} satisfies ReferenceCandidate;

describe("automatic text compaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    let fakeNow = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      fakeNow += 10;

      return fakeNow;
    });

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
      preflightTimeCharged:
        (checkpoint.allowance?.consumedActiveTimeMs ?? 0) > 0,
      requestKind: result.request.kind,
      requestPlayer: result.request.players[0]?.mention,
    }).toStrictEqual({
      compactedInstruction: instruction,
      compactedSourceHash: expectedHash,
      modelInputCount: 2,
      originalMessage: original,
      originalTextAbsentFromBusinessRequest: true,
      outcome: "identity_data_unavailable",
      preflightTimeCharged: true,
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

  it("resumes an unprocessed request from its cached compaction checkpoint", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane. ${filler}`;
    const instruction = "Look up Harry Kane.";
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
            instruction,
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
              { anchorIndex: 0, ...anchorAt(original, "Harry Kane") },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const checkpointer = new MemorySaver();

    const options = {
      checkpointer,
      model,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerIdentityLookup: (mention: string) => ({
        candidateCount: 0,
        candidates: [],
        candidatesTruncated: false,
        canonicalIdentityId: null,
        clarificationMessage: null,
        mention,
        selectedCandidateId: null,
        selectedName: null,
        status: "data_unavailable" as const,
      }),
      store: null,
      tools: [],
    };

    const graph = createAgent(options);

    const graphConfig = {
      configurable: { thread_id: "resume-cached-compaction" },
    };

    await graph.invoke({ messages: [new HumanMessage(original)] }, graphConfig);

    const graphConfigSchema = z.looseObject({
      configurable: z.looseObject({
        checkpoint_id: z.string().optional(),
        thread_id: z.string(),
      }),
    });

    let cachedCheckpointConfig: z.output<typeof graphConfigSchema> | null =
      null;

    for await (const snapshot of graph.getStateHistory(graphConfig)) {
      const checkpointState = AgentState.parse(snapshot.values);

      const hasPendingRequest =
        checkpointState.request.processedMessageId === null;

      const hasCompaction =
        checkpointState.contextProcessing.compaction?.status === "ready";

      if (
        snapshot.next.includes("understand_request") &&
        hasCompaction &&
        hasPendingRequest
      ) {
        cachedCheckpointConfig = graphConfigSchema.parse(snapshot.config);
        break;
      }
    }

    if (cachedCheckpointConfig === null) {
      throw new Error("No unprocessed cached compaction checkpoint was found.");
    }

    const resumedGraph = createAgent(options);

    const resumed = AgentState.parse(
      await resumedGraph.invoke({ messages: [] }, cachedCheckpointConfig)
    );

    const resumedModelInput = JSON.stringify(modelPayloads.at(-1));

    expect({
      allowanceCalls:
        resumed.contextProcessing.allowance?.consumedAdditionalCalls,
      compactedInstructionInModelInput:
        resumedModelInput.includes("compactedScoutingInstruction") &&
        resumedModelInput.includes(instruction),
      modelCallCount: modelPayloads.length,
      originalTextInModelInput: resumedModelInput.includes(filler),
      requestKind: resumed.request.kind,
      requestPlayer: resumed.request.players[0]?.mention,
    }).toStrictEqual({
      allowanceCalls: 1,
      compactedInstructionInModelInput: true,
      modelCallCount: 3,
      originalTextInModelInput: false,
      requestKind: "player_lookup",
      requestPlayer: "Harry Kane",
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
      consumedActiveTimeMs: allowance.consumedActiveTimeMs,
      consumedAdditionalCalls: allowance.consumedAdditionalCalls,
      modelInputCount: modelPayloads.length,
      outcome: result.outcome?.status,
      requestKind: result.request.kind,
    }).toStrictEqual({
      compaction: null,
      consumedActiveTimeMs: 0,
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

  it("requires a current-turn confirmed alias to appear in the compacted instruction", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Kane. ${filler}`;
    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {
            ambiguities: [],
            anchors: [{ kind: "other", text: "Look" }],
            instruction: "Look up the previously confirmed player.",
            references: [{ anchorIndex: 0, ...anchorAt(original, "Look") }],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const conversationContext: AgentStateType["conversationContext"] = {
      ...createInitialConversationContext(),
      playerAliases: [
        {
          mention: "Kane",
          reference: { candidate: knownKaneCandidate, referenceId: "kane-ref" },
        },
      ],
    };

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
        {
          conversationContext,
          messages: [new HumanMessage(original)],
        },
        { configurable: { thread_id: "required-current-alias-anchor" } }
      )
    );

    expect({
      compactionStatus: result.contextProcessing.compaction?.status,
      modelCalls: modelPayloads.length,
      requestKind: result.request.kind,
    }).toStrictEqual({
      compactionStatus: "failed",
      modelCalls: 1,
      requestKind: "other",
    });
    expect(result.messages.at(-1)?.content).toContain("无法安全压缩");
  });

  it("charges preflight time and stops before the auxiliary call when it exhausts the grant", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane. ${filler}`;
    const modelPayloads: unknown[] = [];
    let fakeNow = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      fakeNow += 10;

      return fakeNow;
    });
    mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return { parsed: {}, raw: new AIMessage("unused") };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: {
        maxActiveTimeMs: 5,
        maxAdditionalCalls: 6,
      },
      model,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage(original)] },
        { configurable: { thread_id: "preflight-allowance-exhaustion" } }
      )
    );

    const { allowance } = result.contextProcessing;

    if (allowance === null) {
      throw new Error("The compaction allowance was not initialized.");
    }

    expect({
      activeTimeMs: allowance.consumedActiveTimeMs,
      additionalCalls: allowance.consumedAdditionalCalls,
      compactionStatus: result.contextProcessing.compaction?.status,
      modelCalls: modelPayloads.length,
      reservation: allowance.reservation,
    }).toStrictEqual({
      activeTimeMs: 5,
      additionalCalls: 0,
      compactionStatus: "allowance_exhausted",
      modelCalls: 0,
      reservation: null,
    });
  });

  it("settles an unknown reserved compaction from checkpoint without retrying it", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane. ${filler}`;
    const instruction = "Look up Harry Kane.";
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
            instruction,
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
              { anchorIndex: 0, ...anchorAt(original, "Harry Kane") },
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

    const graphConfig = {
      configurable: { thread_id: "unknown-compaction-reservation" },
    };

    const completed = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage(original)] },
        graphConfig
      )
    );

    const priorAllowance = completed.contextProcessing.allowance;
    const priorCompaction = completed.contextProcessing.compaction;

    if (priorAllowance === null || priorCompaction === null) {
      throw new Error("The completed compaction checkpoint is missing.");
    }

    const reservationTimeMs = 5000;
    await graph.updateState(graphConfig, {
      contextProcessing: {
        allowance: {
          ...priorAllowance,
          reservation: {
            maxActiveTimeMs: reservationTimeMs,
            operation: "compact_text",
            operationId: "simulated-inflight-compaction",
            sourceHash: priorCompaction.sourceHash,
            sourceMessageId: priorCompaction.sourceMessageId,
          },
        },
        compaction: {
          ...priorCompaction,
          anchors: [],
          instruction: null,
          instructionHash: null,
          outputTokenEstimate: null,
          references: [],
          status: "reserved",
          stopReason: null,
        },
      },
    });
    const modelCallsBeforeRecovery = modelPayloads.length;

    const recovered = AgentState.parse(
      await graph.invoke({ messages: [] }, graphConfig)
    );

    const recoveredAllowance = recovered.contextProcessing.allowance;

    if (recoveredAllowance === null) {
      throw new Error("The recovered context allowance is missing.");
    }

    expect({
      activeTimeMs: recoveredAllowance.consumedActiveTimeMs,
      additionalCalls: recoveredAllowance.consumedAdditionalCalls,
      compactionStatus: recovered.contextProcessing.compaction?.status,
      modelCalls: modelPayloads.length,
      reservation: recoveredAllowance.reservation,
      stopReason: recovered.contextProcessing.compaction?.stopReason,
    }).toStrictEqual({
      activeTimeMs: priorAllowance.consumedActiveTimeMs + reservationTimeMs,
      additionalCalls: priorAllowance.consumedAdditionalCalls + 1,
      compactionStatus: "unknown",
      modelCalls: modelCallsBeforeRecovery,
      reservation: null,
      stopReason: "reservation_unknown",
    });
    expect(recovered.messages.at(-1)?.content).toContain("无法确认");
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
