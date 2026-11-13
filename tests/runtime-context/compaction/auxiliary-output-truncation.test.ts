import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { AgentState } from "../../../src/state.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";

const anchors = [
  { kind: "participant", text: "Harry Kane" },
  { kind: "season", text: "2025/26" },
];

describe("auxiliary output truncation recovery", () => {
  it("discards a truncated summary and rebuilds the instruction from bounded chunks", async () => {
    const original =
      `Look up Harry Kane for 2025/26. ${"Background detail. ".repeat(40)}`.trimEnd();

    const operations: string[] = [];
    const loggedMessages: string[] = [];
    const model = fakeModel().respond(new AIMessage("The lookup was checked."));

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

        const { operation } = payload;

        if (operation !== undefined) {
          operations.push(operation);
        }

        if (operation === "compact_text") {
          const partialParsed = {
            ambiguities: [],
            anchors: [{ kind: "participant", text: "Harry Kane" }],
            instruction: "PARTIAL_TRUNCATED_SCOUTING_INSTRUCTION",
            references: [
              {
                anchorIndex: 0,
                end: 18,
                start: 8,
                text: "Harry Kane",
              },
            ],
          };

          return {
            parsed: partialParsed,
            raw: new AIMessage({
              content: "PARTIAL_TRUNCATED_SCOUTING_INSTRUCTION",
              response_metadata: { finish_reason: "length" },
              usage_metadata: {
                input_tokens: 101,
                output_tokens: 256,
                total_tokens: 357,
              },
            }),
          };
        }

        if (operation === "extract_text_chunk") {
          const chunkText = z.string().parse(payload.message);

          const chunkAnchors = anchors.filter(({ text }) =>
            chunkText.includes(text)
          );

          return {
            parsed: {
              ambiguities: [],
              anchors: chunkAnchors,
              instruction:
                chunkAnchors.map(({ text }) => text).join("; ") ||
                "This chunk adds no scouting constraints.",
              references: chunkAnchors.map(({ text }, anchorIndex) => {
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
                    anchorIndex: z.number(),
                    end: z.number(),
                    start: z.number(),
                    text: z.string(),
                  })
                ),
              })
            )
            .parse(payload.chunks);

          const mergedAnchors = anchors.filter(({ kind, text }) =>
            chunks.some((chunk) =>
              chunk.anchors.some(
                (anchor) => anchor.kind === kind && anchor.text === text
              )
            )
          );

          return {
            parsed: {
              ambiguities: [],
              anchors: mergedAnchors,
              instruction:
                mergedAnchors.length === 0
                  ? "No constraints."
                  : mergedAnchors.map(({ text }) => text).join(" "),
              references: chunks.flatMap((chunk) =>
                chunk.references.flatMap((reference) => {
                  const anchorIndex = mergedAnchors.findIndex(
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
            kind: "other",
            players: [],
            teams: [],
          },
          raw: new AIMessage("request understood"),
        };
      })
    );

    vi.spyOn(console, "info").mockImplementation((message) => {
      loggedMessages.push(String(message));
    });

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 10 },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 10_000,
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
            new HumanMessage({
              content: original,
              id: "auxiliary-output-truncated",
            }),
          ],
        },
        { configurable: { thread_id: "auxiliary-output-truncated" } }
      )
    );

    const answer = z.string().parse(result.messages.at(-1)?.content);

    const truncatedUsage = loggedMessages.filter(
      (message) =>
        message.includes('"type":"model_context_usage"') &&
        message.includes('"providerOutputTokens":256')
    );

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      compactionInstruction: result.contextProcessing.compaction?.instruction,
      compactionStatus: result.contextProcessing.compaction?.status,
      hasMerge: operations.includes("merge_text_chunks"),
      noPartialInstructionPublished:
        !answer.includes("PARTIAL_TRUNCATED_SCOUTING_INSTRUCTION") &&
        !JSON.stringify(result).includes(
          "PARTIAL_TRUNCATED_SCOUTING_INSTRUCTION"
        ),
      operations,
      truncatedUsageCount: truncatedUsage.length,
    }).toStrictEqual({
      allowanceCalls: 4,
      compactionInstruction: "Harry Kane 2025/26",
      compactionStatus: "ready",
      hasMerge: true,
      noPartialInstructionPublished: true,
      operations: [
        "compact_text",
        "extract_text_chunk",
        "extract_text_chunk",
        "merge_text_chunks",
      ],
      truncatedUsageCount: 1,
    });
  });
});
