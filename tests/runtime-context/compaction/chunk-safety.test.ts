import { setImmediate as yieldNow } from "node:timers/promises";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { AgentState } from "../../../src/state.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";

describe("chunk response and boundary safety", () => {
  it("fails safely when a chunk response is invalid and preserves the original message", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(1100);
    const original = `Look up Harry Kane. ${filler}`;
    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {},
          raw: new AIMessage("unexpected response"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
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
      chunkStatus:
        result.contextProcessing.compaction?.chunking?.chunks[0]?.status,
      compactionStatus: result.contextProcessing.compaction?.status,
      inputCount: modelPayloads.length,
      nextStart: result.contextProcessing.compaction?.chunking?.nextStart,
      originalMessagePreserved: result.messages[0]?.content === original,
      progress: result.contextProcessing.compaction?.progress,
    }).toStrictEqual({
      chunkStatus: "failed",
      compactionStatus: "failed",
      inputCount: 1,
      nextStart: original.length,
      originalMessagePreserved: true,
      progress: { end: 31_744, start: 0 },
    });
    expect(allowance.consumedAdditionalCalls).toBe(1);
    expect(allowance.reservation).toBeNull();
    expect(lastAssistantMessage).toContain("无法安全压缩");
  });

  it("does not split a required numeric span that cannot fit in one chunk", async () => {
    const model = fakeModel();
    const original = "9".repeat(40_000);
    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {
            ambiguities: [],
            anchors: [],
            instruction: "No scouting constraints in this fragment.",
            references: [],
          },
          raw: new AIMessage("unexpected chunk response"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        {
          messages: [
            new HumanMessage({ content: original, id: "long-number" }),
          ],
        },
        { configurable: { thread_id: "long-required-number" } }
      )
    );

    expect({
      compactionStatus: result.contextProcessing.compaction?.status,
      inputCount: modelPayloads.length,
      originalMessagePreserved: result.messages[0]?.content === original,
      progress: result.contextProcessing.compaction?.progress,
    }).toStrictEqual({
      compactionStatus: "needs_chunking",
      inputCount: 0,
      originalMessagePreserved: true,
      progress: { end: original.length, start: 0 },
    });
  });

  it("keeps chunk boundaries between UTF-16 surrogate pairs", async () => {
    const model = fakeModel();
    const firstChunkEnd = 31_808;

    const original = `${"x".repeat(firstChunkEnd - 1)}😀${"x".repeat(
      40_001 - firstChunkEnd - 1
    )}`;

    const chunkRanges: { end: number; start: number }[] = [];

    vi.spyOn(model, "getNumTokens").mockImplementation(async (input) => {
      const chunkEnd = textCompactionTest.chunkEndFromInput(input);

      if (chunkEnd !== null) {
        return chunkEnd <= firstChunkEnd ? 1 : 100_000;
      }

      const serializedInput = Array.isArray(input)
        ? (JSON.stringify(input) ?? "")
        : input;

      await yieldNow();

      return Math.ceil(serializedInput.length / 4);
    });
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        const humanMessage = Array.isArray(input)
          ? input.find((message) => message instanceof HumanMessage)
          : undefined;

        const payload = z
          .looseObject({
            range: z.object({ end: z.number(), start: z.number() }),
          })
          .parse(JSON.parse(z.string().parse(humanMessage?.content)));

        chunkRanges.push(payload.range);

        return {
          parsed: {
            ambiguities: [],
            anchors: [],
            instruction: "No scouting constraints in this fragment.",
            references: [],
          },
          raw: new AIMessage("empty chunk extraction"),
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
          messages: [
            new HumanMessage({ content: original, id: "unicode-chunk" }),
          ],
        },
        { configurable: { thread_id: "unicode-chunk-boundary" } }
      )
    );

    const [range] = chunkRanges;

    const sourceCodePointCount = textCompactionTest.codePointCount(original);

    const splitsSurrogatePair = (index: number): boolean => {
      if (index <= 0 || index >= original.length) {
        return false;
      }

      return (
        textCompactionTest.codePointCount(original.slice(0, index)) +
          textCompactionTest.codePointCount(original.slice(index)) >
        sourceCodePointCount
      );
    };

    expect({
      chunkCount: chunkRanges.length,
      compactionStatus: result.contextProcessing.compaction?.status,
      originalMessagePreserved: result.messages[0]?.content === original,
      range: range ?? null,
      splitsPair:
        range === undefined
          ? null
          : splitsSurrogatePair(range.start) || splitsSurrogatePair(range.end),
    }).toStrictEqual({
      chunkCount: 1,
      compactionStatus: "allowance_exhausted",
      originalMessagePreserved: true,
      range: range ?? null,
      splitsPair: false,
    });
  });
});
