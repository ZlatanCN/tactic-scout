import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { GraphNode } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod/v4";

import { lookupToolCallId } from "../lookup-tool-call-id.js";
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

    let toolMessages: ToolMessage[] = [];

    if (allowedCalls.length > 0) {
      const parsedToolResult = toolNodeResultSchema.safeParse(
        await toolNode.invoke(
          {
            ...state,
            messages: [
              ...state.messages.slice(0, -1),
              new AIMessage({
                content: lastMessage.content,
                id: lastMessage.id,
                tool_calls: allowedCalls,
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

    return {
      messages: toolCalls.map((call) => {
        const id = lookupToolCallId(call);
        const result = resultByCallId.get(id);

        if (result !== undefined) {
          return result;
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
