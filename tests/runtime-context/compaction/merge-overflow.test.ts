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

type MergeFixtureChunk = {
  anchors: { kind: string; text: string }[];
  references: {
    anchorIndex: number;
    end: number;
    start: number;
    text: string;
  }[];
};

const chunksContainAnchor = (
  chunks: MergeFixtureChunk[],
  kind: string,
  text: string
): boolean => {
  for (const chunk of chunks) {
    for (const anchor of chunk.anchors) {
      if (anchor.kind === kind && anchor.text === text) {
        return true;
      }
    }
  }

  return false;
};

const anchorIndexForReference = (
  anchors: { kind: string; text: string }[],
  reference: { text: string }
): number => {
  for (const [index, anchor] of anchors.entries()) {
    if (anchor.text === reference.text) {
      return index;
    }
  }

  return -1;
};

const mergeReferencesFor = (
  chunks: MergeFixtureChunk[],
  anchors: { kind: string; text: string }[]
) => {
  const references: {
    anchorIndex: number;
    end: number;
    start: number;
    text: string;
  }[] = [];

  for (const chunk of chunks) {
    for (const reference of chunk.references) {
      const anchorIndex = anchorIndexForReference(anchors, reference);

      if (anchorIndex !== -1) {
        references.push({ ...reference, anchorIndex });
      }
    }
  }

  return references;
};

const runMergeOverflowScenario = async (
  shouldOverflowMerge: (chunkCount: number) => boolean
) => {
  const original =
    `Look up Harry Kane for 2025/26. ${"Background detail. ".repeat(1600)}`.trimEnd();

  const operations: string[] = [];
  const mergePayloadSizes: number[] = [];
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
          range: z.object({ end: z.number(), start: z.number() }).optional(),
        })
        .parse(JSON.parse(z.string().parse(humanMessage?.content)));

      if (payload.operation !== undefined) {
        operations.push(payload.operation);
      }

      if (payload.operation === "merge_text_chunks") {
        const chunks = z
          .array(
            z.object({
              anchors: z.array(
                z.object({ kind: z.string(), text: z.string() })
              ),
              references: z.array(
                z.object({
                  anchorIndex: z.number(),
                  end: z.number(),
                  start: z.number(),
                  text: z.string(),
                })
              ),
            })
          )
          .parse(payload.chunks);

        mergePayloadSizes.push(chunks.length);

        if (shouldOverflowMerge(chunks.length)) {
          throw Object.assign(
            new Error("The request exceeds the maximum context length."),
            { code: "context_length_exceeded", status: 400 }
          );
        }

        const anchors = scoutingAnchors.filter(({ kind, text }) =>
          chunksContainAnchor(chunks, kind, text)
        );

        return {
          parsed: {
            ambiguities: [],
            anchors,
            instruction:
              anchors.length === 0
                ? "No constraints."
                : anchors.map(({ text }) => text).join(" "),
            references: mergeReferencesFor(chunks, anchors),
          },
          raw: new AIMessage("merge complete"),
        };
      }

      if (payload.operation === "compact_text") {
        throw Object.assign(
          new Error("The request exceeds the maximum context length."),
          { code: "context_length_exceeded", status: 400 }
        );
      }

      if (payload.operation === "extract_text_chunk") {
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

      understandingCalls += 1;

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
      maxInputTokens: 3000,
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
        messages: [
          new HumanMessage({ content: original, id: "merge-overflow" }),
        ],
      },
      { configurable: { thread_id: "merge-provider-overflow" } }
    )
  );

  return {
    mergePayloadSizes,
    operations,
    original,
    result,
    understandingCalls,
  };
};

describe("provider overflow while merging text chunks", () => {
  it("replans an overflowing merge into smaller, resumable merge groups", async () => {
    const {
      mergePayloadSizes,
      operations,
      original,
      result,
      understandingCalls,
    } = await runMergeOverflowScenario((chunkCount) => chunkCount > 2);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      chunkCalls: operations.filter(
        (operation) => operation === "extract_text_chunk"
      ).length,
      compactionStatus: result.contextProcessing.compaction?.status,
      compactionStopReason: result.contextProcessing.compaction?.stopReason,
      mergePayloadSizes,
      originalMessagePresent: result.messages.some(
        ({ content, type }) => type === "human" && content === original
      ),
      understandingCalls,
    }).toStrictEqual({
      allowanceCalls: 8,
      chunkCalls: 4,
      compactionStatus: "ready",
      compactionStopReason: null,
      mergePayloadSizes: [4, 2, 2, 2],
      originalMessagePresent: true,
      understandingCalls: 1,
    });
  });

  it("stops after a smaller merge payload still overflows without progress", async () => {
    const {
      mergePayloadSizes,
      operations,
      original,
      result,
      understandingCalls,
    } = await runMergeOverflowScenario(() => true);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      chunkCalls: operations.filter(
        (operation) => operation === "extract_text_chunk"
      ).length,
      compactionStatus: result.contextProcessing.compaction?.status,
      compactionStopReason: result.contextProcessing.compaction?.stopReason,
      mergePayloadSizes,
      originalMessagePresent: result.messages.some(
        ({ content, type }) => type === "human" && content === original
      ),
      understandingCalls,
    }).toStrictEqual({
      allowanceCalls: 7,
      chunkCalls: 4,
      compactionStatus: "failed",
      compactionStopReason: "no_reduction",
      mergePayloadSizes: [4, 2, 1],
      originalMessagePresent: true,
      understandingCalls: 0,
    });
  });
});
