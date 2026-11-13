import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { agentGraphTest } from "../../fixtures/agent-graph.js";
import {
  configureComparisonEvidenceTestEnvironment,
  comparisonEvidenceTest,
} from "../../fixtures/comparison-evidence.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";

configureComparisonEvidenceTestEnvironment();

const truncatedComparisonResponse = () =>
  new AIMessage({
    content: "PARTIAL_TRUNCATED_COMPARISON_EXPLANATION",
    response_metadata: { finish_reason: "length" },
    usage_metadata: {
      input_tokens: 101,
      output_tokens: 256,
      total_tokens: 357,
    },
  });

const comparisonResponse = (messages: BaseMessage[]) => {
  const humanMessage = messages.find(
    (message) => message instanceof HumanMessage
  );

  const content = z.string().parse(humanMessage?.content);

  const [projectionJson] = content
    .split("Comparison evidence projection JSON:\n")
    .slice(1);

  if (projectionJson === undefined) {
    return truncatedComparisonResponse();
  }

  const projection = z
    .object({ selectedPlayers: z.array(z.object({ playerName: z.string() })) })
    .parse(JSON.parse(projectionJson));

  if (projection.selectedPlayers.length > 1) {
    return truncatedComparisonResponse();
  }

  return new AIMessage(
    `${projection.selectedPlayers[0]?.playerName} was reviewed.`
  );
};

const modelContextUsageLogsFrom = (messages: string[]) =>
  messages.flatMap((message) => {
    let parsedMessage: unknown;

    try {
      parsedMessage = JSON.parse(message);
    } catch {
      return [];
    }

    const parsed = z
      .looseObject({
        contextIssue: z.string().nullable(),
        estimatedInputTokens: z.number(),
        providerInputTokens: z.number().nullable(),
        providerOutputTokens: z.number().nullable(),
        providerUsageStatus: z.string(),
        type: z.string(),
      })
      .safeParse(parsedMessage);

    return parsed.success && parsed.data.type === "model_context_usage"
      ? [parsed.data]
      : [];
  });

describe("comparison evidence output truncation recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-batches a truncated direct answer and logs usage without publishing partial text", async () => {
    const { players, resultJson } = comparisonEvidenceTest.comparisonFixture();
    const model = fakeModel();
    const loggedMessages: string[] = [];

    for (let attempt = 0; attempt < 10; attempt += 1) {
      model.respond(comparisonResponse);
    }

    Object.assign(model, {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    });

    const modelInvoke = vi.spyOn(model, "invoke");
    vi.spyOn(console, "info").mockImplementation((message) => {
      loggedMessages.push(String(message));
    });

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 10 },
      model,
      modelContextProfile: {
        ...comparisonEvidenceTest.comparisonEvidenceModelContextProfile,
        maxInputTokens: 100_000,
        softTriggerFraction: 0.99,
        targetFraction: 0.6,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = await graph.invoke(
      comparisonEvidenceTest.graphStateForSavedComparison(resultJson),
      { configurable: { thread_id: "comparison-output-truncation" } }
    );

    const requestedProjectionSizes = modelInvoke.mock.calls.map(([input]) => {
      const messages = z.array(z.object({ content: z.unknown() })).parse(input);
      const content = z.string().parse(messages.at(-1)?.content);

      const [projectionJson] = content
        .split("Comparison evidence projection JSON:\n")
        .slice(1);

      if (projectionJson === undefined) {
        return 0;
      }

      return z
        .object({ selectedPlayers: z.array(z.unknown()) })
        .parse(JSON.parse(projectionJson)).selectedPlayers.length;
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);

    const usageLogs = modelContextUsageLogsFrom(loggedMessages);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      answerContainsPartialResponse: answer.includes(
        "PARTIAL_TRUNCATED_COMPARISON_EXPLANATION"
      ),
      batchStatuses: result.comparisonEvidence?.batches.map(
        ({ status }) => status
      ),
      evidenceStatus: result.comparisonEvidence?.status,
      modelCalls: modelInvoke.mock.calls.length,
      participantNames: players.map(({ playerName }) =>
        answer.includes(playerName)
      ),
      reportedTruncatedUsage: usageLogs.filter(
        ({
          contextIssue,
          providerInputTokens,
          providerOutputTokens,
          providerUsageStatus,
        }) =>
          providerInputTokens === 101 &&
          providerOutputTokens === 256 &&
          providerUsageStatus === "reported" &&
          contextIssue === "response_truncated"
      ).length,
      requestedProjectionSizes,
    }).toStrictEqual({
      allowanceCalls: 4,
      answerContainsPartialResponse: false,
      batchStatuses: ["ready", "ready", "ready", "ready"],
      evidenceStatus: "complete",
      modelCalls: 5,
      participantNames: [true, true, true, true],
      reportedTruncatedUsage: 1,
      requestedProjectionSizes: [0, 1, 1, 1, 1],
    });
  });

  it("re-splits a truncated comparison evidence batch until every participant is reviewed", async () => {
    const { players, resultJson } = comparisonEvidenceTest.comparisonFixture();
    const model = fakeModel();
    const loggedMessages: string[] = [];

    for (let attempt = 0; attempt < 10; attempt += 1) {
      model.respond(comparisonResponse);
    }

    Object.assign(model, {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    });

    const modelInvoke = vi.spyOn(model, "invoke");
    vi.spyOn(console, "info").mockImplementation((message) => {
      loggedMessages.push(String(message));
    });

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 10 },
      model,
      modelContextProfile: {
        ...comparisonEvidenceTest.comparisonEvidenceModelContextProfile,
        maxInputTokens: 10_000,
        softTriggerFraction: 0.5,
        targetFraction: 0.1,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = await graph.invoke(
      comparisonEvidenceTest.graphStateForSavedComparison(resultJson),
      { configurable: { thread_id: "comparison-batch-output-truncation" } }
    );

    const requestedProjectionSizes = modelInvoke.mock.calls.map(([input]) => {
      const messages = z.array(z.object({ content: z.unknown() })).parse(input);
      const content = z.string().parse(messages.at(-1)?.content);

      const [projectionJson] = content
        .split("Comparison evidence projection JSON:\n")
        .slice(1);

      if (projectionJson === undefined) {
        throw new Error("The comparison evidence projection is missing.");
      }

      return z
        .object({ selectedPlayers: z.array(z.unknown()) })
        .parse(JSON.parse(projectionJson)).selectedPlayers.length;
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);
    const usageLogs = modelContextUsageLogsFrom(loggedMessages);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      answerContainsPartialResponse: answer.includes(
        "PARTIAL_TRUNCATED_COMPARISON_EXPLANATION"
      ),
      batchStatuses: result.comparisonEvidence?.batches.map(
        ({ status }) => status
      ),
      evidenceStatus: result.comparisonEvidence?.status,
      participantNames: players.map(({ playerName }) =>
        answer.includes(playerName)
      ),
      reportedTruncatedUsage: usageLogs.filter(
        ({ providerInputTokens, providerOutputTokens, providerUsageStatus }) =>
          providerInputTokens === 101 &&
          providerOutputTokens === 256 &&
          providerUsageStatus === "reported"
      ).length,
      requestedProjectionSizes,
    }).toStrictEqual({
      allowanceCalls: 7,
      answerContainsPartialResponse: false,
      batchStatuses: ["ready", "ready", "ready", "ready"],
      evidenceStatus: "complete",
      participantNames: [true, true, true, true],
      reportedTruncatedUsage: 3,
      requestedProjectionSizes: [4, 2, 1, 1, 2, 1, 1],
    });
  });

  it("stops truncated-output recovery when cancelled before the next batch completes", async () => {
    const { resultJson } = comparisonEvidenceTest.comparisonFixture();
    const controller = new AbortController();
    let recoveryCalls = 0;

    const model = fakeModel()
      .respond(truncatedComparisonResponse())
      .respond(() => {
        recoveryCalls += 1;

        controller.abort(new Error("The user cancelled output recovery."));

        return new AIMessage("The cancelled batch is incomplete.");
      });

    Object.assign(model, {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    });

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 10 },
      model,
      modelContextProfile: {
        ...comparisonEvidenceTest.comparisonEvidenceModelContextProfile,
        maxInputTokens: 100_000,
        softTriggerFraction: 0.99,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const pendingRun = graph.invoke(
      comparisonEvidenceTest.graphStateForSavedComparison(resultJson),
      {
        configurable: { thread_id: "comparison-output-truncation-cancel" },
        signal: controller.signal,
      }
    );

    const wasCancelled = await pendingRun.then(
      () => false,
      () => true
    );

    expect({
      modelCalls: model.callCount,
      recoveryCalls,
      wasCancelled,
    }).toStrictEqual({
      modelCalls: 2,
      recoveryCalls: 1,
      wasCancelled: true,
    });
  });
});
