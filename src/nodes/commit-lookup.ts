import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { selectedReferenceCandidate } from "../player-data/contracts.js";
import type {
  AgentState,
  AgentStateType,
  ConversationPlayerReference,
} from "../state.js";

const lookupResultSchema = z.object({
  fm: z.object({ status: z.string() }).optional(),
  understat: z.object({ status: z.string() }).optional(),
});

const currentTurnMessages = (messages: AgentStateType["messages"]) => {
  let latestUserMessageIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index] instanceof HumanMessage) {
      latestUserMessageIndex = index;
      break;
    }
  }

  return latestUserMessageIndex < 0
    ? messages
    : messages.slice(latestUserMessageIndex);
};

const hasSearchData = (message: ToolMessage): boolean => {
  const content = z.string().safeParse(message.content);

  if (!content.success) {
    return false;
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(content.data);
  } catch {
    return false;
  }

  const result = lookupResultSchema.safeParse(parsedJson);

  return (
    result.success &&
    (result.data.fm?.status === "found" ||
      result.data.understat?.status === "found")
  );
};

const resolvedReference = (
  state: AgentStateType,
  playerIndex: number
): ConversationPlayerReference | null => {
  const player = state.request.players[playerIndex];

  const candidate =
    player === undefined ? null : selectedReferenceCandidate(player.resolution);

  return candidate === null
    ? null
    : {
        candidate,
        referenceId: candidate.canonicalIdentityId ?? candidate.candidateId,
      };
};

const createCommitLookupResultsNode =
  (): GraphNode<typeof AgentState> => (state) => {
    const latestSearchResult = currentTurnMessages(state.messages).findLast(
      (message): message is ToolMessage =>
        message instanceof ToolMessage &&
        message.name === "search_player_records" &&
        hasSearchData(message)
    );

    if (latestSearchResult === undefined) {
      return {};
    }

    const lookupReference =
      state.request.players.length === 1 ? resolvedReference(state, 0) : null;

    let { activeLookup } = state.conversationContext;

    if (lookupReference !== null) {
      const resultJson = z.string().safeParse(latestSearchResult.content);

      if (resultJson.success) {
        activeLookup = { player: lookupReference, resultJson: resultJson.data };
      }
    }

    const focusPlayers = state.request.players.flatMap((_, index) => {
      const reference = resolvedReference(state, index);

      return reference === null ? [] : [reference];
    });

    return {
      conversationContext: {
        ...state.conversationContext,
        activeLookup,
        focusPlayers,
      },
    };
  };

export { createCommitLookupResultsNode };
