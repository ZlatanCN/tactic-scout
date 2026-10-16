import { PlayerIdentityAnswerSchema, PositionSelectionAnswerSchema } from "../../domain/position-contracts.js";
import { positionSelectionLabel } from "../../domain/position-selection.js";
import { Command, interrupt } from "@langchain/langgraph";
import { selectPlayerIdentityCandidate } from "../../players/identity/name-resolver.js";
import { createConfiguredHistoricalArchive } from "../../sources/reep/historical-archive-enrichment.js";
import { type ExternalSignalCoverage } from "../../domain/external-evidence.js";
import { emptyToolUseCounts } from "../recruitment-actions.js";
import { extractExplicitTargetTeam } from "../target-team-context.js";
import { candidateSearchObservationIndexForIntent, hasCandidateSearchScopeChanged, resolvedCandidateSearchIntent } from "./candidate-context.js";
import { type State } from "./state.js";
import { replacementTargetMention } from "../replacement-target.js";
import { normalizeSearchText } from "../../domain/text-matching.js";
import { resolveCandidateSearchIntent } from "../candidate-search-intent.js";

function changesReference(state: State, message: string): boolean {
  const before = state.history.filter(entry => entry.role === "user").map(entry => entry.content);
  return before.length > 0 && normalizeSearchText(replacementTargetMention([...before, message]) ?? "")
    !== normalizeSearchText(replacementTargetMention(before) ?? "");
}

function resetReference(message: string): Partial<State> {
  return { confirmedPositions: [], referenceNameResolution: null, referenceProfiles: [], replacementReferencePosition: null,
    referenceResolutionQuery: null, inspectedReferenceMention: null,
    confirmedPosition: resolveCandidateSearchIntent({ userMessages: [message], confirmedPosition: null, latestMessage: message }).position };
}

export function createRecordUserTurnNode(input: {
  disabledPlayerEloCoverage: ExternalSignalCoverage;
  historicalArchiveSetup: ReturnType<typeof createConfiguredHistoricalArchive>;
}) {
  const { disabledPlayerEloCoverage, historicalArchiveSetup } = input;
  return (state: State): Partial<State> => {
    const positionIntent = resolvedCandidateSearchIntent(state, state.userMessage);
    const positionChange = positionIntent.latestPositionChange;
    const referenceChanged = changesReference(state, state.userMessage);
    const searchScopeChanged = referenceChanged || hasCandidateSearchScopeChanged(state.history, state.userMessage, state.confirmedPosition, state.replacementReferencePosition);
    const priorCandidateSearchIndex = !searchScopeChanged && positionIntent.position !== null
      ? candidateSearchObservationIndexForIntent(positionIntent, state.candidateSearchObservations)
      : null;
    const explicitTargetTeam = extractExplicitTargetTeam(state.userMessage);
    return {
      incomingPositions: null,
      candidateSearchTurnStartIndex: state.candidateSearchObservations.length,
      history: [{ role: "user" as const, content: state.userMessage }],
      ...(explicitTargetTeam ? { targetTeam: explicitTargetTeam } : {}),
      report: null,
      externalSignals: {},
      externalSignalCoverage: disabledPlayerEloCoverage,
      historicalArchiveSamplesByPlayerId: {},
      historicalArchiveCoverage: historicalArchiveSetup.coverage,
      responseMessage: "",
      pendingQuestion: null,
      decisionSteps: 0,
      toolUses: emptyToolUseCounts(),
      reviewAttempts: 0,
      reviewResult: "valid" as const,
      forcedLimitReached: false,
      hasSearchedMethodology: false,
      hasSearchedPlayerReports: false,
      methodologySearchFailed: false,
      successfulMethodologyQueries: {},
      playerReportSearchFailed: false,
      sourceAccessFailure: null,
      candidateSearchFailure: null,
      candidateSearchSucceededThisTurn: false,
      candidateSearchScopeChanged: searchScopeChanged,
      confirmedPositionNoMatchQuestionAsked: false,
      confirmedPositionNoMatchDeclined: false,
      positionBroadeningApproved: false,
      roleClarificationAsked: false,
      replacementPositionClarificationAsked: false,
      policyBlocked: false,
      policyBlockedRepeatCount: 0,
      policyLoopStopped: false,
      searchedReportPlayerNames: [],
      retrievedKnowledge: {},
      confirmedPositionSearchObservationIndex: priorCandidateSearchIndex,
      ...(positionChange.changed ? { confirmedPosition: positionChange.position, confirmedPositions: [] } : {}),
      ...(referenceChanged ? resetReference(state.userMessage) : {}),
      ...(state.incomingPositions?.length ? { confirmedPositions: state.incomingPositions, confirmedPosition: state.incomingPositions[0], candidateSearchScopeChanged: true, confirmedPositionSearchObservationIndex: null, roleClarificationAsked: true } : {}),
    };
  };
}

export const waitForUser = (state: State) => {
  const pendingQuestion = state.pendingQuestion;
  if (!pendingQuestion) {
    return new Command({ goto: "choose_next_action" });
  }
  const answer = interrupt({ question: pendingQuestion.question, reason: pendingQuestion.reason });
  const selection = PositionSelectionAnswerSchema.safeParse(answer);
  const identityAnswer = PlayerIdentityAnswerSchema.safeParse(answer);
  if (selection.success) {
    if (pendingQuestion.input?.kind !== "positions" || selection.data.questionId !== pendingQuestion.input.questionId) throw new Error("位置问题已经更新，请重新选择。");
    if (selection.data.keepCurrent) {
      if (!pendingQuestion.input?.allowKeepCurrent) throw new Error("当前问题不支持保留位置并结束。");
      return new Command({ update: { history: [{ role: "user" as const, content: "保留当前的位置范围并结束本轮。" }], pendingQuestion: null, responseMessage: "", confirmedPositionNoMatchDeclined: true }, goto: "choose_next_action" });
    }
    return new Command({
      update: {
        history: [{ role: "user" as const, content: `已选择：${positionSelectionLabel(selection.data.positions)}；寻找符合其中任一位置的球员。` }],
        confirmedPositions: selection.data.positions,
        confirmedPosition: selection.data.positions[0],
        candidateSearchTurnStartIndex: state.candidateSearchObservations.length,
        candidateSearchScopeChanged: true,
        confirmedPositionSearchObservationIndex: null,
        pendingQuestion: null,
        responseMessage: "",
        decisionSteps: 0,
        toolUses: emptyToolUseCounts(),
        successfulMethodologyQueries: {},
        candidateSearchSucceededThisTurn: false,
        candidateSearchFailure: null,
        confirmedPositionNoMatchQuestionAsked: false,
        confirmedPositionNoMatchDeclined: false,
        positionBroadeningApproved: false,
        roleClarificationAsked: true,
      },
      goto: "choose_next_action",
    });
  }
  if (identityAnswer.success) {
    const previousResolution = state.referenceNameResolution;
    if (pendingQuestion.input?.kind !== "player_identity" || identityAnswer.data.questionId !== pendingQuestion.input.questionId) {
      throw new Error("球员身份问题已经更新，请重新选择。");
    }
    const resolved = previousResolution && selectPlayerIdentityCandidate(previousResolution, identityAnswer.data.entityId);
    if (!resolved || resolved.status !== "resolved") throw new Error("所选球员不属于当前身份候选，请重新选择。");
    return new Command({
      update: {
        history: [{ role: "user" as const, content: `已确认参考球员：${resolved.player.preferredName}。` }],
        referenceNameResolution: resolved,
        referenceResolutionQuery: null,
        inspectedReferenceMention: null,
        referenceProfiles: [],
        replacementReferencePosition: null,
        pendingQuestion: null,
        responseMessage: "",
        decisionSteps: 0,
        toolUses: emptyToolUseCounts(),
        successfulMethodologyQueries: {},
        candidateSearchSucceededThisTurn: false,
        candidateSearchFailure: null,
        candidateSearchTurnStartIndex: state.candidateSearchObservations.length,
        candidateSearchScopeChanged: true,
        confirmedPositionSearchObservationIndex: null,
        confirmedPositionNoMatchQuestionAsked: false,
        confirmedPositionNoMatchDeclined: false,
        positionBroadeningApproved: false,
      },
      goto: "choose_next_action",
    });
  }
  const answerText = String(answer);
  if (pendingQuestion.input?.kind === "player_identity" && state.referenceNameResolution) {
    const typedSelection = resolveTypedIdentityChoice(state.referenceNameResolution, answerText);
    if (typedSelection) return new Command({
      update: {
        history: [{ role: "user" as const, content: `已确认参考球员：${typedSelection.player.preferredName}。` }],
        referenceNameResolution: typedSelection,
        referenceResolutionQuery: null,
        inspectedReferenceMention: null,
        referenceProfiles: [],
        replacementReferencePosition: null,
        pendingQuestion: null,
        responseMessage: "",
        decisionSteps: 0,
        toolUses: emptyToolUseCounts(),
        candidateSearchTurnStartIndex: state.candidateSearchObservations.length,
        candidateSearchScopeChanged: true,
        candidateSearchSucceededThisTurn: false,
        candidateSearchFailure: null,
      },
      goto: "choose_next_action",
    });
  }
  const answerIntent = resolvedCandidateSearchIntent({
    ...state,
    history: [...state.history, { role: "user", content: answerText }],
  }, answerText);
  const positionChange = answerIntent.latestPositionChange;
  const referenceChanged = changesReference(state, answerText);
  const searchScopeChanged = referenceChanged || hasCandidateSearchScopeChanged(state.history, answerText, state.confirmedPosition, state.replacementReferencePosition);
  const priorCandidateSearchIndex = !searchScopeChanged && positionChange.changed && answerIntent.position !== null
    ? candidateSearchObservationIndexForIntent(answerIntent, state.candidateSearchObservations)
    : null;
  const answeredEmptyPositionQuestion = state.confirmedPositionNoMatchQuestionAsked;
  return new Command({
    update: {
      history: [{ role: "user" as const, content: answerText }],
      candidateSearchTurnStartIndex: state.candidateSearchObservations.length,
      candidateSearchScopeChanged: searchScopeChanged,
      pendingQuestion: null,
      responseMessage: "",
      decisionSteps: 0,
      toolUses: emptyToolUseCounts(),
      successfulMethodologyQueries: {},
      confirmedPositionSearchObservationIndex: positionChange.changed
        ? priorCandidateSearchIndex
        : state.confirmedPositionSearchObservationIndex,
      confirmedPositionNoMatchQuestionAsked: positionChange.changed ? false : state.confirmedPositionNoMatchQuestionAsked,
      confirmedPositionNoMatchDeclined: answeredEmptyPositionQuestion && !positionChange.changed,
      candidateSearchSucceededThisTurn: false,
      positionBroadeningApproved: answeredEmptyPositionQuestion && positionChange.changed
        ? true
        : positionChange.changed ? false : state.positionBroadeningApproved,
      ...(positionChange.changed ? { confirmedPosition: positionChange.position, confirmedPositions: [] } : {}),
      ...(referenceChanged ? resetReference(answerText) : {}),
      ...(pendingQuestion.input?.kind === "player_identity" && !referenceChanged ? {
        referenceNameResolution: null,
        referenceResolutionQuery: answerText,
        inspectedReferenceMention: null,
        referenceProfiles: [],
        replacementReferencePosition: null,
      } : {}),
    },
    goto: "choose_next_action",
  });
};

function resolveTypedIdentityChoice(
  resolution: NonNullable<State["referenceNameResolution"]>,
  answer: string,
): Extract<NonNullable<State["referenceNameResolution"]>, { status: "resolved" }> | null {
  if (resolution.status !== "ambiguous" && resolution.status !== "needs_confirmation") return null;
  const normalized = answer.normalize("NFKC").trim().toLocaleLowerCase();
  const number = normalized.match(/^(?:第\s*)?(\d+)(?:\s*(?:个|位|名))?$/)?.[1];
  const indexed = number ? resolution.candidates[Number(number) - 1] : undefined;
  const named = resolution.candidates.filter(candidate => candidate.names.some(name =>
    normalizeSearchText(name) === normalizeSearchText(answer)));
  const selected = indexed ?? (named.length === 1 ? named[0] : undefined);
  const result = selected ? selectPlayerIdentityCandidate(resolution, selected.entityId) : null;
  return result?.status === "resolved" ? result : null;
}
