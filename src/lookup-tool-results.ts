import { AIMessage, ToolMessage } from "@langchain/core/messages";

import {
  lookupToolCallExecutionKey,
  lookupToolCallId,
} from "./lookup-tool-call-id.js";
import { messagesInCurrentTurn } from "./player-mentions.js";
import type { AgentStateType } from "./state.js";

const reusableLookupToolMessagesFor = (
  state: AgentStateType,
  message: AIMessage
): ToolMessage[] | null => {
  const messages = messagesInCurrentTurn(state.messages);

  const successfulResultsByCallId = new Map(
    messages.flatMap((item) =>
      item instanceof ToolMessage &&
      item.name === "search_player_records" &&
      item.status !== "error"
        ? [[item.tool_call_id, item] as const]
        : []
    )
  );

  const resultsByExecutionKey = new Map(
    messages.flatMap((item) =>
      item instanceof AIMessage
        ? (item.tool_calls ?? []).flatMap((call) => {
            const result =
              call.name === "search_player_records" && call.id !== undefined
                ? successfulResultsByCallId.get(call.id)
                : undefined;

            return result === undefined
              ? []
              : [[lookupToolCallExecutionKey(call), result] as const];
          })
        : []
    )
  );

  const calls = message.tool_calls ?? [];

  if (calls.length === 0) {
    return null;
  }

  const results = calls.map((call) => {
    if (call.name !== "search_player_records") {
      return null;
    }

    const result = resultsByExecutionKey.get(lookupToolCallExecutionKey(call));

    return result === undefined
      ? null
      : new ToolMessage({
          content: result.content,
          name: result.name,
          status: result.status,
          tool_call_id: lookupToolCallId(call),
        });
  });

  return results.some((result) => result === null)
    ? null
    : results.filter((result): result is ToolMessage => result !== null);
};

const lookupCallsCanReuseCompletedResults = (
  state: AgentStateType,
  message: AIMessage
): boolean => reusableLookupToolMessagesFor(state, message) !== null;

export { lookupCallsCanReuseCompletedResults, reusableLookupToolMessagesFor };
