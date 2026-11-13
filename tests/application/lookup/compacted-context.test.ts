import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { compactedScoutingContextFor } from "../../../src/context-processing-continuation.js";
import {
  contextProcessingHash,
  createInitialContextProcessing,
} from "../../../src/context-processing-state.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialRequestState,
} from "../../../src/state.js";

describe("compacted lookup context", () => {
  it("uses the original task after request understanding marks continue as processed", () => {
    const sourceMessageId = "long-source-message";
    const continuationMessageId = "continue-message";

    const sourceText =
      "请查询 Elias Demo 的 FM 画像和 2024/25 Understat 表现。";

    const instruction =
      "查询 Elias Demo 的 FM 画像，以及 Understat 2024/25 赛季表现。";

    const state = AgentState.parse({
      contextProcessing: {
        ...createInitialContextProcessing(),
        allowance: {
          consumedActiveTimeMs: 12_000,
          consumedAdditionalCalls: 7,
          grants: [
            {
              additionalActiveTimeMs: 120_000,
              additionalCalls: 6,
              continuationMessageId,
              kind: "text_compaction",
              requestId: "context-processing-request",
              sourceHash: contextProcessingHash(sourceText),
              sourceMessageId,
            },
          ],
          maxActiveTimeMs: 240_000,
          maxAdditionalCalls: 12,
          requestId: "context-processing-request",
          reservation: null,
          reservedActiveTimeMs: 0,
        },
        compaction: {
          activeContextHash: "active-context-hash",
          ambiguities: [],
          anchors: [
            { kind: "participant", text: "Elias Demo" },
            { kind: "season", text: "2024/25" },
          ],
          chunking: null,
          formatVersion: 2,
          instruction,
          instructionHash: contextProcessingHash(instruction),
          modelConfigurationHash: "model-configuration-hash",
          outputTokenEstimate: 18,
          progress: { end: sourceText.length, start: 0 },
          references: [],
          requestId: "context-processing-request",
          sourceClarificationAnswers: [],
          sourceHash: contextProcessingHash(sourceText),
          sourceMessageId,
          sourceTokenEstimate: 24,
          status: "ready",
          stopReason: null,
          targetTokenEstimate: 20,
        },
      },
      messages: [
        new HumanMessage({ content: sourceText, id: sourceMessageId }),
        new HumanMessage({ content: "继续", id: continuationMessageId }),
      ],
      request: {
        ...createInitialRequestState(),
        processedMessageId: continuationMessageId,
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    expect(compactedScoutingContextFor(state)).toMatchObject({
      instruction,
      sourceMessage: { id: sourceMessageId },
      sourceText,
    });
  });
});
