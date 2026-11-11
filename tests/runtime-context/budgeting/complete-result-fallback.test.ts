import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import {
  AgentState,
  agentStateSchemaVersion,
  createInitialRequestState,
} from "../../../src/state.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";
import { comparisonEvidenceTest } from "../../fixtures/comparison-evidence.js";
import {
  testModelContextProfile,
  testModelOutputLimitAdapter,
} from "../../fixtures/model-context.js";

describe("runtime model input budget", () => {
  afterEach(() => {
    vi.stubEnv(
      "TACTISCOUT_MODEL_CONTEXT_PROFILE",
      agentGraphTest.testModelContextProfileEnvironment
    );
  });

  it("shows the complete saved result when its explanation cannot fit", async () => {
    const message = new HumanMessage({
      content: "Explain the saved comparison.",
      id: "saved-comparison-explanation",
    });

    const { resultJson } = comparisonEvidenceTest.comparisonFixture();

    const state = AgentState.parse({
      messages: [message],
      outcome: {
        kind: "player_comparison",
        resultJson,
        source: "saved",
        status: "ready",
      },
      request: {
        ...createInitialRequestState(),
        processedMessageId: message.id,
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const model = fakeModel();
    vi.spyOn(model, "getNumTokens").mockImplementation(async (text) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    });

    const graph = agentGraphTest.createAgentWithRuntime({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 128,
        maxOutputTokens: 32,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = await graph.invoke(state, {
      configurable: { thread_id: "saved-result-explanation-over-budget" },
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect(answer).toContain(resultJson);
    expect(answer).toContain("解释未完成");
    expect(result.comparisonEvidence?.status).toBe("failed");
    expect(result.faultTolerance.failure).toBeNull();
    expect(model.callCount).toBe(0);
  });

  it("does not publish a saved-result explanation when the model truncates", async () => {
    const message = new HumanMessage({
      content: "Explain the saved comparison.",
      id: "saved-comparison-truncated-explanation",
    });

    const { resultJson } = comparisonEvidenceTest.comparisonFixture();

    const state = AgentState.parse({
      messages: [message],
      outcome: {
        kind: "player_comparison",
        resultJson,
        source: "saved",
        status: "ready",
      },
      request: {
        ...createInitialRequestState(),
        processedMessageId: message.id,
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const model = fakeModel().respond(
      new AIMessage({
        content: "This answer stops halfway.",
        response_metadata: { finish_reason: "length" },
      })
    );

    vi.spyOn(model, "getNumTokens").mockImplementation(async (text) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    });

    const graph = agentGraphTest.createAgentWithRuntime({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: testModelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = await graph.invoke(state, {
      configurable: { thread_id: "saved-result-truncated-explanation" },
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect(answer).toContain(resultJson);
    expect(answer).toContain("解释未完成");
    expect(answer).not.toContain("This answer stops halfway.");
    expect(result.faultTolerance.failure).toMatchObject({
      category: "context_limit",
      contextIssue: "response_truncated",
      node: "answer",
    });
  });

  it("accepts a complete Responses API result with null incomplete details", async () => {
    const message = new HumanMessage({
      content: "Explain the saved lookup.",
      id: "saved-lookup-completed-response",
    });

    const state = AgentState.parse({
      messages: [message],
      outcome: {
        kind: "player_lookup",
        resultJson: agentGraphTest.emptySearchResult({
          sourceRecords: [{ provider: "fm", sourceId: "fixture-player" }],
        }),
        source: "saved",
        status: "lookup_follow_up",
      },
      request: {
        ...createInitialRequestState(),
        processedMessageId: message.id,
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const model = fakeModel().respond(
      new AIMessage({
        content: "The saved player result is complete.",
        response_metadata: { incomplete_details: null, status: "completed" },
      })
    );

    vi.spyOn(model, "getNumTokens").mockImplementation(async (text) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    });

    const graph = agentGraphTest.createAgentWithRuntime({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: testModelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = await graph.invoke(state, {
      configurable: { thread_id: "saved-lookup-completed-response" },
    });

    expect({
      failure: result.faultTolerance.failure,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      failure: null,
      response: "The saved player result is complete.",
    });
  });

  it("renders a committed result after a provider context-overflow response", async () => {
    const message = new HumanMessage({
      content: "Explain the saved comparison.",
      id: "saved-comparison-provider-overflow",
    });

    const { resultJson } = comparisonEvidenceTest.comparisonFixture();

    const state = AgentState.parse({
      messages: [message],
      outcome: {
        kind: "player_comparison",
        resultJson,
        source: "saved",
        status: "ready",
      },
      request: {
        ...createInitialRequestState(),
        processedMessageId: message.id,
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const model = fakeModel().respond(
      Object.assign(
        new Error("The request exceeds the maximum context length."),
        {
          code: "context_length_exceeded",
          status: 400,
        }
      )
    );

    vi.spyOn(model, "getNumTokens").mockImplementation(async (text) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    });

    const graph = agentGraphTest.createAgentWithRuntime({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: testModelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = await graph.invoke(state, {
      configurable: { thread_id: "saved-result-provider-overflow" },
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect(answer).toContain(resultJson);
    expect(answer).toContain("解释未完成");
    expect(result.faultTolerance.failure).toMatchObject({
      category: "context_limit",
      contextIssue: "provider_overflow",
      node: "answer",
    });
  });
});
