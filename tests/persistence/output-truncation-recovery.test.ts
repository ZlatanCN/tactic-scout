import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { AgentState } from "../../src/state.js";
import {
  requestJson,
  startDevServerSession,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";

const readAgentState = async (baseUrl: string, threadId: string) => {
  const response = await requestJson(
    baseUrl,
    `/threads/${threadId}/state`,
    z.looseObject({ values: z.unknown().optional() })
  );

  if (response.values === undefined) {
    throw new Error("The truncation thread has no state values.");
  }

  return AgentState.parse(response.values);
};

describe("output truncation persistence", () => {
  it("does not consume a partial structured request or call data providers", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/provider-overflow-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;
    const thread = await managedDevServerTest.createAgentThread(baseUrl);
    const message = "Look up Harry Kane.";
    const messageId = "request-output-truncation";

    gateway.truncateModelCallsAt([1]);

    try {
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        message,
        messageId
      );

      const state = await readAgentState(baseUrl, thread.thread_id);

      const answer = state.messages
        .filter(({ type }) => type === "ai")
        .map(({ content }) => z.string().safeParse(content))
        .find((content) => content.success)?.data;

      const partialResponseStored = state.messages.some(({ content }) => {
        const parsedContent = z.string().safeParse(content);

        return (
          parsedContent.success &&
          parsedContent.data.includes("PARTIAL_TRUNCATED_GATEWAY_RESPONSE")
        );
      });

      expect({
        activeLookup: state.conversationContext.activeLookup,
        answerMentionsTruncation: answer?.includes(
          "未将不完整内容作为最终答案"
        ),
        failure: state.faultTolerance.failure,
        gatewayCalls: gateway.calls().length,
        partialResponseStored,
        providerEvents: gateway.events(),
        requestKind: state.request.kind,
        truncatedResponses: gateway.truncatedResponses(),
      }).toStrictEqual({
        activeLookup: null,
        answerMentionsTruncation: true,
        failure: {
          category: "context_limit",
          contextIssue: "response_truncated",
          node: "understand_request",
        },
        gatewayCalls: 1,
        partialResponseStored: false,
        providerEvents: [],
        requestKind: "other",
        truncatedResponses: [
          {
            callNumber: 1,
            finishReason: "length",
            usage: {
              completion_tokens: 256,
              prompt_tokens: 101,
              total_tokens: 357,
            },
          },
        ],
      });
    } finally {
      await session.close();
    }
  }, 60_000);
});
