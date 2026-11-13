import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it, vi } from "vitest";

import {
  contextProcessingHash,
  createInitialContextProcessing,
} from "../../../src/context-processing-state.js";
import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../../src/state.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";

describe("compacted lookup evidence continuation graph", () => {
  it("finishes an exhausted lookup explanation from compacted context without searching again", async () => {
    const sourceMessageId = "long-lookup-source";
    const continuationMessageId = "continue-lookup-evidence";

    const filler = "Background note with no scouting constraint.".repeat(
      12_000
    );

    const sourceText = `Please report Elias Demo's Understat 2024/25 xG. ${filler}`;
    const instruction = "Report Elias Demo's Understat 2024/25 xG.";
    const requestId = `message:${sourceMessageId}`;

    const sourceRecords = [
      { provider: "understat" as const, sourceId: "us-demo-01" },
    ];

    const resultJson = JSON.stringify({
      identityGroups: {
        canonicalGroups: [],
        registryStatus: "not_needed",
        unlinkedRecords: [],
      },
      query: sourceRecords,
      requestedUnderstatSeasonStartYear: 2024,
      understat: {
        records: [
          {
            appearances: null,
            assists: 2,
            competition: "EPL",
            expectedAssists: 1.3,
            expectedGoals: 5.2,
            goals: 8,
            keyPasses: 21,
            minutes: 1120,
            nonPenaltyExpectedGoals: 4.8,
            player: "Elias Demo",
            position: "F",
            season: "2024/25",
            shots: 34,
            source: "Understat",
            sourcePlayerId: "us-demo-01",
            team: "Fixture City",
          },
        ],
        status: "found",
      },
    });

    const candidate = agentGraphTest.playerCandidate("Elias Demo", "evidence");

    const conversationContext = {
      ...createInitialConversationContext(),
      activeLookup: {
        player: agentGraphTest.conversationReferenceFromCandidate(candidate),
        resultJson,
      },
    };

    const compactionSourceHash = contextProcessingHash(sourceText);
    const questionHash = contextProcessingHash(instruction);

    const model = fakeModel().respond(
      new AIMessage("Elias Demo recorded 5.2 xG in the 2024/25 EPL season.")
    );

    const modelInputs = vi.spyOn(model, "invoke");
    const search = vi.fn<PlayerSearch>(agentGraphTest.emptySearchResult);

    const graph = agentGraphTest.createAgent({
      contextProcessingAllowance: {
        maxActiveTimeMs: 120_000,
        maxAdditionalCalls: 6,
      },
      model,
      modelContextProfile: {
        countingMarginTokens: 500,
        maxInputTokens: 10_000,
        maxOutputTokens: 512,
      },
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const state = AgentState.parse({
      contextProcessing: {
        ...createInitialContextProcessing(),
        allowance: {
          consumedActiveTimeMs: 120_000,
          consumedAdditionalCalls: 6,
          grants: [],
          maxActiveTimeMs: 120_000,
          maxAdditionalCalls: 6,
          requestId,
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
          instructionHash: questionHash,
          modelConfigurationHash: "model-configuration-hash",
          outputTokenEstimate: 16,
          progress: { end: sourceText.length, start: 0 },
          references: [],
          requestId,
          sourceClarificationAnswers: [],
          sourceHash: compactionSourceHash,
          sourceMessageId,
          sourceTokenEstimate: Math.ceil(sourceText.length / 4),
          status: "ready",
          stopReason: null,
          targetTokenEstimate: 32,
        },
      },
      conversationContext,
      lookupEvidence: {
        batches: [
          {
            answer: null,
            index: 0,
            projectionJson: "{}",
            recordRefs: ["understat.records[0]"],
            status: "pending",
          },
        ],
        failureReason: "allowance_exhausted",
        questionHash,
        requestId,
        resultDigest: contextProcessingHash(resultJson),
        source: "executed",
        sourceHash: "expired-raw-question-evidence-hash",
        sourceMessageId,
        status: "allowance_exhausted",
      },
      messages: [
        new HumanMessage({ content: sourceText, id: sourceMessageId }),
        new AIMessage("查询数据已完整保存，但解释额度已用完。"),
      ],
      outcome: {
        kind: "player_lookup",
        resultJson,
        source: "executed",
        status: "data_ready",
      },
      request: {
        ...createInitialRequestState(),
        processedMessageId: sourceMessageId,
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const result = AgentState.parse(
      await graph.invoke(
        {
          ...state,
          messages: [
            ...state.messages,
            new HumanMessage({
              content: "继续查询",
              id: continuationMessageId,
            }),
          ],
        },
        { configurable: { thread_id: "compacted-evidence-continuation" } }
      )
    );

    const modelInput = JSON.stringify(
      modelInputs.mock.calls.map(([input]) => input)
    );

    expect({
      answer: result.messages.at(-1)?.content,
      evidenceStatus: result.lookupEvidence?.status,
      outcome: result.outcome?.status,
      searchCalls: search.mock.calls.length,
      sentOriginalLongMessage: modelInput.includes(sourceText),
      usedCompactedQuestion: modelInput.includes(instruction),
    }).toStrictEqual({
      answer: "Elias Demo recorded 5.2 xG in the 2024/25 EPL season.",
      evidenceStatus: "complete",
      outcome: "answer_ready",
      searchCalls: 0,
      sentOriginalLongMessage: false,
      usedCompactedQuestion: true,
    });
  });
});
