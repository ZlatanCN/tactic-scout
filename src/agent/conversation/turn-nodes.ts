import { Command, interrupt } from "@langchain/langgraph";
import { createConfiguredHistoricalArchive } from "../../data/historical-archive-enrichment.js";
import { type ExternalSignalCoverage } from "../../domain/schemas.js";
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
  return { referenceNameResolution: null, referenceProfiles: [], replacementReferencePosition: null,
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
      ...(positionChange.changed ? { confirmedPosition: positionChange.position } : {}),
      ...(referenceChanged ? resetReference(state.userMessage) : {}),
    };
  };
}

export const waitForUser = (state: State) => {
  const pendingQuestion = state.pendingQuestion;
  if (!pendingQuestion) {
    return new Command({ goto: "choose_next_action" });
  }
  const answer = interrupt({ question: pendingQuestion.question, reason: pendingQuestion.reason });
  const answerText = String(answer);
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
      ...(positionChange.changed ? { confirmedPosition: positionChange.position } : {}),
      ...(referenceChanged ? resetReference(answerText) : {}),
    },
    goto: "choose_next_action",
  });
};
