import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { AgentState } from "../../../src/state.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";

describe("automatic input compaction and chunking", () => {
  it("rejects a merge that drops a chunk ambiguity before request understanding", async () => {
    const filler = "Background note with no scouting constraint. ".repeat(1000);
    const original = `Look up Harry Kane for 2024/25. ${filler}Team reference for him: Bayern Munich.`;
    const chunkAmbiguity = "本段代词“him”没有可见的先行对象";
    const operations: string[] = [];
    const model = fakeModel();
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        const humanMessage = Array.isArray(input)
          ? input.find((message) => message instanceof HumanMessage)
          : undefined;

        const payload = z
          .looseObject({
            message: z.string().optional(),
            operation: z.string().optional(),
          })
          .parse(JSON.parse(z.string().parse(humanMessage?.content)));

        operations.push(payload.operation ?? "understand_request");

        if (payload.operation === "merge_text_chunks") {
          return {
            parsed: {
              ambiguities: [],
              anchors: [
                { kind: "participant", text: "Harry Kane" },
                { kind: "season", text: "2024/25" },
                { kind: "team", text: "Bayern Munich" },
              ],
              instruction:
                "Look up Harry Kane for 2024/25 and include Bayern Munich.",
              references: [
                {
                  anchorIndex: 0,
                  ...textCompactionTest.anchorAt(original, "Harry Kane"),
                },
                {
                  anchorIndex: 1,
                  ...textCompactionTest.anchorAt(original, "2024/25"),
                },
                {
                  anchorIndex: 2,
                  ...textCompactionTest.anchorAt(original, "Bayern Munich"),
                },
              ],
            },
            raw: new AIMessage("merge omitted the local ambiguity"),
          };
        }

        if (payload.operation === undefined) {
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
            raw: new AIMessage("understood partial merge"),
          };
        }

        const chunkText = payload.message ?? "";

        const anchors = [
          { kind: "participant", text: "Harry Kane" },
          { kind: "season", text: "2024/25" },
          { kind: "team", text: "Bayern Munich" },
        ].filter(({ text }) => chunkText.includes(text));

        const ambiguities = chunkText.includes("him") ? [chunkAmbiguity] : [];

        return {
          parsed: {
            ambiguities,
            anchors,
            instruction: anchors.map(({ text }) => text).join("; "),
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
          raw: new AIMessage("chunk extraction"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
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
        {
          messages: [
            new HumanMessage({ content: original, id: "omitted-merge-anchor" }),
          ],
        },
        { configurable: { thread_id: "omitted-merge-anchor" } }
      )
    );

    const chunking = result.contextProcessing.compaction?.chunking;

    expect({
      chunksSavedWithSourceReferences: chunking?.chunks.every(
        ({ references, status }) =>
          status === "ready" &&
          references.every(
            ({ end, start, text }) => original.slice(start, end) === text
          )
      ),
      compactionStatus: result.contextProcessing.compaction?.status,
      mergeRan: operations.includes("merge_text_chunks"),
      requestUnderstandingCalls: operations.filter(
        (operation) => operation === "understand_request"
      ).length,
      stopReason: result.contextProcessing.compaction?.stopReason,
    }).toStrictEqual({
      chunksSavedWithSourceReferences: true,
      compactionStatus: "failed",
      mergeRan: true,
      requestUnderstandingCalls: 0,
      stopReason: "source_reference_invalid",
    });
  });

  it("asks through the native clarification interrupt when merged chunks conflict", async () => {
    const filler = "Background note with no scouting constraint. ".repeat(1000);
    const original = `Look up Harry Kane in 2024/25. ${filler}Also consider 2025/26.`;
    const clarification = "Use 2025/26 only.";
    const clarifiedSource = `${original}\n\nUser clarification: ${clarification}`;
    const operations: string[] = [];
    const sourceMessageIds: string[] = [];
    const sourceHashes: string[] = [];
    let mergeCount = 0;
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
            chunks: z.array(z.unknown()).optional(),
            message: z.string().optional(),
            operation: z.string().optional(),
          })
          .parse(JSON.parse(humanContent));

        const { operation } = payload;
        operations.push(operation ?? "understand_request");

        if (operation === "merge_text_chunks") {
          mergeCount += 1;

          const mergePayload = z
            .object({
              source: z.object({ hash: z.string(), messageId: z.string() }),
            })
            .parse(payload);

          sourceHashes.push(mergePayload.source.hash);
          sourceMessageIds.push(mergePayload.source.messageId);

          if (mergeCount === 1) {
            return {
              parsed: {
                ambiguities: ["请确认使用 2024/25 还是 2025/26"],
                anchors: [
                  { kind: "participant", text: "Harry Kane" },
                  { kind: "season", text: "2024/25" },
                  { kind: "season", text: "2025/26" },
                ],
                instruction: "Compare Harry Kane in 2024/25 or 2025/26.",
                references: [
                  {
                    anchorIndex: 0,
                    ...textCompactionTest.anchorAt(original, "Harry Kane"),
                  },
                  {
                    anchorIndex: 1,
                    ...textCompactionTest.anchorAt(original, "2024/25"),
                  },
                  {
                    anchorIndex: 2,
                    ...textCompactionTest.anchorAt(original, "2025/26"),
                  },
                ],
              },
              raw: new AIMessage("merged ambiguity"),
            };
          }

          const resolvedAnchors = [
            {
              kind: "participant",
              ...textCompactionTest.anchorAt(clarifiedSource, "Harry Kane"),
            },
            {
              kind: "season",
              ...textCompactionTest.anchorAt(clarifiedSource, "2024/25"),
            },
            ...[...clarifiedSource.matchAll(/2025\/26/gu)].map((match) => ({
              end: (match.index ?? 0) + match[0].length,
              kind: "season",
              start: match.index ?? 0,
              text: match[0],
            })),
          ];

          return {
            parsed: {
              ambiguities: [],
              anchors: resolvedAnchors.map(({ kind, text }) => ({
                kind,
                text,
              })),
              instruction:
                "Use 2025/26 only for Harry Kane; this corrects the earlier 2024/25 scope.",
              references: resolvedAnchors.map(
                ({ end, start, text }, anchorIndex) => ({
                  anchorIndex,
                  end,
                  start,
                  text,
                })
              ),
            },
            raw: new AIMessage("merged clarified chunks"),
          };
        }

        if (operation === undefined) {
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
            raw: new AIMessage("understood clarified request"),
          };
        }

        const sourceChunk = payload.message ?? "";

        const chunkPayload = z
          .object({ sourceHash: z.string(), sourceMessageId: z.string() })
          .parse(payload);

        sourceHashes.push(chunkPayload.sourceHash);
        sourceMessageIds.push(chunkPayload.sourceMessageId);

        const anchorTexts = ["Harry Kane", "2024/25", "2025/26"];

        const anchors = anchorTexts.flatMap((text) => {
          const found = [...sourceChunk.matchAll(new RegExp(text, "gu"))];

          return found.map((match) => ({
            kind: text === "Harry Kane" ? "participant" : "season",
            start: match.index ?? 0,
            text,
          }));
        });

        return {
          parsed: {
            ambiguities: [],
            anchors: anchors.map(({ kind, text }) => ({ kind, text })),
            instruction: anchors.length
              ? anchors.map(({ text }) => text).join("; ")
              : "No scouting constraints in this fragment.",
            references: anchors.map(({ start, text }, anchorIndex) => ({
              anchorIndex,
              end: start + text.length,
              start,
              text,
            })),
          },
          raw: new AIMessage("chunk extraction"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
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

    const config = {
      configurable: { thread_id: "chunk-conflict-clarification" },
    };

    const paused = AgentState.parse(
      await graph.invoke(
        {
          messages: [
            new HumanMessage({ content: original, id: "chunk-conflict" }),
          ],
        },
        config
      )
    );

    const snapshot = await graph.getState(config);
    const chunking = paused.contextProcessing.compaction?.chunking;

    expect({
      allChunksSaved: chunking?.chunks.every(
        ({ status }) => status === "ready"
      ),
      answerHasQuestion: paused.pendingClarification?.question,
      chunksExtracted:
        operations.filter((operation) => operation === "extract_text_chunk")
          .length > 1,
      compactionStatus: paused.contextProcessing.compaction?.status,
      interruptPending: snapshot.tasks.some(
        ({ interrupts }) => interrupts.length > 0
      ),
      mergeCallCount: operations.filter(
        (operation) => operation === "merge_text_chunks"
      ).length,
      mergeRanLast: operations.at(-1) === "merge_text_chunks",
      mergeStatus: chunking?.mergeStatus,
      originalMessage: paused.messages[0]?.content,
      pendingKind: paused.pendingClarification?.kind,
    }).toStrictEqual({
      allChunksSaved: true,
      answerHasQuestion:
        "原始球探指令中这些条件不明确或相互冲突：请确认使用 2024/25 还是 2025/26。请补充或修正后继续。",
      chunksExtracted: true,
      compactionStatus: "needs_clarification",
      interruptPending: true,
      mergeCallCount: 1,
      mergeRanLast: true,
      mergeStatus: "ready",
      originalMessage: original,
      pendingKind: "context_processing",
    });

    const resumed = AgentState.parse(
      await graph.invoke(new Command({ resume: clarification }), config)
    );

    const resumedChunking = resumed.contextProcessing.compaction?.chunking;

    expect({
      allResumedChunksSaved: resumedChunking?.chunks.every(
        ({ status }) => status === "ready"
      ),
      clarificationAnswers: resumed.contextProcessing.clarification?.answers,
      compactionStatus: resumed.contextProcessing.compaction?.status,
      finalInstruction: resumed.contextProcessing.compaction?.instruction,
      referencesMatchClarifiedSource:
        resumed.contextProcessing.compaction?.references.every(
          ({ end, start, text }) => clarifiedSource.slice(start, end) === text
        ),
      resumedMessage: resumed.messages[0]?.content,
      resumedSourceHashChanged:
        new Set(sourceHashes).size === 2 &&
        sourceHashes.at(-1) !== sourceHashes[0],
      resumedSourceIdsStayBound:
        sourceMessageIds.length > 0 &&
        sourceMessageIds.every(
          (sourceMessageId) => sourceMessageId === "chunk-conflict"
        ),
      resumedThroughUnderstanding: operations.includes("understand_request"),
    }).toStrictEqual({
      allResumedChunksSaved: true,
      clarificationAnswers: [clarification],
      compactionStatus: "ready",
      finalInstruction:
        "Use 2025/26 only for Harry Kane; this corrects the earlier 2024/25 scope.",
      referencesMatchClarifiedSource: true,
      resumedMessage: original,
      resumedSourceHashChanged: true,
      resumedSourceIdsStayBound: true,
      resumedThroughUnderstanding: true,
    });
  });
});
