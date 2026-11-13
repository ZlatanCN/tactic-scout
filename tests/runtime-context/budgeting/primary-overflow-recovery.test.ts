import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { contextProcessingHash } from "../../../src/context-processing-state.js";
import { AgentState } from "../../../src/state.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";

const scoutingAnchor = { kind: "participant", text: "Harry Kane" };

describe("primary model provider overflow recovery", () => {
  it("shrinks the message again when the reduced request still overflows", async () => {
    const original =
      `Look up Harry Kane. ${"Background detail. ".repeat(140)}`.trimEnd();

    const chunkOperations: string[] = [];
    const chunkRangeLengthsByPass: number[][] = [[], []];
    let understandingCalls = 0;
    let compactionPass = 0;
    const model = fakeModel();

    textCompactionTest.mockDeterministicTokenCount(model);

    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        const messages = Array.isArray(input) ? input : [];

        const humanMessage = messages.find(
          (message) => message instanceof HumanMessage
        );

        const payload = z
          .looseObject({
            chunks: z.array(z.unknown()).optional(),
            message: z.string().optional(),
            operation: z.string().optional(),
            range: z.object({ end: z.number(), start: z.number() }).optional(),
          })
          .parse(JSON.parse(z.string().parse(humanMessage?.content)));

        if (payload.operation === "extract_text_chunk") {
          chunkOperations.push(payload.operation);
          const { range } = payload;

          if (range !== undefined) {
            chunkRangeLengthsByPass[compactionPass - 1]?.push(
              range.end - range.start
            );
          }

          const chunkText = z.string().parse(payload.message);

          const anchors = chunkText.includes(scoutingAnchor.text)
            ? [scoutingAnchor]
            : [];

          return {
            parsed: {
              ambiguities: [],
              anchors,
              instruction:
                anchors.map(({ text }) => text).join("; ") || "No constraints.",
              references: anchors.map(({ text }, anchorIndex) => {
                const start = chunkText.indexOf(text);

                return { anchorIndex, end: start + text.length, start, text };
              }),
            },
            raw: new AIMessage("chunk extracted"),
          };
        }

        if (payload.operation === "merge_text_chunks") {
          chunkOperations.push(payload.operation);

          const chunks = z
            .array(
              z.object({
                anchors: z.array(
                  z.object({ kind: z.string(), text: z.string() })
                ),
                references: z.array(
                  z.object({
                    end: z.number(),
                    start: z.number(),
                    text: z.string(),
                  })
                ),
              })
            )
            .parse(payload.chunks);

          const anchors = chunks.flatMap((chunk) => chunk.anchors);

          return {
            parsed: {
              ambiguities: [],
              anchors,
              instruction: `Look up ${anchors.map(({ text }) => text).join(" and ")}.`,
              references: chunks.flatMap((chunk) =>
                chunk.references.map((reference) => ({
                  ...reference,
                  anchorIndex: anchors.findIndex(
                    ({ text }) => text === reference.text
                  ),
                }))
              ),
            },
            raw: new AIMessage("chunks merged"),
          };
        }

        understandingCalls += 1;

        if (understandingCalls === 1) {
          compactionPass = 1;
          throw Object.assign(
            new Error("The request exceeds the maximum context length."),
            { code: "context_length_exceeded", status: 400 }
          );
        }

        if (understandingCalls === 2) {
          compactionPass = 2;
          throw Object.assign(
            new Error("The request exceeds the maximum context length."),
            { code: "context_length_exceeded", status: 400 }
          );
        }

        return {
          parsed: { constraints: [], kind: "other", players: [], teams: [] },
          raw: new AIMessage("request understood"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 20 },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 10_000,
        maxOutputTokens: 256,
        softTriggerFraction: 0.99,
        targetFraction: 0.6,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        {
          messages: [
            new HumanMessage({ content: original, id: "understand-overflow" }),
          ],
        },
        { configurable: { thread_id: "primary-overflow-understanding" } }
      )
    );

    const maxChunkRangeLengthByPass = chunkRangeLengthsByPass.map((lengths) =>
      Math.max(...lengths)
    );

    expect({
      activeTimeWithinAllowance:
        (result.contextProcessing.allowance?.consumedActiveTimeMs ?? 0) <=
        (result.contextProcessing.allowance?.maxActiveTimeMs ?? 0),
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      chunkRangeShrank:
        maxChunkRangeLengthByPass[1] !== undefined &&
        maxChunkRangeLengthByPass[0] !== undefined &&
        maxChunkRangeLengthByPass[1] < maxChunkRangeLengthByPass[0],
      compactionPasses: chunkRangeLengthsByPass.map(
        (ranges) => ranges.length > 0
      ),
      compactionStatus: result.contextProcessing.compaction?.status,
      compactionStopReason: result.contextProcessing.compaction?.stopReason,
      mergeCalls: chunkOperations.filter(
        (operation) => operation === "merge_text_chunks"
      ).length,
      recovery: result.providerOverflowRecovery,
      recoveryTimeReservation:
        result.contextProcessing.allowance?.reservedActiveTimeMs,
      understandingCalls,
    }).toStrictEqual({
      activeTimeWithinAllowance: true,
      allowanceCalls: 8,
      chunkRangeShrank: true,
      compactionPasses: [true, true],
      compactionStatus: "ready",
      compactionStopReason: null,
      mergeCalls: 2,
      recovery: {
        attempts: 2,
        node: "understand_request",
        operationRequestsUsed: 3,
        primaryRequestReserved: false,
        recoveryAllowanceCallsReserved: 0,
        recoveryAllowanceOpen: false,
        reservedActiveTimeMs: 0,
        runId: null,
        sourceHash: contextProcessingHash(original),
        sourceRequestId: "message:understand-overflow",
      },
      recoveryTimeReservation: 0,
      understandingCalls: 3,
    });
  });
});
