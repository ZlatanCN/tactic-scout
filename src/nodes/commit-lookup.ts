import { ToolMessage } from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { logLocalDataFailure } from "../fault-tolerance.js";
import { selectedReferenceCandidate } from "../player-data/contracts.js";
import { searchPlayerRecordsResultSchema } from "../player-data/search-records.js";
import { messagesInCurrentTurn } from "../player-mentions.js";
import type {
  AgentState,
  AgentStateType,
  ConversationPlayerReference,
} from "../state.js";
import { decodeResultJson } from "../workflow-results.js";

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

    const blockedCallIds = new Set(state.faultTolerance.lookupToolCallIds);

    const latestSearchResult = messagesInCurrentTurn(state.messages).findLast(
      (message): message is ToolMessage =>
        message instanceof ToolMessage &&
        message.name === "search_player_records" &&
        !blockedCallIds.has(message.tool_call_id)
    );

    if (latestSearchResult === undefined) {
      const faultTolerance = {
        ...state.faultTolerance,
        lookupToolStartedAt: null,
      };

      return state.faultTolerance.lookupLimitReached
        ? {
            faultTolerance,
            outcome: {
              kind: "player_lookup",
              resultJson: null,
              status: "lookup_search_limit",
            },
          }
        : {
            faultTolerance,
          };
    }

    const content = z.string().parse(latestSearchResult.content);

    const { data: lookupResult, resultJson } = decodeResultJson(
      content,
      searchPlayerRecordsResultSchema
    );

    if ("result" in lookupResult) {
      return {
        faultTolerance: {
          ...state.faultTolerance,
          lookupToolStartedAt: null,
        },
        outcome: {
          kind: "player_lookup",
          resultJson: null,
          status: "no_confirmed_source_records",
        },
      };
    }

    if (lookupResult.fm === undefined && lookupResult.understat === undefined) {
      throw new Error(
        "The completed lookup result contains no queried source."
      );
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

    if (lookupReference !== null && !state.faultTolerance.lookupLimitReached) {
      activeLookup = { player: lookupReference, resultJson };
    }

    const focusPlayers = state.faultTolerance.lookupLimitReached
      ? state.conversationContext.focusPlayers
      : state.request.players.flatMap((_, index) => {
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
      outcome: state.faultTolerance.lookupLimitReached
        ? {
            kind: "player_lookup",
            resultJson: null,
            status: "lookup_search_limit",
          }
        : {
            kind: "player_lookup",
            resultJson,
            source: "executed",
            status: "data_ready",
          },
    };
  };

export { createCommitLookupResultsNode };
