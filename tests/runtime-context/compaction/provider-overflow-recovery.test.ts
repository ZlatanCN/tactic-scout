import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { AgentState } from "../../../src/state.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";

const scoutingAnchors = [
  { kind: "participant", text: "Harry Kane" },
  { kind: "season", text: "2025/26" },
];

const runAuxiliaryCompactionFailure = async (
  error: Error,
  threadId: string
) => {
  const original =
    `Look up Harry Kane for 2025/26. ${"Background detail. ".repeat(100)}`.trimEnd();

  let compactionCalls = 0;
  const model = fakeModel();

  textCompactionTest.mockDeterministicTokenCount(model);

  vi.spyOn(model, "withStructuredOutput").mockReturnValue(
    RunnableLambda.from(() => {
      compactionCalls += 1;

      throw error;
    })
  );

  const graph = textCompactionTest.createAgent({
    checkpointer: new MemorySaver(),
    contextProcessingAllowance: { maxAdditionalCalls: 4 },
    model,
    modelContextProfile: {
      countingMarginTokens: 64,
      maxInputTokens: 8500,
      maxOutputTokens: 256,
      softTriggerFraction: 0.05,
      targetFraction: 0.01,
    },
    modelOutputLimitAdapter: testModelOutputLimitAdapter,
    tools: [],
  });

  const result = AgentState.parse(
    await graph.invoke(
      {
        messages: [new HumanMessage({ content: original, id: threadId })],
      },
      { configurable: { thread_id: threadId } }
    )
  );

  return {
    allowanceCalls: result.contextProcessing.allowance?.consumedAdditionalCalls,
    answer: z.string().parse(result.messages.at(-1)?.content),
    compactionCalls,
    compactionStatus: result.contextProcessing.compaction?.status,
    compactionStopReason: result.contextProcessing.compaction?.stopReason,
    failureCategory: result.faultTolerance.failure?.category,
    failureNode: result.faultTolerance.failure?.node,
  };
};

const auxiliaryProviderFailureCases = [
  {
    answerText: "凭据",
    category: "authentication",
    createError: () =>
      Object.assign(new Error("Invalid API key."), { status: 401 }),
    name: "authentication",
  },
  {
    answerText: "额度",
    category: "quota",
    createError: () =>
      Object.assign(new Error("Quota exceeded."), {
        code: "insufficient_quota",
        status: 429,
      }),
    name: "quota",
  },
  {
    answerText: "配置无效",
    category: "configuration",
    createError: () =>
      Object.assign(new Error("Invalid request configuration."), {
        code: "invalid_request_error",
        status: 400,
      }),
    name: "configuration",
  },
  {
    answerText: "正在限流",
    category: "rate_limit",
    createError: () =>
      Object.assign(new Error("Rate limited."), {
        code: "rate_limit_exceeded",
        status: 429,
      }),
    name: "rate_limit",
  },
  {
    answerText: "暂时不可用",
    category: "server",
    createError: () =>
      Object.assign(new Error("Provider unavailable."), { status: 503 }),
    name: "server",
  },
  {
    answerText: "暂时不可用",
    category: "network",
    createError: () =>
      Object.assign(new Error("Connection reset."), { code: "ECONNRESET" }),
    name: "network",
  },
] as const;

describe("provider overflow during text compaction", () => {
  it("replans a rejected full instruction as bounded chunks before continuing", async () => {
    const original =
      `Look up Harry Kane for 2025/26. ${"Background detail. ".repeat(40)}`.trimEnd();

    const operations: string[] = [];
    const ranges: { end: number; start: number }[] = [];
    let rejectedChunk = false;
    const model = fakeModel();

    textCompactionTest.mockDeterministicTokenCount(model);

    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        const messages = Array.isArray(input) ? input : [];

        const humanMessage = messages.find(
          (message) => message instanceof HumanMessage
        );

        const content = z.string().parse(humanMessage?.content);

        const payload = z
          .looseObject({
            chunks: z.array(z.unknown()).optional(),
            message: z.string().optional(),
            operation: z.string().optional(),
            range: z.object({ end: z.number(), start: z.number() }).optional(),
          })
          .parse(JSON.parse(content));

        const { operation } = payload;

        if (operation !== undefined) {
          operations.push(operation);
        }

        if (operation === "extract_text_chunk") {
          ranges.push(
            z
              .object({ end: z.number(), start: z.number() })
              .parse(payload.range)
          );
        }

        if (operation === "compact_text") {
          throw Object.assign(
            new Error("The request exceeds the maximum context length."),
            { code: "context_length_exceeded", status: 400 }
          );
        }

        if (operation === "extract_text_chunk") {
          if (!rejectedChunk) {
            rejectedChunk = true;
            throw Object.assign(
              new Error("The request exceeds the maximum context length."),
              { code: "context_length_exceeded", status: 400 }
            );
          }

          const chunkText = z.string().parse(payload.message);

          const anchors = scoutingAnchors.filter(({ text }) =>
            chunkText.includes(text)
          );

          return {
            parsed: {
              ambiguities: [],
              anchors,
              instruction:
                anchors.map(({ text }) => text).join("; ") ||
                "This chunk adds no scouting constraints.",
              references: anchors.map(({ text }, anchorIndex) => {
                const start = chunkText.indexOf(text);

                return {
                  anchorIndex,
                  end: start + text.length,
                  start,
                  text,
                };
              }),
            },
            raw: new AIMessage("chunk extracted"),
          };
        }

        if (operation === "merge_text_chunks") {
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

          const anchors = scoutingAnchors.filter(({ text }) =>
            chunks.some((chunk) =>
              chunk.anchors.some((anchor) => anchor.text === text)
            )
          );

          return {
            parsed: {
              ambiguities: [],
              anchors,
              instruction: `Look up ${anchors.map(({ text }) => text).join(" for ")}.`,
              references: chunks.flatMap((chunk) =>
                chunk.references.flatMap((reference) => {
                  const anchorIndex = anchors.findIndex(
                    ({ text }) => text === reference.text
                  );

                  return anchorIndex === -1
                    ? []
                    : [{ ...reference, anchorIndex }];
                })
              ),
            },
            raw: new AIMessage("chunks merged"),
          };
        }

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
        softTriggerFraction: 0.05,
        targetFraction: 0.01,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerIdentityLookup: () => ({
        candidateCount: 0,
        candidates: [],
        candidatesTruncated: false,
        canonicalIdentityId: null,
        clarificationMessage: null,
        mention: "Harry Kane",
        selectedCandidateId: null,
        selectedName: null,
        status: "data_unavailable",
      }),
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        {
          messages: [
            new HumanMessage({ content: original, id: "overflow-text" }),
          ],
        },
        { configurable: { thread_id: "provider-overflow-text-compaction" } }
      )
    );

    const allowanceCalls =
      result.contextProcessing.allowance?.consumedAdditionalCalls ?? 0;

    expect({
      allowanceCalls,
      compactionStatus: result.contextProcessing.compaction?.status,
      compactionStopReason: result.contextProcessing.compaction?.stopReason,
      hasMerge: operations.includes("merge_text_chunks"),
      hasMultipleChunks:
        operations.filter((operation) => operation === "extract_text_chunk")
          .length > 1,
      invocations: operations,
      operations: operations[0],
      ranges,
    }).toStrictEqual({
      allowanceCalls: 6,
      compactionStatus: "ready",
      compactionStopReason: null,
      hasMerge: true,
      hasMultipleChunks: true,
      invocations: [
        "compact_text",
        "extract_text_chunk",
        "extract_text_chunk",
        "extract_text_chunk",
        "extract_text_chunk",
        "merge_text_chunks",
      ],
      operations: "compact_text",
      ranges: [
        { end: 582, start: 0 },
        { end: 278, start: 0 },
        { end: 582, start: 278 },
        { end: 791, start: 582 },
      ],
    });
  });

  it.each(auxiliaryProviderFailureCases)(
    "preserves $name classification when auxiliary compaction fails",
    async ({ answerText, category, createError, name }) => {
      const result = await runAuxiliaryCompactionFailure(
        createError(),
        `compact-${name}-failure`
      );

      expect({
        allowanceCalls: result.allowanceCalls,
        answerMentionsFailure: result.answer.includes(answerText),
        compactionCalls: result.compactionCalls,
        compactionStatus: result.compactionStatus,
        compactionStopReason: result.compactionStopReason,
        failureCategory: result.failureCategory,
        failureNode: result.failureNode,
      }).toStrictEqual({
        allowanceCalls: 1,
        answerMentionsFailure: true,
        compactionCalls: 1,
        compactionStatus: "failed",
        compactionStopReason: "provider_failure",
        failureCategory: category,
        failureNode: "understand_request",
      });
    }
  );
});
