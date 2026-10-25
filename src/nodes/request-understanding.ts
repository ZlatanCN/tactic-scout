import type { GraphNode } from "@langchain/langgraph";

import {
  activeComparisonContext,
  mergeComparisonConstraints,
  requestPlayerFromReference,
} from "../comparison-context.js";
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

    const contextWithComparison = {
      ...conversationContext,
      activeComparison: activeComparisonContext(
        state.messages,
        conversationContext
      ),
    };

    const latestUserMessage = latestHumanMessage(state.messages);

    if (!latestUserMessage) {
      return {};
    }

    const messageId = latestUserMessage.id ?? null;

    if (messageId !== null && messageId === currentRequest.processedMessageId) {
      return {};
    }

    const text = messageText(latestUserMessage);
    const extracted = await extractRequest(text, contextWithComparison);

    const confirmedAliases = findConfirmedPlayerAliasesInMessage(
      text,
      contextWithComparison
    );

    const extractedPlayers = [
      ...extracted.players,
      ...confirmedAliases.map((mention) => ({
        lookupName: null,
        mention,
        referenceScope: "explicit" as const,
      })),
    ];

    const isComparisonAddition =
      extracted.kind === "player_comparison" &&
      extracted.comparisonAction === "add";

    const inheritedComparisonPlayers = isComparisonAddition
      ? contextWithComparison.activeComparison.players.map(
          requestPlayerFromReference
        )
      : [];

    let { constraints } = extracted;

    if (extracted.kind === "player_comparison") {
      constraints = mergeComparisonConstraints(
        isComparisonAddition
          ? contextWithComparison.activeComparison.constraints
          : [],
        extracted.constraints
      );
    }

    const currentTurnPlayers = normalizeExtractedPlayers(
      text,
      extractedPlayers
    ).map((player) => ({
      ...player,
      attempts: 0,
      resolution: null,
    }));

    const players = [...inheritedComparisonPlayers, ...currentTurnPlayers];

    return {
      conversationContext: contextWithComparison,
      request: {
        activePlayerIndex: null,
        clarificationMessage: null,
        comparisonAction: extracted.comparisonAction ?? "replace",
        constraints,
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
