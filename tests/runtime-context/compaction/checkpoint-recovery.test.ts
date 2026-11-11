import { createHash } from "node:crypto";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { AgentState, agentStateSchemaVersion } from "../../../src/state.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";
import type { AgentStateType } from "../../fixtures/text-compaction.js";

describe("clarification and checkpoint recovery", () => {
  it("clarifies an ambiguous compaction and resumes the original request", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Compare Harry Kane in Bundesliga for 2024/25 or 2025/26, excluding Erling Haaland. ${filler}`;
    const clarification = "Use 2025/26.";
    const combinedSource = `${original}\n\nUser clarification: ${clarification}`;

    const instruction =
      "Compare Harry Kane in Bundesliga for 2024/25 and 2025/26, excluding Erling Haaland. User clarification: Use 2025/26.";

    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        if (modelPayloads.length === 1) {
          return {
            parsed: {
              ambiguities: ["请确认使用 2024/25 还是 2025/26。"],
              anchors: [],
              instruction: "Look up Harry Kane.",
              references: [],
            },
            raw: new AIMessage("ambiguous compaction"),
          };
        }

        if (modelPayloads.length === 2) {
          const seasonLastStart = combinedSource.lastIndexOf("2025/26");

          return {
            parsed: {
              ambiguities: [],
              anchors: [
                { kind: "participant", text: "Harry Kane" },
                { kind: "competition", text: "Bundesliga" },
                { kind: "season", text: "2024/25" },
                { kind: "season", text: "2025/26" },
                { kind: "exclusion", text: "excluding Erling Haaland" },
              ],
              instruction,
              references: [
                {
                  ...textCompactionTest.anchorAt(combinedSource, "Harry Kane"),
                  anchorIndex: 0,
                },
                {
                  ...textCompactionTest.anchorAt(combinedSource, "Bundesliga"),
                  anchorIndex: 1,
                },
                {
                  ...textCompactionTest.anchorAt(combinedSource, "2024/25"),
                  anchorIndex: 2,
                },
                {
                  ...textCompactionTest.anchorAt(combinedSource, "2025/26"),
                  anchorIndex: 3,
                },
                {
                  ...textCompactionTest.anchorAt(
                    combinedSource,
                    "excluding Erling Haaland"
                  ),
                  anchorIndex: 4,
                },
                {
                  anchorIndex: 3,
                  end: seasonLastStart + "2025/26".length,
                  start: seasonLastStart,
                  text: "2025/26",
                },
              ],
            },
            raw: new AIMessage("clarified compaction"),
          };
        }

        return {
          parsed: {
            constraints: [
              { name: "season", value: "2024/25" },
              { name: "season", value: "2025/26" },
              { name: "competition", value: "Bundesliga" },
            ],
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

    const graphConfig = {
      configurable: { thread_id: "ambiguous-compaction-resume" },
    };

    const pausedResponse = await graph.invoke(
      { messages: [new HumanMessage(original)] },
      graphConfig
    );

    const paused = AgentState.parse(pausedResponse);
    const pausedSnapshot = await graph.getState(graphConfig);

    expect({
      interruptAsked: pausedSnapshot.tasks.some(
        ({ interrupts }) => interrupts.length > 0
      ),
      next: pausedSnapshot.next,
      pendingKind: paused.pendingClarification?.kind,
      sourceMessage: paused.messages[0]?.content,
      taskNames: pausedSnapshot.tasks.map(({ name }) => name),
    }).toStrictEqual({
      interruptAsked: true,
      next: ["clarify"],
      pendingKind: "context_processing",
      sourceMessage: original,
      taskNames: ["clarify"],
    });

    const resumed = AgentState.parse(
      await graph.invoke(new Command({ resume: clarification }), graphConfig)
    );

    expect({
      clarificationAnswers: resumed.contextProcessing.clarification?.answers,
      compactedInstruction: resumed.contextProcessing.compaction?.instruction,
      compactionCalls: modelPayloads.length,
      compactionSourceHash: resumed.contextProcessing.compaction?.sourceHash,
      compactionStatus: resumed.contextProcessing.compaction?.status,
      compactionStopReason: resumed.contextProcessing.compaction?.stopReason,
      consumedCalls:
        resumed.contextProcessing.allowance?.consumedAdditionalCalls,
      expectedSourceHash: createHash("sha256")
        .update(combinedSource)
        .digest("hex"),
      modelSawClarificationInSecondCall: JSON.stringify(
        modelPayloads[1]
      ).includes("User clarification: Use 2025/26."),
      pendingKind: resumed.pendingClarification?.kind ?? null,
      requestKind: resumed.request.kind,
      requestPlayer: resumed.request.players[0]?.mention,
      requestSeasonConstraint: resumed.request.constraints.find(
        ({ name }) => name === "understatSeasonStartYear"
      ),
    }).toStrictEqual({
      clarificationAnswers: [clarification],
      compactedInstruction: instruction,
      compactionCalls: 3,
      compactionSourceHash: createHash("sha256")
        .update(combinedSource)
        .digest("hex"),
      compactionStatus: "ready",
      compactionStopReason: null,
      consumedCalls: 2,
      expectedSourceHash: createHash("sha256")
        .update(combinedSource)
        .digest("hex"),
      modelSawClarificationInSecondCall: true,
      pendingKind: null,
      requestKind: "player_lookup",
      requestPlayer: "Harry Kane",
      requestSeasonConstraint: {
        name: "understatSeasonStartYear",
        value: "2025",
      },
    });
    expect(resumed.messages[0]?.content).toBe(original);
  });

  it("resumes an unprocessed request from its cached compaction checkpoint", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane. ${filler}`;
    const instruction = "Look up Harry Kane.";
    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
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
              {
                anchorIndex: 0,
                ...textCompactionTest.anchorAt(original, "Harry Kane"),
              },
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
      modelContextProfile: textCompactionTest.modelContextProfile,
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

    const graph = textCompactionTest.createAgent(options);

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

    let cachedCheckpointState: AgentStateType | null = null;

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
        cachedCheckpointState = checkpointState;
        break;
      }
    }

    if (cachedCheckpointConfig === null || cachedCheckpointState === null) {
      throw new Error("No unprocessed cached compaction checkpoint was found.");
    }

    const resumedGraph = textCompactionTest.createAgent(options);

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

    const cachedCompaction = cachedCheckpointState.contextProcessing.compaction;

    if (cachedCompaction === null) {
      throw new Error("The cached compaction record is missing.");
    }

    const staleCompactions = [
      {
        field: "source hash",
        record: { ...cachedCompaction, sourceHash: "stale-source-hash" },
      },
      {
        field: "source message ID",
        record: { ...cachedCompaction, sourceMessageId: "stale-message-id" },
      },
      {
        field: "request ID",
        record: { ...cachedCompaction, requestId: "stale-request-id" },
      },
      {
        field: "model configuration",
        record: {
          ...cachedCompaction,
          modelConfigurationHash: "stale-model-configuration",
        },
      },
      {
        field: "format version",
        record: {
          ...cachedCompaction,
          formatVersion: cachedCompaction.formatVersion + 1,
        },
      },
      {
        field: "instruction digest",
        record: {
          ...cachedCompaction,
          instructionHash: "stale-instruction-digest",
        },
      },
    ];

    await Promise.all(
      staleCompactions.map(async (staleCache, index) => {
        const staleModel = fakeModel();
        const staleModelPayloads: unknown[] = [];
        textCompactionTest.mockDeterministicTokenCount(staleModel);
        vi.spyOn(staleModel, "withStructuredOutput").mockReturnValue(
          RunnableLambda.from((input) => {
            staleModelPayloads.push(input);

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
                  {
                    anchorIndex: 0,
                    ...textCompactionTest.anchorAt(original, "Harry Kane"),
                  },
                ],
                teams: [],
              },
              raw: new AIMessage("rebuilt compaction"),
            };
          })
        );

        const staleState = AgentState.parse({
          ...cachedCheckpointState,
          contextProcessing: {
            ...cachedCheckpointState.contextProcessing,
            compaction: staleCache.record,
          },
        });

        const staleCacheGraph = textCompactionTest.createAgent({
          ...options,
          checkpointer: new MemorySaver(),
          model: staleModel,
        });

        const rebuilt = AgentState.parse(
          await staleCacheGraph.invoke(staleState, {
            configurable: { thread_id: `stale-cache-${index}` },
          })
        );

        expect({
          allowanceCalls:
            rebuilt.contextProcessing.allowance?.consumedAdditionalCalls,
          compactionStatus: rebuilt.contextProcessing.compaction?.status,
          invalidatedField: staleCache.field,
          modelCallCount: staleModelPayloads.length,
          requestKind: rebuilt.request.kind,
        }).toStrictEqual({
          allowanceCalls: 2,
          compactionStatus: "ready",
          invalidatedField: staleCache.field,
          modelCallCount: 2,
          requestKind: "player_lookup",
        });
      })
    );
  });

  it("rebuilds a cached compaction when its context digest is stale", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const messageId = "stale-context-compaction";
    const original = `Look up Harry Kane. ${filler}`;
    const instruction = "Look up Harry Kane.";
    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
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
              {
                anchorIndex: 0,
                ...textCompactionTest.anchorAt(original, "Harry Kane"),
              },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const originalHash = createHash("sha256").update(original).digest("hex");
    const staleInstruction = "Old stale request.";

    const staleState = AgentState.parse({
      contextProcessing: {
        allowance: {
          consumedActiveTimeMs: 10,
          consumedAdditionalCalls: 1,
          maxActiveTimeMs: 120_000,
          maxAdditionalCalls: 6,
          requestId: `message:${messageId}`,
          reservation: null,
        },
        clarification: null,
        compaction: {
          activeContextHash: "stale-context-digest",
          ambiguities: [],
          anchors: [{ kind: "participant", text: "Harry Kane" }],
          formatVersion: 2,
          instruction: staleInstruction,
          instructionHash: createHash("sha256")
            .update(staleInstruction)
            .digest("hex"),
          modelConfigurationHash: "stale-model-digest",
          outputTokenEstimate: 5,
          progress: { end: original.length, start: 0 },
          references: [
            {
              anchorIndex: 0,
              ...textCompactionTest.anchorAt(original, "Harry Kane"),
            },
          ],
          requestId: `message:${messageId}`,
          sourceHash: originalHash,
          sourceMessageId: messageId,
          sourceTokenEstimate: 100,
          status: "ready",
          stopReason: null,
          targetTokenEstimate: 50,
        },
      },
      messages: [new HumanMessage({ content: original, id: messageId })],
      stateSchemaVersion: agentStateSchemaVersion,
    });

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
      await graph.invoke(staleState, {
        configurable: { thread_id: "stale-context-compaction" },
      })
    );

    const businessInput = JSON.stringify(modelPayloads.at(-1));

    expect({
      compactedInstruction: result.contextProcessing.compaction?.instruction,
      consumedAdditionalCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      modelCallCount: modelPayloads.length,
      requestKind: result.request.kind,
      staleInstructionAbsent: !businessInput.includes(staleInstruction),
    }).toStrictEqual({
      compactedInstruction: instruction,
      consumedAdditionalCalls: 2,
      modelCallCount: 2,
      requestKind: "player_lookup",
      staleInstructionAbsent: true,
    });
  });
});
