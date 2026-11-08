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
import { isExplicitPlayerMemoryManagementCommand } from "../request-extraction.js";
import type { RequestUnderstandingExtractor } from "../request-extraction.js";
import type { AgentState, AgentStateType } from "../state.js";
import {
  createInitialConversationContext,
  createInitialFaultToleranceState,
  createInitialPlayerMemoryStatus,
  createInitialRequestState,
} from "../state.js";
import {
  continuationChoice,
  previousTurnSummary,
  savedOutcomeForRequest,
  savedResultUnavailable,
  savedOutcomeForTurn,
  workflowLabels,
} from "../workflow-continuation.js";

const memoryManagementRequestUpdate = (
  state: AgentStateType,
  command: Awaited<
    ReturnType<RequestUnderstandingExtractor>
  >["playerMemoryManagement"],
  message: string,
  messageId: string | null,
  conversationContext: AgentStateType["conversationContext"]
): Partial<AgentStateType> | null => {
  if (
    command === undefined ||
    !isExplicitPlayerMemoryManagementCommand(message, command.action)
  ) {
    return null;
  }

  return {
    conversationContext,
    faultTolerance: createInitialFaultToleranceState(),
    outcome: null,
    pendingClarification: null,
    playerMemoryManagementRequest: {
      action: command.action,
      apiFootballPlayerId: command.apiFootballPlayerId ?? null,
      fmId: command.fmId ?? null,
      selectedTarget: null,
      targetKind: command.targetKind ?? null,
      targetMention: command.targetMention ?? null,
    },
    playerMemoryStatus: createInitialPlayerMemoryStatus(),
    request: state.request ?? {
      ...createInitialRequestState(),
      processedMessageId: messageId,
    },
  };
};

const blockedLookupRequestUpdate = (
  state: AgentStateType,
  context: AgentStateType["conversationContext"],
  extracted: Awaited<ReturnType<RequestUnderstandingExtractor>>,
  previous: ReturnType<typeof previousTurnSummary>,
  text: string,
  messageId: string | null
): Partial<AgentStateType> | null => {
  if (!isBlockedLookupFollowUp(state, context, extracted, previous, text)) {
    return null;
  }

  const built = requestFromCurrentTurn(
    { context, extracted, messageId, text } satisfies RequestTurnInput,
    "player_lookup"
  );

  return {
    conversationContext: context,
    faultTolerance: createInitialFaultToleranceState(),
    outcome: savedResultUnavailable("player_lookup"),
    pendingClarification: null,
    playerMemoryStatus: createInitialPlayerMemoryStatus(),
    request: built.request,
  };
};

const continuationRequestUpdate = (
  state: AgentStateType,
  context: AgentStateType["conversationContext"],
  extracted: Awaited<ReturnType<RequestUnderstandingExtractor>>,
  previous: ReturnType<typeof previousTurnSummary>,
  messageId: string | null,
  text: string
): Partial<AgentStateType> => {
  const choice = continuationChoice(state, context, extracted, previous);

  if (choice.requiresConfirmation || choice.options.length > 1) {
    const optionsText = choice.options
      .map((workflow, index) => `${index + 1}. ${workflowLabels[workflow]}`)
      .join("；");

    const question =
      choice.options.length === 1
        ? `上一轮请求未能理解。请确认是否将这次修改应用到${optionsText}，回复 1 确认。`
        : `你这次的修改可能指向多个已完成结果：${optionsText}。请选择一个编号。`;

    return {
      conversationContext: context,
      faultTolerance: createInitialFaultToleranceState(),
      outcome: null,
      pendingClarification: {
        answer: null,
        draft: workflowDraftFromExtraction({
          context,
          extracted,
          messageId,
          text,
        }),
        kind: "workflow",
        options: choice.options,
        question,
      },
      playerMemoryManagementRequest: null,
      playerMemoryStatus: createInitialPlayerMemoryStatus(),
      request: {
        ...createInitialRequestState(),
        processedMessageId: messageId,
      },
    };
  }

  const workflow = choice.workflow ?? "other";

  const built = requestFromCurrentTurn(
    { context, extracted, messageId, text },
    workflow
  );

  const outcome =
    workflow !== "other" && extracted.continuationAction === "explain"
      ? savedOutcomeForTurn(state, context, previous, workflow, extracted, text)
      : built.outcome;

  return {
    conversationContext: context,
    faultTolerance: createInitialFaultToleranceState(),
    outcome,
    pendingClarification: null,
    playerMemoryManagementRequest: null,
    playerMemoryStatus: createInitialPlayerMemoryStatus(),
    request: built.request,
  };
};

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

    const specialRequestUpdate =
      memoryManagementRequestUpdate(
        state,
        rawExtracted.playerMemoryManagement,
        text,
        messageId,
        contextWithComparison
      ) ??
      blockedLookupRequestUpdate(
        state,
        contextWithComparison,
        rawExtracted,
        previous,
        text,
        messageId
      );

    if (specialRequestUpdate !== null) {
      return specialRequestUpdate;
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
      return continuationRequestUpdate(
        state,
        contextWithComparison,
        extracted,
        previous,
        messageId,
        text
      );
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
      outcome = savedOutcomeForRequest(
        extracted.kind,
        contextWithComparison,
        extracted,
        text
      );
    }

    return {
      conversationContext: contextWithComparison,
      faultTolerance: createInitialFaultToleranceState(),
      outcome,
      pendingClarification: null,
      playerMemoryStatus: createInitialPlayerMemoryStatus(),
      request: built.request,
    };
  };

export { createRequestUnderstandingNode };
