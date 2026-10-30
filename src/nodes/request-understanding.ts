import type { GraphNode } from "@langchain/langgraph";

import { activeComparisonContext } from "../comparison-context.js";
import { createModelRequestBudget } from "../model-requests.js";
import { latestHumanMessage, messageText } from "../player-mentions.js";
import {
  isBlockedLookupFollowUp,
  isLookupFollowUpRequest,
  requestFromCurrentTurn,
  workflowDraftFromExtraction,
} from "../request-building.js";
import type { RequestTurnInput } from "../request-building.js";
import type { RequestUnderstandingExtractor } from "../request-extraction.js";
import type { AgentState } from "../state.js";
import {
  createInitialConversationContext,
  createInitialFaultToleranceState,
  createInitialRequestState,
} from "../state.js";
import {
  continuationChoice,
  previousTurnSummary,
  savedResultUnavailable,
  savedOutcomeForTurn,
  workflowLabels,
} from "../workflow-continuation.js";

const createRequestUnderstandingNode =
  (
    extractRequest: RequestUnderstandingExtractor
  ): GraphNode<typeof AgentState> =>
  async (state, runtime) => {
    const currentRequest = state.request ?? createInitialRequestState();

    const conversationContext =
      state.conversationContext ?? createInitialConversationContext();

    const contextWithComparison = {
      ...conversationContext,
      activeComparison: activeComparisonContext(conversationContext),
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
    const budget = createModelRequestBudget(runtime, "understand_request");
    const previous = previousTurnSummary(state);

    const rawExtracted = await extractRequest(
      text,
      contextWithComparison,
      budget,
      previous
    );

    if (
      isBlockedLookupFollowUp(
        state,
        contextWithComparison,
        rawExtracted,
        previous,
        text
      )
    ) {
      const built = requestFromCurrentTurn(
        {
          context: contextWithComparison,
          extracted: rawExtracted,
          messageId,
          text,
        } satisfies RequestTurnInput,
        "player_lookup"
      );

      return {
        conversationContext: contextWithComparison,
        faultTolerance: createInitialFaultToleranceState(),
        outcome: savedResultUnavailable("player_lookup"),
        pendingClarification: null,
        request: built.request,
      };
    }

    const extracted =
      (rawExtracted.kind === "player_lookup" ||
        rawExtracted.kind === "other") &&
      isLookupFollowUpRequest(rawExtracted, text, contextWithComparison)
        ? {
            ...rawExtracted,
            continuationAction: "explain" as const,
            kind: null,
          }
        : rawExtracted;

    if (extracted.kind === null) {
      const choice = continuationChoice(
        state,
        contextWithComparison,
        extracted,
        previous
      );

      if (choice.requiresConfirmation || choice.options.length > 1) {
        const optionsText = choice.options
          .map((workflow, index) => `${index + 1}. ${workflowLabels[workflow]}`)
          .join("；");

        const question =
          choice.options.length === 1
            ? `上一轮请求未能理解。请确认是否将这次修改应用到${optionsText}，回复 1 确认。`
            : `你这次的修改可能指向多个已完成结果：${optionsText}。请选择一个编号。`;

        return {
          conversationContext: contextWithComparison,
          faultTolerance: createInitialFaultToleranceState(),
          outcome: null,
          pendingClarification: {
            answer: null,
            draft: workflowDraftFromExtraction({
              context: contextWithComparison,
              extracted,
              messageId,
              text,
            }),
            kind: "workflow",
            options: choice.options,
            question,
          },
          request: {
            ...createInitialRequestState(),
            processedMessageId: messageId,
          },
        };
      }

      const workflow = choice.workflow ?? "other";

      const built = requestFromCurrentTurn(
        {
          context: contextWithComparison,
          extracted,
          messageId,
          text,
        },
        workflow
      );

      let { outcome } = built;

      if (workflow !== "other" && extracted.continuationAction === "explain") {
        outcome = savedOutcomeForTurn(
          state,
          contextWithComparison,
          previous,
          workflow,
          extracted,
          text
        );
      }

      return {
        conversationContext: contextWithComparison,
        faultTolerance: createInitialFaultToleranceState(),
        outcome,
        pendingClarification: null,
        request: built.request,
      };
    }

    const built = requestFromCurrentTurn(
      {
        context: contextWithComparison,
        extracted,
        messageId,
        text,
      },
      extracted.kind
    );

    let { outcome } = built;

    if (
      extracted.kind !== "other" &&
      extracted.continuationAction === "explain"
    ) {
      outcome = savedOutcomeForTurn(
        state,
        contextWithComparison,
        previous,
        extracted.kind,
        extracted,
        text
      );
    }

    return {
      conversationContext: contextWithComparison,
      faultTolerance: createInitialFaultToleranceState(),
      outcome,
      pendingClarification: null,
      request: built.request,
    };
  };

export { createRequestUnderstandingNode };
