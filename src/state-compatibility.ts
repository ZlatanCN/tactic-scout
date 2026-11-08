import { AIMessage, HumanMessage } from "@langchain/core/messages";

import type { AgentStateType } from "./state.js";
import {
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "./state.js";

const isFreshUnversionedState = (state: AgentStateType): boolean => {
  const conversationContext =
    state.conversationContext ?? createInitialConversationContext();

  const request = state.request ?? createInitialRequestState();

  const hasNoSavedWorkflowResults = [
    conversationContext.activeLookup === null,
    conversationContext.activeComparison.resultJson.length === 0,
    conversationContext.activeComparison.players.length === 0,
    conversationContext.activeRecommendation === null,
    conversationContext.activeTeamRecommendation === null,
  ].every(Boolean);

  const hasNoResolvedConversationReferences =
    conversationContext.focusPlayers.length === 0 &&
    conversationContext.playerAliases.length === 0;

  const hasNoExistingTurnWork = [
    request.kind === "other",
    request.processedMessageId === null,
    state.outcome === null || state.outcome === undefined,
    state.pendingClarification === null ||
      state.pendingClarification === undefined,
    state.playerMemoryManagementRequest === null ||
      state.playerMemoryManagementRequest === undefined,
  ].every(Boolean);

  const [onlyMessage] = state.messages;

  return [
    hasNoSavedWorkflowResults,
    hasNoResolvedConversationReferences,
    hasNoExistingTurnWork,
    state.messages.length === 1,
    onlyMessage instanceof HumanMessage,
  ].every(Boolean);
};

const stateCompatibilityUpdate = (
  state: AgentStateType
): Partial<AgentStateType> | null => {
  const storedVersion = state.stateSchemaVersion ?? null;
  const versionMatches = storedVersion === agentStateSchemaVersion;

  const isFreshUnversioned =
    storedVersion === null && isFreshUnversionedState(state);

  if (versionMatches || isFreshUnversioned) {
    return null;
  }

  return {
    messages: [
      new AIMessage(
        `这个对话使用的状态版本（${storedVersion ?? "未知"}）与当前应用版本 ${agentStateSchemaVersion} 不兼容。历史记录仍可查看；请新建 thread 继续。此次请求没有执行，也没有修改球员记忆。`
      ),
    ],
    outcome: {
      kind: "state_compatibility",
      resultJson: JSON.stringify({
        currentVersion: agentStateSchemaVersion,
        storedVersion,
      }),
      status: "incompatible",
    },
  };
};

export { stateCompatibilityUpdate };
