import { createHash } from "node:crypto";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import { AgentState } from "../../../src/state.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";
import type { ContextProcessingState } from "../../fixtures/text-compaction.js";

describe("automatic input compaction and chunking", () => {
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
        {
          ...textCompactionTest.anchorAt(original, "Harry Kane"),
          anchorIndex: 0,
        },
        {
          ...textCompactionTest.anchorAt(original, "Bundesliga"),
          anchorIndex: 1,
        },
        { ...textCompactionTest.anchorAt(original, "2025/26"), anchorIndex: 2 },
        {
          ...textCompactionTest.anchorAt(original, "excluding Erling Haaland"),
          anchorIndex: 3,
        },
      ],
    };

    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
    let fakeNow = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      fakeNow += 10;

      return fakeNow;
    });

    const checkpointer = new MemorySaver();

    const graph = textCompactionTest.createAgent({
      checkpointer,
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
      originalMessagePreserved: result.messages[0]?.content === original,
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
      originalMessagePreserved: true,
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
});
