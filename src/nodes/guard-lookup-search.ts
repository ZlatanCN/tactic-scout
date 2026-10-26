import { AIMessage } from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { logFaultEvent } from "../fault-tolerance.js";
import type { AgentState } from "../state.js";

const lookupSearchLimit = 3;
const toolCallIdSchema = z.object({ id: z.string().min(1) });

type ToolCallIdentity = { id?: string };

const toolCallId = (call: ToolCallIdentity): string =>
  toolCallIdSchema.parse(call).id;

const createGuardLookupSearchNode =
  (): GraphNode<typeof AgentState> => (state, runtime) => {
    const lastMessage = state.messages.at(-1);

    if (!(lastMessage instanceof AIMessage)) {
      return {};
    }

    const toolCalls = lastMessage.tool_calls ?? [];

    const remaining = Math.max(
      0,
      lookupSearchLimit - state.faultTolerance.lookupSearchExecutions
    );

    const blockedCalls = toolCalls.slice(remaining);

    const executions =
      state.faultTolerance.lookupSearchExecutions +
      Math.min(toolCalls.length, remaining);

    if (blockedCalls.length > 0) {
      logFaultEvent({
        attempt: executions,
        category: "attempt_limit",
        durationMs: 0,
        event: "exhausted",
        executionCount: executions,
        node: "lookup_tools_guard",
        runId: runtime.executionInfo?.runId,
        threadId: runtime.executionInfo?.threadId,
      });
    }

    return {
      faultTolerance: {
        ...state.faultTolerance,
        lookupLimitReached: blockedCalls.length > 0,
        lookupSearchExecutions: executions,
        lookupToolCallIds: blockedCalls.map(toolCallId),
      },
    };
  };

export { createGuardLookupSearchNode };
