import type { GraphNode } from "@langchain/langgraph";

import { activeComparisonContext } from "../comparison-context.js";
import { createModelRequestBudget } from "../model-requests.js";
import { latestHumanMessage, messageText } from "../player-mentions.js";
import {
  requestFromCurrentTurn,
  workflowDraftFromExtraction,
} from "../request-building.js";
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
  savedOutcomeForWorkflow,
} from "../workflow-continuation.js";
import type { WorkflowKind } from "../workflow-continuation.js";

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

    const extracted = await extractRequest(
      text,
      contextWithComparison,
      budget,
      previous
    );

    if (extracted.kind === null) {
      const choice = continuationChoice(
        state,
        contextWithComparison,
        extracted,
        previous
      );

      if (choice.requiresConfirmation || choice.options.length > 1) {
        const labels: Record<WorkflowKind, string> = {
          player_comparison: "球员比较",
          player_lookup: "球员查询",
          player_recommendation: "球员推荐",
          team_recommendation: "球队推荐",
        };

        const optionsText = choice.options
          .map((workflow, index) => `${index + 1}. ${labels[workflow]}`)
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
            draft: workflowDraftFromExtraction(
              extracted,
              text,
              messageId,
              contextWithComparison
            ),
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
        extracted,
        workflow,
        contextWithComparison,
        text,
        messageId
      );

      const outcome =
        workflow !== "other" && extracted.continuationAction === "explain"
          ? savedOutcomeForWorkflow(workflow, contextWithComparison)
          : built.outcome;

      return {
        conversationContext: contextWithComparison,
        faultTolerance: createInitialFaultToleranceState(),
        outcome,
        pendingClarification: null,
        request: built.request,
      };
    }

    const built = requestFromCurrentTurn(
      extracted,
      extracted.kind,
      contextWithComparison,
      text,
      messageId
    );

    const outcome =
      extracted.kind !== "other" && extracted.continuationAction === "explain"
        ? savedOutcomeForWorkflow(extracted.kind, contextWithComparison)
        : built.outcome;

    return {
      conversationContext: contextWithComparison,
      faultTolerance: createInitialFaultToleranceState(),
      outcome,
      pendingClarification: null,
      request: built.request,
    };
  };

export { createRequestUnderstandingNode };
