import { createHash } from "node:crypto";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
} from "../../../src/state.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";

describe("automatic input compaction and chunking", () => {
  it("preserves processed chunk progress and stops before understanding when the allowance runs out", async () => {
    const filler = "Background note with no scouting constraint. ".repeat(1000);
    const original = `Look up Harry Kane. ${filler}`;

    const priorLookup = {
      player: {
        candidate: textCompactionTest.knownKaneCandidate,
        referenceId: "prior-kane",
      },
      resultJson: "previous-success-snapshot",
    };

    const structuredOperations: string[] = [];
    const model = fakeModel();
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        const humanMessage = Array.isArray(input)
          ? input.find((message) => message instanceof HumanMessage)
          : undefined;

        const humanContent = z.string().parse(humanMessage?.content);

        const payload = z
          .looseObject({
            message: z.string().optional(),
            operation: z.string(),
          })
          .parse(JSON.parse(humanContent));

        structuredOperations.push(payload.operation);

        const source = payload.message ?? "";
        const participantStart = source.indexOf("Harry Kane");

        return {
          parsed: {
            ambiguities: [],
            anchors:
              participantStart === -1
                ? []
                : [{ kind: "participant", text: "Harry Kane" }],
            instruction:
              participantStart === -1
                ? "No scouting constraints in this fragment."
                : "Look up Harry Kane.",
            references:
              participantStart === -1
                ? []
                : [
                    {
                      anchorIndex: 0,
                      end: participantStart + "Harry Kane".length,
                      start: participantStart,
                      text: "Harry Kane",
                    },
                  ],
          },
          raw: new AIMessage("chunk extraction"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 1 },
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        {
          conversationContext: {
            ...createInitialConversationContext(),
            activeLookup: priorLookup,
          },
          messages: [
            new HumanMessage({ content: original, id: "quota-chunk" }),
          ],
          stateSchemaVersion: agentStateSchemaVersion,
        },
        { configurable: { thread_id: "chunk-quota-progress" } }
      )
    );

    const chunking = result.contextProcessing.compaction?.chunking;
    const currentInstruction = result.messages.at(-1)?.content;

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      chunkStatus: chunking?.chunks[0]?.status,
      nextStartIsBeforeEnd:
        (chunking?.nextStart ?? original.length) < original.length,
      originalLength: original.length,
      originalMessagePreserved: result.messages[0]?.content === original,
      outcome: result.outcome,
      priorSnapshotPreserved:
        result.conversationContext.activeLookup?.resultJson ===
        priorLookup.resultJson,
      processedCalls: structuredOperations,
      status: result.contextProcessing.compaction?.status,
      stopAnswer: currentInstruction,
      stopReason: result.contextProcessing.compaction?.stopReason,
    }).toStrictEqual({
      allowanceCalls: 1,
      chunkStatus: "ready",
      nextStartIsBeforeEnd: true,
      originalLength: original.length,
      originalMessagePreserved: true,
      outcome: null,
      priorSnapshotPreserved: true,
      processedCalls: ["extract_text_chunk"],
      status: "allowance_exhausted",
      stopAnswer:
        "本请求的自动上下文处理额度已用完，原文和处理进度仍保留。请明确要求继续后再追加额度。",
      stopReason: "allowance_exhausted",
    });
  });

  it("rebuilds chunking when a persisted chunk source hash is stale", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(1000);
    const original = `Look up Harry Kane. ${filler}`;
    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        const humanMessage = Array.isArray(input)
          ? input.find((message) => message instanceof HumanMessage)
          : undefined;

        const payload = z
          .looseObject({ message: z.string().optional() })
          .parse(JSON.parse(z.string().parse(humanMessage?.content)));

        const chunkText = payload.message ?? "";
        const start = chunkText.indexOf("Harry Kane");

        return {
          parsed: {
            ambiguities: [],
            anchors:
              start === -1 ? [] : [{ kind: "participant", text: "Harry Kane" }],
            instruction:
              start === -1
                ? "No scouting constraints in this fragment."
                : "Harry Kane",
            references:
              start === -1
                ? []
                : [
                    {
                      anchorIndex: 0,
                      end: start + "Harry Kane".length,
                      start,
                      text: "Harry Kane",
                    },
                  ],
          },
          raw: new AIMessage("chunk extraction"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 1 },
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const config = {
      configurable: { thread_id: "stale-chunk-hash" },
    };

    const partiallyProcessed = AgentState.parse(
      await graph.invoke(
        {
          messages: [
            new HumanMessage({ content: original, id: "stale-chunk-hash" }),
          ],
        },
        config
      )
    );

    const { compaction } = partiallyProcessed.contextProcessing;
    const chunking = compaction?.chunking;

    if (compaction === null || chunking === null || chunking === undefined) {
      throw new Error("The partial chunking checkpoint is missing.");
    }

    await graph.updateState(config, {
      contextProcessing: {
        ...partiallyProcessed.contextProcessing,
        compaction: {
          ...compaction,
          chunking: {
            ...chunking,
            chunks: chunking.chunks.map((chunk, index) =>
              index === 0 ? { ...chunk, sourceHash: "stale-chunk-hash" } : chunk
            ),
          },
        },
      },
    });

    const replayed = AgentState.parse(
      await graph.invoke({ messages: [] }, config)
    );

    expect({
      allowanceCalls:
        replayed.contextProcessing.allowance?.consumedAdditionalCalls,
      chunkCallCount: modelPayloads.length,
      chunkCount:
        replayed.contextProcessing.compaction?.chunking?.chunks.length,
      compactionStatus: replayed.contextProcessing.compaction?.status,
      nextStart: replayed.contextProcessing.compaction?.chunking?.nextStart,
      originalMessagePreserved: replayed.messages[0]?.content === original,
    }).toStrictEqual({
      allowanceCalls: 1,
      chunkCallCount: 1,
      chunkCount: 0,
      compactionStatus: "allowance_exhausted",
      nextStart: 0,
      originalMessagePreserved: true,
    });
  });

  it("preserves ready chunks when a later chunk reservation has unknown completion", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(1000);
    const original = `Look up Harry Kane. ${filler}`;
    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        const humanMessage = Array.isArray(input)
          ? input.find((message) => message instanceof HumanMessage)
          : undefined;

        const payload = z
          .looseObject({ message: z.string().optional() })
          .parse(JSON.parse(z.string().parse(humanMessage?.content)));

        const source = payload.message ?? "";
        const start = source.indexOf("Harry Kane");

        const anchors =
          start === -1 ? [] : [{ kind: "participant", text: "Harry Kane" }];

        return {
          parsed: {
            ambiguities: [],
            anchors,
            instruction:
              start === -1
                ? "No scouting constraints in this fragment."
                : "Harry Kane",
            references:
              start === -1
                ? []
                : [
                    {
                      anchorIndex: 0,
                      end: start + "Harry Kane".length,
                      start,
                      text: "Harry Kane",
                    },
                  ],
          },
          raw: new AIMessage("chunk extraction"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 1 },
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const config = {
      configurable: { thread_id: "unknown-later-chunk" },
    };

    const partial = AgentState.parse(
      await graph.invoke(
        {
          messages: [
            new HumanMessage({ content: original, id: "unknown-later-chunk" }),
          ],
        },
        config
      )
    );

    const { allowance, compaction } = partial.contextProcessing;
    const chunking = compaction?.chunking;

    if (allowance === null || compaction === null) {
      throw new Error(
        "The partial chunk allowance and compaction are missing."
      );
    }

    if (chunking === null || chunking === undefined) {
      throw new Error("A partial chunk progress checkpoint was not created.");
    }

    if (chunking.nextStart >= chunking.sourceLength) {
      throw new Error("The partial chunk plan has no remaining source text.");
    }

    const remainderStart = chunking.nextStart;
    const remainderText = original.slice(remainderStart);

    const reservedRemainder = {
      ambiguities: [],
      anchors: [],
      end: original.length,
      instruction: null,
      instructionTokenEstimate: null,
      references: [],
      sourceHash: createHash("sha256").update(remainderText).digest("hex"),
      start: remainderStart,
      status: "reserved" as const,
      targetTokenEstimate: 1,
    };

    const resumedChunking = {
      ...chunking,
      chunks: [...chunking.chunks, reservedRemainder],
      mergeStatus: "pending" as const,
      nextStart: original.length,
    };

    const reservationTimeMs = 1000;

    await graph.updateState(config, {
      contextProcessing: {
        ...partial.contextProcessing,
        allowance: {
          ...allowance,
          maxAdditionalCalls: 4,
          reservation: {
            chunkIndex: 1,
            maxActiveTimeMs: reservationTimeMs,
            operation: "compact_text_chunk",
            operationId: "unknown-later-chunk-reservation",
            sourceHash: compaction.sourceHash,
            sourceMessageId: compaction.sourceMessageId,
          },
        },
        compaction: {
          ...compaction,
          chunking: resumedChunking,
          progress: { end: original.length, start: remainderStart },
          status: "reserved",
          stopReason: null,
        },
      },
    });

    const recovered = AgentState.parse(
      await graph.invoke({ messages: [] }, config)
    );

    const recoveredAllowance = recovered.contextProcessing.allowance;
    const recoveredCompaction = recovered.contextProcessing.compaction;
    const recoveredChunking = recoveredCompaction?.chunking;

    expect({
      allowanceCalls: recoveredAllowance?.consumedAdditionalCalls,
      chunkCount: recoveredChunking?.chunks.length,
      chunkStatuses: recoveredChunking?.chunks.map(({ status }) => status),
      compactionStatus: recoveredCompaction?.status,
      modelCallCount: modelPayloads.length,
      nextStart: recoveredChunking?.nextStart,
      reservation: recoveredAllowance?.reservation,
      sourceMessagePreserved: recovered.messages[0]?.content === original,
    }).toStrictEqual({
      allowanceCalls: 2,
      chunkCount: 2,
      chunkStatuses: ["ready", "reserved"],
      compactionStatus: "unknown",
      modelCallCount: 1,
      nextStart: original.length,
      reservation: null,
      sourceMessagePreserved: true,
    });
  });
});
