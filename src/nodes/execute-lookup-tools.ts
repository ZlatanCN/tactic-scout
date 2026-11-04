import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { GraphNode } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod/v4";

import {
  lookupToolCallExecutionKey,
  lookupToolCallId,
} from "../lookup-tool-call-id.js";
import type { AgentState } from "../state.js";

const toolNodeResultSchema = z.object({
  messages: z.array(z.instanceof(ToolMessage)),
});

const createExecuteLookupToolsNode = (
  lookupTool: StructuredToolInterface | undefined
): GraphNode<typeof AgentState> => {
  const toolNode = new ToolNode(lookupTool === undefined ? [] : [lookupTool], {
    handleToolErrors: false,
  });

  return async (state, runtime) => {
    const lastMessage = state.messages.at(-1);

    if (!(lastMessage instanceof AIMessage)) {
      throw new TypeError(
        "lookup_tools requires the model's tool-call message."
      );
    }

    const blockedCallIds = new Set(state.faultTolerance.lookupToolCallIds);
    const toolCalls = lastMessage.tool_calls ?? [];

    const allowedCalls = toolCalls.filter(
      (call) => !blockedCallIds.has(lookupToolCallId(call))
    );

    const uniqueAllowedCalls = [
      ...new Map(
        allowedCalls.map((call) => [lookupToolCallExecutionKey(call), call])
      ).values(),
    ];

    let toolMessages: ToolMessage[] = [];

    if (uniqueAllowedCalls.length > 0) {
      const parsedToolResult = toolNodeResultSchema.safeParse(
        await toolNode.invoke(
          {
            ...state,
            messages: [
              ...state.messages.slice(0, -1),
              new AIMessage({
                content: lastMessage.content,
                id: lastMessage.id,
                tool_calls: uniqueAllowedCalls,
              }),
            ],
          },
          { signal: runtime.signal }
        )
      );

      if (!parsedToolResult.success) {
        throw new Error("LangGraph ToolNode returned an invalid result.");
      }

      toolMessages = parsedToolResult.data.messages;
    }

    const resultByCallId = new Map(
      toolMessages.map((message) => [message.tool_call_id, message])
    );

    const resultByExecutionKey = new Map(
      uniqueAllowedCalls.flatMap((call) => {
        const result = resultByCallId.get(lookupToolCallId(call));

        return result === undefined
          ? []
          : [[lookupToolCallExecutionKey(call), result] as const];
      })
    );

    return {
      messages: toolCalls.map((call) => {
        const id = lookupToolCallId(call);

        const result =
          resultByCallId.get(id) ??
          resultByExecutionKey.get(lookupToolCallExecutionKey(call));

        if (result !== undefined) {
          return result.tool_call_id === id
            ? result
            : new ToolMessage({
                content: result.content,
                name: result.name,
                status: result.status,
                tool_call_id: id,
              });
        }

        if (blockedCallIds.has(id)) {
          return new ToolMessage({
            content: "本轮搜索次数已达上限，该搜索未执行。",
            name: call.name,
            status: "error",
            tool_call_id: id,
          });
        }

        throw new Error(`lookup_tools did not return ${id}.`);
      }),
    };
  };
};

export { createExecuteLookupToolsNode };
