import { ToolMessage } from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { logLocalDataFailure } from "../fault-tolerance.js";
import { selectedReferenceCandidate } from "../player-data/contracts.js";
import { messagesInCurrentTurn } from "../player-mentions.js";
import type {
  AgentState,
  AgentStateType,
  ConversationPlayerReference,
} from "../state.js";

const lookupResultSchema = z.object({
  fm: z.object({ status: z.string() }).optional(),
  understat: z.object({ status: z.string() }).optional(),
});

const lookupResultFromToolMessage = (message: ToolMessage) => {
  const content = z.string().safeParse(message.content);

  if (!content.success) {
    return null;
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(content.data);
  } catch {
    return null;
  }

  const result = lookupResultSchema.safeParse(parsedJson);

  return result.success &&
    (result.data.fm !== undefined || result.data.understat !== undefined)
    ? result.data
    : null;
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
  (): GraphNode<typeof AgentState> => (state, runtime) => {
    if (state.faultTolerance.lookupToolStartedAt === null) {
      return {};
    }

    const latestSearchResult = messagesInCurrentTurn(state.messages).findLast(
      (message): message is ToolMessage =>
        message instanceof ToolMessage &&
        message.name === "search_player_records" &&
        lookupResultFromToolMessage(message) !== null
    );

    if (latestSearchResult === undefined) {
      return {
        faultTolerance: {
          ...state.faultTolerance,
          lookupToolStartedAt: null,
        },
      };
    }

    const lookupResult = lookupResultFromToolMessage(latestSearchResult);

    if (lookupResult === null) {
      throw new Error("The completed lookup result failed validation.");
    }

    const localDataUnavailable =
      lookupResult.fm?.status === "unavailable" ||
      lookupResult.understat?.status === "unavailable";

    if (localDataUnavailable) {
      logLocalDataFailure(
        "commit_lookup",
        runtime,
        state.faultTolerance.lookupToolStartedAt === null
          ? 0
          : Date.now() - state.faultTolerance.lookupToolStartedAt,
        state.faultTolerance.lookupSearchExecutions,
        state.faultTolerance.lookupSearchExecutions
      );

      return {
        faultTolerance: {
          ...state.faultTolerance,
          lookupToolStartedAt: null,
        },
        outcome: {
          kind: "player_lookup",
          resultJson: null,
          status: "data_unavailable",
        },
      };
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
      faultTolerance: {
        ...state.faultTolerance,
        lookupToolStartedAt: null,
      },
    };
  };

export { createCommitLookupResultsNode };
