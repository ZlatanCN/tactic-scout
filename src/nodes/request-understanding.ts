import type { GraphNode } from "@langchain/langgraph";

import {
  findConfirmedPlayerAliasesInMessage,
  latestHumanMessage,
  messageText,
} from "../player-mentions.js";
import type { RequestUnderstandingExtractor } from "../request-extraction.js";
import {
  normalizeExtractedPlayers,
  uniqueText,
} from "../request-extraction.js";
import type { AgentState } from "../state.js";
import {
  createInitialConversationContext,
  createInitialRequestState,
} from "../state.js";

const createRequestUnderstandingNode =
  (
    extractRequest: RequestUnderstandingExtractor
  ): GraphNode<typeof AgentState> =>
  async (state) => {
    const currentRequest = state.request ?? createInitialRequestState();

    const conversationContext =
      state.conversationContext ?? createInitialConversationContext();

    const latestUserMessage = latestHumanMessage(state.messages);

    if (!latestUserMessage) {
      return {};
    }

    const messageId = latestUserMessage.id ?? null;

    if (messageId !== null && messageId === currentRequest.processedMessageId) {
      return {};
    }

    const text = messageText(latestUserMessage);
    const extracted = await extractRequest(text, conversationContext);

    const confirmedAliases = findConfirmedPlayerAliasesInMessage(
      text,
      conversationContext
    );

    const extractedPlayers = [
      ...extracted.players,
      ...confirmedAliases.map((mention) => ({
        lookupName: null,
        mention,
        referenceScope: "explicit" as const,
      })),
    ];

    const players = normalizeExtractedPlayers(text, extractedPlayers).map(
      (player) => ({
        ...player,
        attempts: 0,
        resolution: null,
      })
    );

    return {
      request: {
        activePlayerIndex: null,
        clarificationMessage: null,
        constraints: extracted.constraints,
        kind: extracted.kind,
        players,
        processedMessageId: messageId,
        status: "not_processed",
        teams: uniqueText(extracted.teams),
      },
      requestAnswer: null,
    };
  };

export { createRequestUnderstandingNode };
