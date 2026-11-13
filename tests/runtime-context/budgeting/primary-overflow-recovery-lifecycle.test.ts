import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import {
  contextProcessingHash,
  contextProcessingRequestId,
} from "../../../src/context-processing-state.js";
import { AgentState } from "../../../src/state.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";

describe("primary overflow recovery lifecycle", () => {
  it("settles an unknown in-flight reservation after a run boundary", async () => {
    const sourceText = "Look up Harry Kane.";
    const messageId = "unknown-overflow-completion";
    const message = new HumanMessage({ content: sourceText, id: messageId });
    const sourceHash = contextProcessingHash(sourceText);

    const sourceRequestId = contextProcessingRequestId(
      message.id,
      sourceText,
      1
    );

    let requestCalls = 0;
    const model = fakeModel();

    textCompactionTest.mockDeterministicTokenCount(model);

    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from(() => {
        requestCalls += 1;

        return {
          parsed: { constraints: [], kind: "other", players: [], teams: [] },
          raw: new AIMessage("request understood"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: {
        maxActiveTimeMs: 120_000,
        maxAdditionalCalls: 6,
      },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 10_000,
        maxOutputTokens: 256,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        {
          contextProcessing: {
            allowance: {
              consumedActiveTimeMs: 5000,
              consumedAdditionalCalls: 6,
              maxActiveTimeMs: 120_000,
              maxAdditionalCalls: 6,
              requestId: sourceRequestId,
              reservation: null,
              reservedActiveTimeMs: 1000,
            },
            clarification: null,
            compaction: null,
          },
          messages: [message],
          providerOverflowRecovery: {
            attempts: 1,
            node: "understand_request",
            operationRequestsUsed: 1,
            primaryRequestReserved: true,
            recoveryAllowanceCallsReserved: 2,
            recoveryAllowanceOpen: true,
            reservedActiveTimeMs: 1000,
            runId: "previous-process-run",
            sourceHash,
            sourceRequestId,
          },
        },
        {
          configurable: { thread_id: "primary-overflow-restarted-run" },
          runId: "current-process-run",
        }
      )
    );

    expect({
      consumedActiveTimeMs:
        result.contextProcessing.allowance?.consumedActiveTimeMs,
      consumedAdditionalCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      primaryRequestReserved:
        result.providerOverflowRecovery?.primaryRequestReserved,
      providerRecoveryOpen:
        result.providerOverflowRecovery?.recoveryAllowanceOpen,
      providerRecoveryTimeReservation:
        result.providerOverflowRecovery?.reservedActiveTimeMs,
      requestCalls,
      reservedActiveTimeMs:
        result.contextProcessing.allowance?.reservedActiveTimeMs,
    }).toStrictEqual({
      consumedActiveTimeMs: 6000,
      consumedAdditionalCalls: 6,
      primaryRequestReserved: false,
      providerRecoveryOpen: false,
      providerRecoveryTimeReservation: 0,
      requestCalls: 0,
      reservedActiveTimeMs: 0,
    });
  });

  it("resumes compaction across a run boundary before reserving the primary retry", async () => {
    const sourceText = `Look up Harry Kane. ${"Background detail. ".repeat(20)}`;
    const messageId = "pending-overflow-compaction-resume";
    const sourceHash = contextProcessingHash(sourceText);

    const sourceRequestId = contextProcessingRequestId(
      messageId,
      sourceText,
      1
    );

    const chunkOperations: string[] = [];
    let understandingCalls = 0;
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
          })
          .parse(JSON.parse(z.string().parse(humanMessage?.content)));

        if (payload.operation === "extract_text_chunk") {
          chunkOperations.push(payload.operation);
          const chunkText = z.string().parse(payload.message);

          const anchors = chunkText.includes("Harry Kane")
            ? [{ kind: "participant", text: "Harry Kane" }]
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

        return {
          parsed: { constraints: [], kind: "other", players: [], teams: [] },
          raw: new AIMessage("request understood"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 6 },
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
          contextProcessing: {
            allowance: {
              consumedActiveTimeMs: 1000,
              consumedAdditionalCalls: 2,
              maxActiveTimeMs: 120_000,
              maxAdditionalCalls: 6,
              requestId: sourceRequestId,
              reservation: null,
              reservedActiveTimeMs: 1000,
            },
            clarification: null,
            compaction: null,
          },
          messages: [{ content: sourceText, id: messageId, type: "human" }],
          providerOverflowRecovery: {
            attempts: 1,
            node: "understand_request",
            operationRequestsUsed: 1,
            primaryRequestReserved: false,
            recoveryAllowanceCallsReserved: 2,
            recoveryAllowanceOpen: true,
            reservedActiveTimeMs: 1000,
            runId: "previous-process-run",
            sourceHash,
            sourceRequestId,
          },
        },
        {
          configurable: { thread_id: "pending-overflow-compaction-resume" },
        }
      )
    );

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      chunkOperations,
      compactionStatus: result.contextProcessing.compaction?.status,
      primaryRequestReserved:
        result.providerOverflowRecovery?.primaryRequestReserved,
      recoveryOpen: result.providerOverflowRecovery?.recoveryAllowanceOpen,
      recoveryRunId: result.providerOverflowRecovery?.runId,
      understandingCalls,
    }).toStrictEqual({
      allowanceCalls: 5,
      chunkOperations: [
        "extract_text_chunk",
        "extract_text_chunk",
        "extract_text_chunk",
        "merge_text_chunks",
      ],
      compactionStatus: "ready",
      primaryRequestReserved: false,
      recoveryOpen: false,
      recoveryRunId: null,
      understandingCalls: 1,
    });
  });

  it("does not spend an old recovery grant on a different source message", async () => {
    const previousText = "Look up Harry Kane.";
    const previousMessageId = "previous-overflow-message";
    const currentText = "Look up Erling Haaland.";
    const currentMessageId = "new-request-message";

    const previousRequestId = contextProcessingRequestId(
      previousMessageId,
      previousText,
      1
    );

    const previousHash = contextProcessingHash(previousText);
    let requestCalls = 0;
    const model = fakeModel();

    textCompactionTest.mockDeterministicTokenCount(model);

    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from(() => {
        requestCalls += 1;

        return {
          parsed: { constraints: [], kind: "other", players: [], teams: [] },
          raw: new AIMessage("request understood"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 6 },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 10_000,
        maxOutputTokens: 256,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        {
          contextProcessing: {
            allowance: {
              consumedActiveTimeMs: 1000,
              consumedAdditionalCalls: 6,
              maxActiveTimeMs: 120_000,
              maxAdditionalCalls: 6,
              requestId: previousRequestId,
              reservation: null,
              reservedActiveTimeMs: 1000,
            },
            clarification: null,
            compaction: null,
          },
          messages: [
            new HumanMessage({ content: currentText, id: currentMessageId }),
          ],
          providerOverflowRecovery: {
            attempts: 1,
            node: "understand_request",
            operationRequestsUsed: 1,
            primaryRequestReserved: false,
            recoveryAllowanceCallsReserved: 2,
            recoveryAllowanceOpen: true,
            reservedActiveTimeMs: 1000,
            runId: null,
            sourceHash: previousHash,
            sourceRequestId: previousRequestId,
          },
        },
        {
          configurable: { thread_id: "primary-overflow-source-mismatch" },
        }
      )
    );

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      allowanceRequestId: result.contextProcessing.allowance?.requestId,
      providerRecovery: result.providerOverflowRecovery,
      requestCalls,
    }).toStrictEqual({
      allowanceCalls: 0,
      allowanceRequestId: `message:${currentMessageId}`,
      providerRecovery: null,
      requestCalls: 1,
    });
  });

  it("uses remaining active time as a hard cutoff for overflow recovery", async () => {
    let requestCalls = 0;
    const model = fakeModel();

    textCompactionTest.mockDeterministicTokenCount(model);

    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from(() => {
        requestCalls += 1;

        throw Object.assign(
          new Error("The request exceeds the maximum context length."),
          { code: "context_length_exceeded", status: 400 }
        );
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: {
        maxActiveTimeMs: 5000,
        maxAdditionalCalls: 6,
      },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 10_000,
        maxOutputTokens: 256,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        {
          messages: [
            new HumanMessage({
              content: "Look up Harry Kane.",
              id: "active-time-overflow-cutoff",
            }),
          ],
        },
        { configurable: { thread_id: "active-time-overflow-cutoff" } }
      )
    );

    expect({
      activeTimeWithinAllowance:
        (result.contextProcessing.allowance?.consumedActiveTimeMs ?? 0) <=
        (result.contextProcessing.allowance?.maxActiveTimeMs ?? 0),
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      compactionStatus: result.contextProcessing.compaction?.status,
      recoveryOpen: result.providerOverflowRecovery?.recoveryAllowanceOpen,
      recoveryTimeReservation:
        result.contextProcessing.allowance?.reservedActiveTimeMs,
      requestCalls,
    }).toStrictEqual({
      activeTimeWithinAllowance: true,
      allowanceCalls: 0,
      compactionStatus: "allowance_exhausted",
      recoveryOpen: false,
      recoveryTimeReservation: 0,
      requestCalls: 1,
    });
  });
});
