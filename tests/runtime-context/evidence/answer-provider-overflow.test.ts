import { AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { agentGraphTest } from "../../fixtures/agent-graph.js";
import {
  configureComparisonEvidenceTestEnvironment,
  comparisonEvidenceTest,
} from "../../fixtures/comparison-evidence.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";

configureComparisonEvidenceTestEnvironment();

const runCommittedAnswerOverflow = async (
  maxAdditionalCalls: number,
  threadId: string
) => {
  const { players, resultJson } = comparisonEvidenceTest.comparisonFixture();
  let calls = 0;

  const respond = (messages: BaseMessage[]) => {
    calls += 1;
    const input = messages.at(-1)?.text ?? "";

    const [projectionJson] = input
      .split("Comparison evidence projection JSON:\n")
      .slice(1);

    if (projectionJson === undefined) {
      return Object.assign(
        new Error("The request exceeds the maximum context length."),
        { code: "context_length_exceeded", status: 400 }
      );
    }

    const projection = z
      .object({
        selectedPlayers: z.array(z.object({ playerName: z.string() })),
      })
      .parse(JSON.parse(projectionJson));

    const [player] = projection.selectedPlayers;

    return new AIMessage(`${player?.playerName} was reviewed.`);
  };

  const model = fakeModel();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    model.respond(respond);
  }

  Object.assign(model, {
    getNumTokens: async (text: string) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    },
  });

  const graph = agentGraphTest.createAgent({
    checkpointer: new MemorySaver(),
    contextProcessingAllowance: { maxAdditionalCalls },
    model,
    modelContextProfile: {
      countingMarginTokens: 64,
      maxInputTokens: 100_000,
      maxOutputTokens: 256,
      softTriggerFraction: 0.99,
      targetFraction: 0.6,
    },
    modelOutputLimitAdapter: testModelOutputLimitAdapter,
    tools: [],
  });

  const result = await graph.invoke(
    comparisonEvidenceTest.graphStateForSavedComparison(resultJson),
    { configurable: { thread_id: threadId } }
  );

  return { calls, players, result, resultJson };
};

describe("committed answer provider overflow recovery", () => {
  it("switches to single participant evidence batches", async () => {
    const { calls, players, result } = await runCommittedAnswerOverflow(
      6,
      "answer-overflow-comparison"
    );

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      evidenceBatchSizes: result.comparisonEvidence?.batches.map(
        ({ projectionJson }) =>
          z
            .object({
              batch: z.object({ participantRefs: z.array(z.string()) }),
            })
            .parse(JSON.parse(projectionJson)).batch.participantRefs.length
      ),
      evidenceStatus: result.comparisonEvidence?.status,
      failure: result.faultTolerance.failure,
      modelCalls: calls,
      participantNames: players.map(({ playerName }) =>
        answer.includes(playerName)
      ),
    }).toStrictEqual({
      allowanceCalls: 4,
      evidenceBatchSizes: [1, 1, 1, 1],
      evidenceStatus: "complete",
      failure: null,
      modelCalls: 5,
      participantNames: [true, true, true, true],
    });
  });

  it("ablation: with one recovery call, keeps all data and marks explanation incomplete", async () => {
    const { calls, players, result, resultJson } =
      await runCommittedAnswerOverflow(1, "answer-overflow-one-call");

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      answerContainsCompleteResult: answer.includes(resultJson),
      evidenceBatchStatuses: result.comparisonEvidence?.batches.map(
        ({ status }) => status
      ),
      evidenceStatus: result.comparisonEvidence?.status,
      explanationIsIncomplete:
        answer.includes("分批解释未完成") && !answer.includes("was reviewed."),
      modelCalls: calls,
      participantNames: players.map(({ playerName }) =>
        answer.includes(playerName)
      ),
    }).toStrictEqual({
      allowanceCalls: 1,
      answerContainsCompleteResult: true,
      evidenceBatchStatuses: ["ready", "pending", "pending", "pending"],
      evidenceStatus: "allowance_exhausted",
      explanationIsIncomplete: true,
      modelCalls: 2,
      participantNames: [true, true, true, true],
    });
  });
});
