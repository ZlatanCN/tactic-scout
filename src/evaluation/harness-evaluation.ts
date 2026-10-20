import type { RecruitmentTraceEvent } from "../recruitment/conversation.js";
import { type ToolActionName } from "../recruitment/recruitment-actions.js";
import { minimumMinutesForPercentileComparison } from "../domain/evidence-comparison.js";
import { playerPositionMatches } from "../domain/positions.js";
import { type ConversationTurnResponse, type RecruitmentProgressEventStatus, type RecruitmentProgressStage } from "../domain/conversation.js";
import { type Position } from "../domain/position-contracts.js";
import type { EvaluationScenario, ExpectedCapabilityCoverage, RequestedCapabilityExpectation } from "./harness-scenarios.js";
import { questionAddressesRoleAmbiguity } from "./clarification-intent.js";

export type EvaluationProgressEvent = {
  sequence: number;
  turn: number;
  elapsedMs?: number;
  stage: RecruitmentProgressStage;
  status: RecruitmentProgressEventStatus;
  message: string;
  completedSteps: number;
};

export interface ScenarioEvaluationInput {
  scenario: EvaluationScenario;
  events: RecruitmentTraceEvent[];
  firstTurnResponse: ConversationTurnResponse;
  response: ConversationTurnResponse;
  firstTurnEvents: RecruitmentTraceEvent[];
  continuedEvents: RecruitmentTraceEvent[];
  progressEvents?: EvaluationProgressEvent[];
  answersUsed: number;
  eventTurns?: readonly number[];
  contextStressTurnsAttempted?: number;
  contextStressTurnsCompleted?: number;
  threadId: string;
}

export interface ScenarioEvaluation {
  checks: Record<string, boolean>;
  allPassed: boolean;
}

export type ContextStressTurnEvaluation = {
  turn: number;
  checks: Record<string, boolean>;
  allPassed: boolean;
};

function isToolEvent(event: RecruitmentTraceEvent): event is Extract<RecruitmentTraceEvent, { phase: "tool" }> {
  return event.phase === "tool";
}

function isDecisionEvent(event: RecruitmentTraceEvent): event is Extract<RecruitmentTraceEvent, { phase: "decision" }> {
  return event.phase === "decision";
}

function includesInOrder(actual: ToolActionName[], expected: readonly ToolActionName[]): boolean {
  let nextExpected = 0;
  for (const value of actual) {
    if (value === expected[nextExpected]) nextExpected += 1;
    if (nextExpected === expected.length) return true;
  }
  return expected.length === 0;
}

function recommendationsUseTheirEvidence(response: ConversationTurnResponse): boolean {
  return !response.report || response.report.recommendations.every((recommendation) => (
    recommendation.focusEvidenceKeys.length > 0
    && recommendation.focusEvidenceKeys.every((key) => recommendation.evidence.some((evidence) => evidence.key === key))
  ));
}

function percentilesRespectMetricSamples(response: ConversationTurnResponse): boolean {
  if (!response.report) return true;
  return response.report.recommendations.every((recommendation) => recommendation.evidence.every((evidence) => {
    if (evidence.peerPercentile === null && evidence.basis === "ability_profile") {
      return evidence.peerPercentileUnavailableReason === "ability_profile";
    }
    if (evidence.peerPercentile === null && evidence.peerPercentileUnavailableReason === "competition_scope_unreported") {
      return true;
    }
    if (evidence.minutes === null) {
      return evidence.peerPercentile === null
        && evidence.peerPercentileUnavailableReason === "candidate_sample_unknown";
    }
    if (evidence.minutes < minimumMinutesForPercentileComparison) {
      return evidence.peerPercentile === null
        && evidence.peerPercentileUnavailableReason === "candidate_low_sample";
    }
    if (evidence.peerPercentile === null) {
      return evidence.peerPercentileUnavailableReason === "insufficient_peer_group";
    }
    return evidence.peerPercentileUnavailableReason === undefined;
  }));
}

function requestedCapabilitiesGrounded(
  response: ConversationTurnResponse,
  requestedCapabilities: readonly RequestedCapabilityExpectation[],
): boolean {
  const report = response.report;
  if (!report) return false;
  const limitations = report.limitations.join(" ");

  if (report.recommendations.length === 0) return true;
  return requestedCapabilities.every(({ metricKeys, limitationTerms }) => report.recommendations.every((recommendation) => {
    const candidateEvidenceKeys = recommendation.evidence.map(({ key }) => key);
    const availableKeys = metricKeys.filter((key) => candidateEvidenceKeys.includes(key));
    if (availableKeys.length === 0) return limitationTerms.some((term) => limitations.includes(term));
    return recommendation.focusEvidenceKeys.some((key) => availableKeys.includes(key));
  }));
}

function requestedCapabilityGapsAreReported(
  response: ConversationTurnResponse,
  requestedCapabilities: readonly RequestedCapabilityExpectation[],
): boolean {
  const report = response.report;
  if (!report) return false;
  const limitations = report.limitations.join(" ");
  return requestedCapabilities.every((requested) => {
    const coverage = report.requestedCapabilityCoverage.find(({ name }) => name === requested.name);
    if (!coverage) return false;
    const hasObservedMetric = requested.metricKeys.some((key) => coverage.observedMetricKeys.includes(key));
    return hasObservedMetric || requested.limitationTerms.some((term) => limitations.includes(term));
  });
}

function returnsLeadWhenRelevantEvidenceObserved(response: ConversationTurnResponse): boolean {
  const report = response.report;
  if (!report) return false;
  const evidenceSupportsRequestedCapability = report.requestedCapabilityCoverage.some((coverage) => (
    coverage.observedMetricKeys.length > 0 && coverage.candidatesWithEvidenceCount > 0
  ));
  return !evidenceSupportsRequestedCapability || report.recommendations.length > 0;
}

function requestedCapabilityCoverageIsConsistent(response: ConversationTurnResponse): boolean {
  const report = response.report;
  if (!report) return true;
  const evaluatedCandidateCount = report.evidenceCoverage.evaluatedCandidateCount;
  const seenNames = new Set<string>();

  return report.requestedCapabilityCoverage.every((coverage) => {
    if (seenNames.has(coverage.name)) return false;
    seenNames.add(coverage.name);

    if (coverage.evaluatedCandidateCount !== evaluatedCandidateCount
      || coverage.candidatesWithEvidenceCount > evaluatedCandidateCount
      || new Set(coverage.requestedMetricKeys).size !== coverage.requestedMetricKeys.length
      || new Set(coverage.observedMetricKeys).size !== coverage.observedMetricKeys.length
      || coverage.observedMetricKeys.some((key) => !coverage.requestedMetricKeys.includes(key))) return false;

    const expectedStatus = coverage.candidatesWithEvidenceCount === 0
      ? "missing"
      : coverage.candidatesWithEvidenceCount < evaluatedCandidateCount ? "partial" : "observed";
    return coverage.status === expectedStatus
      && (coverage.candidatesWithEvidenceCount === 0) === (coverage.observedMetricKeys.length === 0);
  });
}

function historicalArchiveEvidenceIsConsistent(
  response: ConversationTurnResponse,
  evaluatedPlayerIds: ReadonlySet<string>,
): boolean {
  const report = response.report;
  if (!report) return true;

  const coverage = report.historicalArchiveCoverage;
  const candidates = [
    ...report.historicalArchiveCandidates,
    ...report.recommendations.flatMap(({ player, historicalArchiveSamples }) => (
      historicalArchiveSamples?.length ? [{ player, samples: historicalArchiveSamples }] : []
    )),
  ];
  const countsAreValid = coverage.mappedCandidates <= coverage.checkedCandidates
    && coverage.matchedCandidates <= coverage.mappedCandidates
    && coverage.failedCandidates <= coverage.checkedCandidates
    && coverage.checkedCandidates <= report.evidenceCoverage.evaluatedCandidateCount
    && candidates.length === coverage.matchedCandidates;
  if (!countsAreValid) return false;

  if (coverage.status === "disabled" || coverage.status === "not_run") {
    return coverage.checkedCandidates === 0
      && coverage.mappedCandidates === 0
      && coverage.matchedCandidates === 0
      && coverage.failedCandidates === 0
      && candidates.length === 0;
  }
  if (coverage.status === "complete"
    && (coverage.mappedCandidates !== coverage.checkedCandidates
      || coverage.matchedCandidates !== coverage.mappedCandidates
      || coverage.failedCandidates !== 0)) return false;

  const seenPlayerIds = new Set<string>();
  return candidates.every(({ player, samples }) => {
    const identity = player.sourceIdentity;
    if (!identity || !evaluatedPlayerIds.has(player.playerId)
      || seenPlayerIds.has(player.playerId) || samples.length === 0) return false;
    seenPlayerIds.add(player.playerId);

    return samples.every(({ identityLink }) => {
      if (identityLink.sourceProvider !== identity.provider || identityLink.sourcePlayerId !== identity.playerId) {
        return false;
      }
      const bridge = identityLink.sourceBridge;
      if (!bridge) return false;
      const matchesPrimaryIdentity = bridge.provider === identity.provider
        && bridge.externalId === identity.playerId;
      const matchesProviderIdentifier = (identity.providerIdentifiers ?? []).some((identifier) => (
        identifier.provider === bridge.provider
        && identifier.namespace === bridge.namespace
        && identifier.externalId === bridge.externalId
        && (bridge.sourceField === null || identifier.sourceField === bridge.sourceField)
      ));
      return matchesPrimaryIdentity || matchesProviderIdentifier;
    });
  });
}

function requestedCapabilityCoverageMatchesScenario(
  response: ConversationTurnResponse,
  expectedCoverage: readonly ExpectedCapabilityCoverage[],
): boolean {
  if (!response.report) return false;
  const actualCoverage = response.report.requestedCapabilityCoverage;

  return expectedCoverage.every((expected) => {
    const actual = actualCoverage.find(({ name }) => name === expected.name);
    return Boolean(actual && expected.requestedMetricKeys.every((key) => actual.requestedMetricKeys.includes(key)));
  });
}

function stringArrayFilter(event: Extract<RecruitmentTraceEvent, { phase: "tool" }>, key: string): string[] {
  const value = event.filters[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

type CandidateSearchEvent = Extract<RecruitmentTraceEvent, { phase: "tool" }>;

function numberFilter(event: CandidateSearchEvent, key: string): number | null {
  const value = event.filters[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function candidateSearchScopeKey(event: CandidateSearchEvent): string {
  const rawMetricGroups = event.filters.discoveryMetricGroups;
  const discoveryMetricGroups = Array.isArray(rawMetricGroups)
    ? rawMetricGroups.flatMap((group) => Array.isArray(group)
      ? [group.filter((key): key is string => typeof key === "string").sort()]
      : []).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    : [];
  return JSON.stringify({
    position: event.filters.position ?? null,
    maxAge: event.filters.maxAge ?? null,
    minimumMinutes: event.filters.minimumMinutes ?? null,
    competition: event.filters.competition ?? null,
    season: event.filters.season ?? null,
    playerNameFilterUsed: event.filters.playerNameFilterUsed ?? false,
    discoveryMetricGroups,
  });
}

function candidateSearchPagesFollowCursors(
  events: CandidateSearchEvent[],
  eventTurns?: ReadonlyMap<RecruitmentTraceEvent, number>,
  previousEvents: CandidateSearchEvent[] = [],
): boolean {
  const successfulSearches = events.filter((event) => event.ok);
  if (successfulSearches.length === 0) return false;

  const searchesByScope = new Map<string, CandidateSearchEvent[]>();
  for (const event of successfulSearches) {
    const scopeKey = JSON.stringify({
      turn: eventTurns?.get(event) ?? null,
      search: candidateSearchScopeKey(event),
    });
    searchesByScope.set(scopeKey, [...(searchesByScope.get(scopeKey) ?? []), event]);
  }

  for (const pages of searchesByScope.values()) {
    let expectedOffset = 0;
    const searchScope = candidateSearchScopeKey(pages[0]!);
    const previousPage = [...previousEvents].reverse().find((event) => event.ok
      && event.toolName === "search_candidates"
      && candidateSearchScopeKey(event) === searchScope);
    if (previousPage && Object.hasOwn(previousPage.filters, "nextOffset")) {
      const previousNextOffset = previousPage.filters.nextOffset;
      if (previousNextOffset === null) return false;
      if (typeof previousNextOffset === "number" && Number.isFinite(previousNextOffset)) {
        expectedOffset = previousNextOffset;
      }
    }
    for (const page of pages) {
      const offset = numberFilter(page, "offset");
      const matchCount = page.matchingRecordCount;
      const limit = numberFilter(page, "limit");
      const nextOffset = page.filters.nextOffset;
      if (offset !== expectedOffset || matchCount === undefined || !Number.isInteger(matchCount) || matchCount < 0 || limit === null) {
        return false;
      }
      if (page.resultCount < 0 || page.resultCount > limit || offset + page.resultCount > matchCount) return false;
      if (page.resultCount === 0 && matchCount > 0) return false;
      const calculatedNextOffset = offset + page.resultCount < matchCount ? offset + page.resultCount : null;
      if (nextOffset !== calculatedNextOffset) return false;
      if (pages.indexOf(page) < pages.length - 1 && calculatedNextOffset === null) return false;
      expectedOffset = calculatedNextOffset ?? expectedOffset;
    }
  }
  return true;
}

function reportMatchesTeam(response: ConversationTurnResponse, aliases: readonly string[]): boolean {
  if (!response.report) return false;
  const targetTeam = response.report.targetTeam?.toLocaleLowerCase();
  return Boolean(targetTeam && aliases.some((alias) => targetTeam.includes(alias.toLocaleLowerCase())));
}

function tracedTeamNames(events: RecruitmentTraceEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.phase === "decision" && typeof event.targetTeam === "string") return [event.targetTeam];
    if (event.phase === "tool" && event.toolName === "inspect_team") {
      const teamName = event.filters.teamName;
      if (typeof teamName === "string") return [teamName];
    }
    return [];
  });
}

function traceMatchesTeam(events: RecruitmentTraceEvent[], aliases: readonly string[]): boolean {
  const traceTeams = tracedTeamNames(events);
  return traceTeams.length > 0 && traceTeams.every((targetTeam) => aliases.some((alias) => (
    targetTeam.toLocaleLowerCase().includes(alias.toLocaleLowerCase())
  )));
}

function targetTeamContextPreserved(
  response: ConversationTurnResponse,
  events: RecruitmentTraceEvent[],
  aliases: readonly string[],
): boolean {
  const reportMatches = response.report ? reportMatchesTeam(response, aliases) : false;
  const traceTeams = tracedTeamNames(events);
  const traceMatches = traceMatchesTeam(events, aliases);
  if (!response.report) return traceMatches;
  return reportMatches && (traceTeams.length === 0 || traceMatches);
}

function reportAvoidsLoopLimit(response: ConversationTurnResponse): boolean {
  return !response.report || !response.report.limitations.some((item) => (
    /安全步数上限|连续重复.*动作|连续两次重复提出.*相同动作/.test(item)
  ));
}

function didNotRepeatPolicyBlockedAction(
  events: RecruitmentTraceEvent[],
  eventTurns?: ReadonlyMap<RecruitmentTraceEvent, number>,
): boolean {
  let previousBlockedAction: string | null = null;
  let previousTurn: number | null = null;
  for (const event of events) {
    const turn = eventTurns?.get(event) ?? null;
    if (turn !== previousTurn) previousBlockedAction = null;
    previousTurn = turn;
    if (!isDecisionEvent(event)) continue;
    if (event.policyBlocked !== true || !event.action) {
      previousBlockedAction = null;
      continue;
    }
    if (event.action === previousBlockedAction) return false;
    previousBlockedAction = event.action;
  }
  return true;
}

function noBlockedFollowUpQuestions(events: RecruitmentTraceEvent[]): boolean {
  return !events.some((event) => isDecisionEvent(event)
    && event.action === "ask_user"
    && event.policyBlocked === true);
}

function investigatedBeforeQuestion(events: RecruitmentTraceEvent[]): boolean {
  const questionIndex = events.findIndex((event) => isDecisionEvent(event) && event.action === "ask_user");
  return questionIndex > 0 && events.slice(0, questionIndex).some((event) => isToolEvent(event) && event.ok);
}

function clarificationResumeChecks(
  input: ScenarioEvaluationInput,
  requireRoleAmbiguity: boolean,
): Record<string, boolean> {
  const { firstTurnResponse, response, firstTurnEvents, continuedEvents, answersUsed, threadId } = input;
  const asksAfterInvestigation = firstTurnResponse.status === "needs_input"
    && investigatedBeforeQuestion(firstTurnEvents)
    && Boolean(firstTurnResponse.message.trim() && firstTurnResponse.question?.reason.trim());
  const roleAmbiguityAddressed = !requireRoleAmbiguity || questionAddressesRoleAmbiguity(firstTurnResponse);
  return {
    questionFollowedInvestigation: asksAfterInvestigation && roleAmbiguityAddressed,
    ...(requireRoleAmbiguity ? { questionAddressesRoleAmbiguity: roleAmbiguityAddressed } : {}),
    resumedSameCase: firstTurnResponse.status === "needs_input"
      && answersUsed > 0
      && firstTurnResponse.threadId === threadId
      && response.threadId === threadId,
    continuedAfterAnswer: answersUsed > 0 && continuedEvents.some((event) => (
      (isDecisionEvent(event) || isToolEvent(event)) && event.ok
    )),
  };
}

/**
 * Evaluate the no-answer arm of the interaction ablation. The graph still gets
 * to decide whether to ask; this arm stops at the first real interrupt and
 * deliberately does not inject the scenario's hidden answer script.
 */
export function evaluateWithheldAnswerArm(input: ScenarioEvaluationInput): ScenarioEvaluation {
  const { scenario, firstTurnResponse, response, firstTurnEvents, continuedEvents, progressEvents, answersUsed } = input;
  if (scenario.kind !== "clarification-resume") {
    throw new Error("The withheld-answer evaluator requires a registered clarification scenario.");
  }

  const acceptedQuestions = firstTurnEvents.filter((event) => (
    isDecisionEvent(event) && event.action === "ask_user" && event.policyBlocked !== true
  ));
  const firstQuestionIndex = firstTurnEvents.findIndex((event) => (
    isDecisionEvent(event) && event.action === "ask_user" && event.policyBlocked !== true
  ));
  const noToolWorkAfterQuestion = firstQuestionIndex >= 0
    && !firstTurnEvents.slice(firstQuestionIndex + 1).some(isToolEvent);
  let emptyExpectedPositionObserved = false;
  const noUnapprovedExpansion = firstTurnEvents.every((event) => {
    if (!scenario.expectedBroadenedPosition || !isToolEvent(event) || !event.ok || event.toolName !== "search_candidates") {
      return true;
    }
    if (event.filters.position === scenario.expectedPosition && event.matchingRecordCount === 0) {
      emptyExpectedPositionObserved = true;
    }
    return event.filters.position !== scenario.expectedBroadenedPosition || !emptyExpectedPositionObserved;
  });
  const pausedProgressMatchesRuntime = Boolean(progressEvents?.some((event) => (
    event.turn === 1 && event.stage === "asking_user" && event.status === "waiting_for_user"
  ))) && progressRepresentsObservedWork(input);
  const checks = {
    pausedAtFirstClarification: firstTurnResponse.status === "needs_input"
      && response.status === "needs_input"
      && response.report === null,
    askedExactlyOnce: acceptedQuestions.length === 1,
    questionFollowedObservedInvestigation: investigatedBeforeQuestion(firstTurnEvents),
    questionAddressesRoleAmbiguity: questionAddressesRoleAmbiguity(firstTurnResponse),
    noAnswerWasInjected: answersUsed === 0,
    noPostInterruptActions: continuedEvents.length === 0 && noToolWorkAfterQuestion,
    noUnapprovedPositionExpansion: noUnapprovedExpansion,
    progressMatchesPausedGraph: pausedProgressMatchesRuntime,
  };
  return { checks, allPassed: Object.values(checks).every(Boolean) };
}

function evidenceEvaluationsFollowCandidateDiscovery(events: RecruitmentTraceEvent[]): boolean {
  const discoveredIds = new Set<string>();
  let candidateSearchSucceeded = false;
  for (const event of events) {
    if (!isToolEvent(event) || !event.ok) continue;
    if (event.toolName === "search_candidates") {
      candidateSearchSucceeded = true;
      for (const id of stringArrayFilter(event, "candidateIds")) discoveredIds.add(id);
    }
    if (event.toolName === "evaluate_candidates" && event.resultCount > 0) {
      const evaluatedIds = stringArrayFilter(event, "evaluatedPlayerIds");
      if (!candidateSearchSucceeded || evaluatedIds.length === 0 || evaluatedIds.some((id) => !discoveredIds.has(id))) {
        return false;
      }
    }
  }
  return true;
}

function candidateSearchOutcomeIsExplicit(
  response: ConversationTurnResponse,
  candidateSearches: CandidateSearchEvent[],
): boolean {
  const successful = candidateSearches.some((event) => event.ok);
  if (successful) return true;
  // A suspended turn has not produced a candidate-search outcome yet.
  if (response.status === "needs_input") return true;
  const report = response.report;
  if (!report || candidateSearches.length === 0 || report.recommendations.length > 0) return false;
  return /查询.*失败|无法确认/.test(report.needSummary)
    && report.limitations.some((limitation) => /候选查询.*失败/.test(limitation)
      && /不能解释为零匹配|不代表没有符合条件的球员/.test(limitation));
}

const progressStageByTool: Record<ToolActionName, RecruitmentProgressStage> = {
  search_methodology: "methodology",
  inspect_team: "team_sample",
  inspect_candidate_group: "player_detail",
  inspect_player: "player_detail",
  inspect_match: "match_detail",
  search_candidates: "candidate_search",
  evaluate_candidates: "player_evaluation",
  search_player_reports: "report_search",
  read_case_evidence: "evidence_read",
};

function progressTurnForTool(input: ScenarioEvaluationInput, target: CandidateSearchEvent): number | null {
  const toolIndex = input.events.filter(isToolEvent).indexOf(target);
  if (toolIndex < 0 || !input.progressEvents) return null;
  const toolStages = new Set(Object.values(progressStageByTool));
  const starts = input.progressEvents.filter((event) => toolStages.has(event.stage) && event.status === "started");
  return starts[toolIndex]?.turn ?? null;
}

function toolProgressMatchesTrace(
  toolEvents: Extract<RecruitmentTraceEvent, { phase: "tool" }>[],
  progressEvents: EvaluationProgressEvent[],
): boolean {
  if (progressEvents.length !== toolEvents.length * 2) return false;

  for (let index = 0; index < toolEvents.length; index += 1) {
    const trace = toolEvents[index]!;
    const start = progressEvents[index * 2]!;
    const terminal = progressEvents[index * 2 + 1]!;
    const expectedStage = progressStageByTool[trace.toolName];
    const terminalStatusMatches = trace.ok
      ? terminal.status === "completed"
      : terminal.status === "notice" || terminal.status === "failed";

    if (start.stage !== expectedStage
      || start.status !== "started"
      || terminal.stage !== expectedStage
      || !terminalStatusMatches
      || start.turn !== terminal.turn) return false;
  }

  return true;
}

function progressRepresentsObservedWork(input: ScenarioEvaluationInput): boolean {
  const progressEvents = input.progressEvents;
  if (!progressEvents || progressEvents.length === 0) return false;
  const finalTurn = input.answersUsed + 1 + (input.contextStressTurnsAttempted ?? 0);
  if (progressEvents.some((event, index) => event.sequence !== index + 1
    || event.turn < 1
    || event.turn > finalTurn)) return false;

  const toolStages = new Set(Object.values(progressStageByTool));
  const toolProgressEvents = progressEvents.filter((event) => toolStages.has(event.stage));
  if (!toolProgressMatchesTrace(
    input.firstTurnEvents.filter(isToolEvent),
    toolProgressEvents.filter((event) => event.turn === 1),
  ) || !toolProgressMatchesTrace(
    input.continuedEvents.filter(isToolEvent),
    toolProgressEvents.filter((event) => event.turn > 1),
  )) return false;

  const firstTurnPaused = input.firstTurnResponse.status === "needs_input";
  if (firstTurnPaused && !progressEvents.some((event) => (
    event.turn === 1 && event.stage === "asking_user" && event.status === "waiting_for_user"
  ))) return false;

  const expectedFinalStage = input.response.status === "needs_input" ? "asking_user" : "completed";
  const expectedFinalStatus = input.response.status === "needs_input" ? "waiting_for_user" : "completed";
  return progressEvents.some((event) => (
    event.turn === finalTurn && event.stage === expectedFinalStage && event.status === expectedFinalStatus
  ));
}

export function evaluateContextStressTurn(input: {
  scenario: EvaluationScenario;
  response: ConversationTurnResponse;
  events: RecruitmentTraceEvent[];
  progressEvents: EvaluationProgressEvent[];
  previousEvents?: RecruitmentTraceEvent[];
  turn: number;
}): ContextStressTurnEvaluation {
  const { scenario, response, events, progressEvents, turn } = input;
  const report = response.report;
  const toolEvents = events.filter(isToolEvent);
  const candidateSearches = toolEvents.filter((event) => event.toolName === "search_candidates");
  const allToolEvents = [...(input.previousEvents ?? []), ...events].filter(isToolEvent);
  const evaluatedPlayerIds = new Set(allToolEvents
    .filter((event) => event.toolName === "evaluate_candidates" && event.ok)
    .flatMap((event) => stringArrayFilter(event, "evaluatedPlayerIds")));
  const teamAliases = "targetTeamAliases" in scenario ? scenario.targetTeamAliases : [];
  const expectedPosition = scenario.kind === "shortlist" ? scenario.expectedBroadPosition : undefined;
  const expectedMaxAge = scenario.kind === "shortlist" ? scenario.expectedMaxAge : undefined;
  const requestedCapabilities = "requestedCapabilities" in scenario ? scenario.requestedCapabilities : undefined;
  const expectedCoverage = "expectedCapabilityCoverage" in scenario ? scenario.expectedCapabilityCoverage : undefined;
  const searchScopesPreserved = candidateSearches.every((event) => (
    (expectedPosition === undefined || event.filters.position === expectedPosition)
    && (expectedMaxAge === undefined || event.filters.maxAge === expectedMaxAge)
    && event.filters.competition === null
    && event.filters.season === null
    && event.filters.minimumMinutes === 0
    && event.filters.playerNameFilterUsed === false
  ));
  const reportCompletedForTurn = response.status === "completed" && report !== null;
  const askedUser = events.some((event) => isDecisionEvent(event)
    && event.action === "ask_user"
    && event.policyBlocked !== true
    && event.askPolicyOutcome !== "suppressed");
  const toolProgress = progressEvents.filter((event) => new Set(Object.values(progressStageByTool)).has(event.stage));
  const toolProgressMatches = toolProgressMatchesTrace(toolEvents, toolProgress);
  const completedProgressObserved = progressEvents.some((event) => (
    event.turn === turn && event.stage === "completed" && event.status === "completed"
  ));
  const checks = {
    completedWithReport: reportCompletedForTurn,
    didNotAskForAdditionalInput: !askedUser,
    targetTeamContextPreserved: teamAliases.length === 0 || targetTeamContextPreserved(response, events, teamAliases),
    requestedCapabilityCoverageIsConsistent: requestedCapabilityCoverageIsConsistent(response),
    requestedCapabilityCoverageMatchesScenario: !expectedCoverage || requestedCapabilityCoverageMatchesScenario(response, expectedCoverage),
    requestedCapabilitiesAreGrounded: !requestedCapabilities || requestedCapabilitiesGrounded(response, requestedCapabilities),
    requestedCapabilityGapsAreReported: !requestedCapabilities || requestedCapabilityGapsAreReported(response, requestedCapabilities),
    recommendationsAreEvidenceBacked: recommendationsUseTheirEvidence(response),
    recommendationsWereEvaluated: !report || report.recommendations.every((item) => evaluatedPlayerIds.has(item.player.playerId)),
    historicalArchiveEvidenceIsConsistent: historicalArchiveEvidenceIsConsistent(response, evaluatedPlayerIds),
    percentilesRespectMetricSamples: percentilesRespectMetricSamples(response),
    searchScopesPreserved,
    candidatePagesFollowCursors: candidateSearches.length === 0 || candidateSearchPagesFollowCursors(
      candidateSearches,
      undefined,
      (input.previousEvents ?? []).filter((event): event is CandidateSearchEvent => (
        isToolEvent(event) && event.toolName === "search_candidates"
      )),
    ),
    didNotRepeatPolicyBlockedAction: didNotRepeatPolicyBlockedAction(events),
    toolProgressMatchesObservedCalls: toolProgressMatches,
    completedProgressObserved,
  };
  return { turn, checks, allPassed: Object.values(checks).every(Boolean) };
}

function explicitEmptyPositionLimitation(response: ConversationTurnResponse, expectedPosition: Position): boolean {
  const positionNames = expectedPosition === "ST" ? ["ST", "中锋"] : [expectedPosition];
  return Boolean(response.report?.limitations.some((limitation) => {
    const hasPosition = positionNames.some((name) => limitation.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
    const explainsAbsence = /没有|未找到|缺少|无可用|不足/.test(limitation);
    return hasPosition && explainsAbsence;
  }));
}

export function evaluateLocalAgentScenario(input: ScenarioEvaluationInput): ScenarioEvaluation {
  const { scenario, events, response } = input;
  const toolEvents = events.filter(isToolEvent);
  const candidateSearches = toolEvents.filter((event) => event.toolName === "search_candidates");
  const successfulCandidateSearches = candidateSearches.filter((event) => event.ok);
  const evaluationEvents = toolEvents.filter((event) => event.toolName === "evaluate_candidates");
  const successfulEvidenceEvaluations = evaluationEvents.filter((event) => event.ok && event.resultCount > 0
    && stringArrayFilter(event, "evaluatedPlayerIds").length > 0);
  const evaluatedPlayerIds = new Set(successfulEvidenceEvaluations
    .flatMap((event) => stringArrayFilter(event, "evaluatedPlayerIds")));
  const decisionEvents = events.filter((event): event is Extract<RecruitmentTraceEvent, { phase: "decision" }> => (
    isDecisionEvent(event) && event.ok
  ));
  const hasDecisionSource = decisionEvents.some((event) => event.decisionSource !== undefined);
  const successfulPlannerDecisions = hasDecisionSource
    ? decisionEvents.filter((event) => event.decisionSource === "planner").length
    : decisionEvents.length;
  const successfulToolSteps = toolEvents.filter((event) => event.ok).length;
  const plannerInvocations = hasDecisionSource
    ? decisionEvents.filter((event) => (
      event.decisionSource === "planner"
      || event.proposedAction !== undefined
      || event.plannerFallback !== undefined
    )).length
    : decisionEvents.length;
  const report = response.report;
  const expectedCapabilityCoverage = "expectedCapabilityCoverage" in scenario
    ? scenario.expectedCapabilityCoverage
    : undefined;
  const requestedCapabilities = "requestedCapabilities" in scenario
    ? scenario.requestedCapabilities
    : undefined;
  const eventTurns = input.eventTurns
    ? new Map(input.events.flatMap((event, index) => {
      const turn = input.eventTurns?.[index];
      return turn === undefined ? [] : [[event, turn] as const];
    }))
    : undefined;
  const stressTurnNumbers = new Set<number>();
  if (input.contextStressTurnsAttempted && input.eventTurns?.length) {
    const lastTurn = Math.max(...input.eventTurns);
    const firstStressTurn = lastTurn - input.contextStressTurnsAttempted + 1;
    for (let turn = firstStressTurn; turn <= lastTurn; turn += 1) stressTurnNumbers.add(turn);
  }
  const candidateSearchesOutsideContextStress = stressTurnNumbers.size > 0
    ? candidateSearches.filter(event => !stressTurnNumbers.has(eventTurns?.get(event) ?? -1))
    : candidateSearches;
  const candidatePagesFollowCursors = candidateSearchesOutsideContextStress.length === 0 && stressTurnNumbers.size > 0
    ? true
    : candidateSearchPagesFollowCursors(candidateSearchesOutsideContextStress, eventTurns);
  const expectsPositionClarification = scenario.kind === "custom"
    && scenario.expectedClarificationTopic === "position";
  const commonChecks = {
    ...(!expectsPositionClarification ? {
      usedMultipleAgentActions: scenario.kind === "shortlist"
        ? successfulPlannerDecisions + successfulToolSteps > 1
        : plannerInvocations > 0,
    } : {}),
    finalStatusMatchesReport: response.status === "needs_input" ? report === null : report !== null,
    ...("targetTeamAliases" in scenario ? {
      targetTeamContextPreserved: targetTeamContextPreserved(response, events, scenario.targetTeamAliases),
    } : {}),
    recommendationsAreEvidenceBacked: recommendationsUseTheirEvidence(response),
    historicalArchiveEvidenceIsConsistent: historicalArchiveEvidenceIsConsistent(response, evaluatedPlayerIds),
    percentilesRespectMetricSamples: percentilesRespectMetricSamples(response),
    recommendationsWereEvaluated: Boolean(!report || report.recommendations.every((item) => (
      evaluatedPlayerIds.has(item.player.playerId)
    ))),
    evaluatedOnlyAfterCandidateDiscovery: !successfulEvidenceEvaluations.length
      || evidenceEvaluationsFollowCandidateDiscovery(events),
    candidateSearchOutcomeIsExplicit: candidateSearchOutcomeIsExplicit(response, candidateSearches),
    didNotHitDecisionOrPolicyLoopLimit: reportAvoidsLoopLimit(response),
    didNotRepeatPolicyBlockedAction: didNotRepeatPolicyBlockedAction(events, eventTurns),
    ...(input.progressEvents ? { progressMatchesObservedToolsAndTurnState: progressRepresentsObservedWork(input) } : {}),
    requestedCapabilityCoverageIsConsistent: requestedCapabilityCoverageIsConsistent(response),
    requestedCapabilityCoverageMatchesScenario: response.status !== "completed" || !expectedCapabilityCoverage
      || requestedCapabilityCoverageMatchesScenario(response, expectedCapabilityCoverage),
    requestedCapabilitiesAreGrounded: response.status !== "completed" || !requestedCapabilities
      || requestedCapabilitiesGrounded(response, requestedCapabilities),
    requestedCapabilityGapsAreReported: response.status !== "completed" || !requestedCapabilities
      || requestedCapabilityGapsAreReported(response, requestedCapabilities),
    ...(response.status === "completed" && "requireRecommendationsWhenEvidenceObserved" in scenario && scenario.requireRecommendationsWhenEvidenceObserved
      ? { returnsLeadWhenRelevantEvidenceObserved: returnsLeadWhenRelevantEvidenceObserved(response) }
      : {}),
  };

  let checks: Record<string, boolean>;
  if (scenario.kind === "shortlist") {
    const actualTools = toolEvents.filter((event) => event.ok).map((event) => event.toolName);
    const scopesAvoidUnauthorizedFilters = candidateSearches.length > 0 && candidateSearches.every((event) => (
      event.filters.competition === null
      && event.filters.season === null
      && event.filters.minimumMinutes === 0
    ));
    const ageLimitApplied = candidateSearches.length > 0
      && candidateSearches.every((event) => event.filters.maxAge === scenario.expectedMaxAge);
    const broadPositionPreserved = !scenario.requireBroadPositionSearch || (candidateSearches.length > 0
      && candidateSearches.every((event) => event.filters.position === (scenario.expectedBroadPosition ?? null)));
    const candidateResultsFound = successfulCandidateSearches.some((event) => (event.matchingRecordCount ?? 0) > 0);
    const evaluationReturnedEvidence = successfulEvidenceEvaluations.length > 0;
    const candidateSearchDoesNotUseAnUnrequestedName = candidateSearches.length > 0
      && candidateSearches.every((event) => event.filters.playerNameFilterUsed === false);
    const successfulReportSearchAfterEvaluation = successfulEvidenceEvaluations.some(evaluation => {
      const evaluationIndex = events.lastIndexOf(evaluation);
      return evaluationIndex >= 0 && events.some((event, index) => (
        index > evaluationIndex
        && isToolEvent(event)
        && event.toolName === "search_player_reports"
        && event.ok
      ));
    });
    checks = {
      ...commonChecks,
      completedWithReport: response.status === "completed" && report !== null,
      requiredInvestigationToolsInOrder: includesInOrder(actualTools, scenario.requiredTools),
      noInferredCompetitionSeasonOrMinutesFilters: scopesAvoidUnauthorizedFilters,
      appliedUserAgeLimit: ageLimitApplied,
      broadPositionWasNotNarrowed: broadPositionPreserved,
      recommendationsRespectRequestedPosition: !report || !scenario.expectedBroadPosition
        || report.recommendations.every(({ player }) => playerPositionMatches(player, scenario.expectedBroadPosition!)),
      requestedCapabilitiesGrounded: !scenario.requestedCapabilities
        || requestedCapabilitiesGrounded(response, scenario.requestedCapabilities),
      candidateSearchDoesNotUseAnUnrequestedName,
      candidatePagesFollowCursors,
      searchedMethodologyCorpus: scenario.requireMethodologySearch === false
        || toolEvents.some((event) => event.toolName === "search_methodology" && event.ok),
      evaluatedDiscoveredCandidates: !candidateResultsFound || evaluationReturnedEvidence,
      searchedReportsAfterEvaluatingEvidence: scenario.requireReportSearchAfterEvaluation === false
        || !evaluationReturnedEvidence
        || Boolean(report?.knowledgeCoverage.playerReportSearchPerformed && successfulReportSearchAfterEvaluation),
      didNotRecommendWithoutEvaluatedEvidence: Boolean(report && (evaluationReturnedEvidence
        || report.recommendations.length === 0)),
    };
  } else if (scenario.kind === "clarification-resume") {
    const postAnswerCandidateSearches = input.continuedEvents.filter((event): event is Extract<RecruitmentTraceEvent, { phase: "tool" }> => (
      isToolEvent(event) && event.toolName === "search_candidates"
    ));
    const constrainedPositionSearches = postAnswerCandidateSearches.filter((event) => (
      event.ok && event.filters.position === scenario.expectedPosition
    ));
    const allConstrainedPositionSearches = candidateSearches.filter((event) => (
      event.ok && event.filters.position === scenario.expectedPosition
    ));
    const constrainedPositionPaginationIsValid = constrainedPositionSearches.length > 0
      && (candidateSearchPagesFollowCursors(constrainedPositionSearches, eventTurns)
        || candidateSearchPagesFollowCursors(allConstrainedPositionSearches, eventTurns));
    const broadenedPositionSearchIndex = scenario.expectedBroadenedPosition
      ? postAnswerCandidateSearches.findIndex((event) => event.ok
        && event.filters.position === scenario.expectedBroadenedPosition)
      : -1;
    const emptyExpectedPositionSearchIndex = postAnswerCandidateSearches.findIndex((event) => (
      event.ok
      && event.filters.position === scenario.expectedPosition
      && event.matchingRecordCount === 0
    ));
    const emptyExpectedPositionSearch = emptyExpectedPositionSearchIndex >= 0
      ? postAnswerCandidateSearches[emptyExpectedPositionSearchIndex]!
      : undefined;
    const expectedPositionMatchesObserved = constrainedPositionSearches.some((event) => (
      typeof event.matchingRecordCount === "number" && event.matchingRecordCount > 0
    ));
    const broadenedSearches = scenario.expectedBroadenedPosition
      ? postAnswerCandidateSearches.filter((event) => event.ok && event.filters.position === scenario.expectedBroadenedPosition)
      : [];
    const allBroadenedSearches = scenario.expectedBroadenedPosition
      ? candidateSearches.filter((event) => event.ok && event.filters.position === scenario.expectedBroadenedPosition)
      : [];
    const broadenedSearchPaginationIsValid = candidateSearchPagesFollowCursors(broadenedSearches, eventTurns)
      || candidateSearchPagesFollowCursors(allBroadenedSearches, eventTurns);
    const broadenedPositionSearch = broadenedPositionSearchIndex >= 0
      ? postAnswerCandidateSearches[broadenedPositionSearchIndex]!
      : undefined;
    const emptyPositionTurn = emptyExpectedPositionSearch
      ? progressTurnForTool(input, emptyExpectedPositionSearch)
      : null;
    const broadenedPositionTurn = broadenedPositionSearch
      ? progressTurnForTool(input, broadenedPositionSearch)
      : null;
    const userWasAskedAfterEmptyPosition = emptyPositionTurn !== null
      && Boolean(input.progressEvents?.some((event) => (
        event.turn === emptyPositionTurn
        && event.stage === "asking_user"
        && event.status === "waiting_for_user"
      )));
    const broadenedSearchFollowsEmptyPosition = emptyExpectedPositionSearchIndex >= 0
      && broadenedPositionSearchIndex > emptyExpectedPositionSearchIndex
      && emptyPositionTurn !== null
      && broadenedPositionTurn !== null
      && broadenedPositionTurn > emptyPositionTurn
      && input.answersUsed >= 2
      && userWasAskedAfterEmptyPosition
      && broadenedSearchPaginationIsValid
      && response.status === "completed";
    const expectedPositionSearchTurns = constrainedPositionSearches
      .map((event) => progressTurnForTool(input, event))
      .filter((turn): turn is number => turn !== null);
    const lastExpectedPositionSearchTurn = expectedPositionSearchTurns.length
      ? Math.max(...expectedPositionSearchTurns)
      : null;
    const userApprovedBroadeningAfterObservedCandidates = expectedPositionMatchesObserved
      && lastExpectedPositionSearchTurn !== null
      && broadenedPositionSearchIndex >= 0
      && broadenedPositionTurn !== null
      && broadenedPositionTurn > lastExpectedPositionSearchTurn
      && input.answersUsed >= 2
      && Boolean(input.progressEvents?.some((event) => (
        event.turn === lastExpectedPositionSearchTurn
        && event.stage === "asking_user"
        && event.status === "waiting_for_user"
      )))
      && broadenedSearchPaginationIsValid
      && response.status === "completed";
    checks = {
      ...commonChecks,
      ...clarificationResumeChecks(input, true),
      noBlockedFollowUpQuestions: noBlockedFollowUpQuestions(input.continuedEvents),
      searchedExpectedPositionAfterAnswer: postAnswerCandidateSearches.some((event) => (
        event.ok && event.filters.position === scenario.expectedPosition
      )),
      didNotInferCandidateFilters: candidateSearches.length > 0 && candidateSearches.every((event) => (
        event.filters.maxAge === null
        && event.filters.minimumMinutes === 0
        && event.filters.competition === null
        && event.filters.season === null
        && event.filters.playerNameFilterUsed === false
      )),
      expectedPositionSearchStartedAtFirstPage: constrainedPositionPaginationIsValid,
      recommendationsMatchExpectedPosition: report
        ? report.recommendations.every((recommendation) => playerPositionMatches(
          recommendation.player,
          (broadenedSearchFollowsEmptyPosition || userApprovedBroadeningAfterObservedCandidates)
            ? scenario.expectedBroadenedPosition ?? scenario.expectedPosition
            : scenario.expectedPosition,
        ))
        : response.status === "needs_input",
      ...(scenario.expectedBroadenedPosition ? {
        positionExpansionMatchesEvidenceAndConsent: expectedPositionMatchesObserved
          ? broadenedSearches.length === 0 || userApprovedBroadeningAfterObservedCandidates
          : broadenedSearchFollowsEmptyPosition,
      } : {}),
      emptyExpectedPositionHandledHonestly: (() => {
        const constrainedSearches = postAnswerCandidateSearches.filter((event) => (
          event.ok && event.filters.position === scenario.expectedPosition
        ));
        if (constrainedSearches.length === 0 || constrainedSearches.some((event) => event.matchingRecordCount === undefined)) return false;
        const noCandidatesFound = constrainedSearches.every((event) => event.matchingRecordCount === 0);
        if (!noCandidatesFound || response.status === "needs_input") return true;
        if (scenario.expectedBroadenedPosition) {
          return broadenedPositionSearchIndex > emptyExpectedPositionSearchIndex
            && (broadenedSearches.some((event) => (event.matchingRecordCount ?? event.resultCount) > 0)
              || Boolean(report?.recommendations.length)
              ? Boolean(report?.recommendations.every((recommendation) => playerPositionMatches(
                recommendation.player,
                scenario.expectedBroadenedPosition!,
              )))
              : Boolean(report && explicitEmptyPositionLimitation(response, scenario.expectedBroadenedPosition)));
        }
        return Boolean(report && report.recommendations.length === 0
          && explicitEmptyPositionLimitation(response, scenario.expectedPosition));
      })(),
    };
  } else {
    const firstTurnToolEvents = input.firstTurnEvents.filter(isToolEvent);
    const firstTurnDecisionEvents = input.firstTurnEvents.filter(isDecisionEvent);
    const expectedQuestionText = `${input.firstTurnResponse.message} ${input.firstTurnResponse.question?.reason ?? ""}`;
    const positionSearchAfterAnswer = input.continuedEvents.some((event) => (
      isToolEvent(event)
      && event.ok
      && event.toolName === "search_candidates"
      && (!scenario.expectedPosition || event.filters.position === scenario.expectedPosition)
    ));
    checks = {
      ...commonChecks,
      ...(expectsPositionClarification ? {
        pausedForExpectedClarification: input.firstTurnResponse.status === "needs_input"
          && input.firstTurnResponse.report === null,
        askedAboutPosition: /位置|门将|守门员|后卫|中卫|边卫|中场|后腰|中前卫|前腰|前锋|中锋|边锋/
          .test(expectedQuestionText),
        askedExactlyOnce: firstTurnDecisionEvents.filter((event) => event.action === "ask_user"
          && event.policyBlocked !== true && event.askPolicyOutcome !== "suppressed").length === 1,
        didNotSearchOrEvaluateCandidatesBeforeClarification: !firstTurnToolEvents.some((event) => (
          event.toolName === "search_candidates"
          || event.toolName === "evaluate_candidates"
          || event.toolName === "inspect_candidate_group"
          || event.toolName === "inspect_player"
        )),
        didNotInvokePlannerBeforeClarification: !firstTurnDecisionEvents.some((event) => (
          event.decisionSource === "planner" || event.proposedAction !== undefined || event.plannerFallback !== undefined
        )),
        ...(input.answersUsed > 0 ? {
          resumedSameCaseAfterAnswer: input.firstTurnResponse.threadId === input.threadId
            && response.threadId === input.threadId,
          continuedInvestigationAfterAnswer: input.continuedEvents.some((event) => (
            (isDecisionEvent(event) || isToolEvent(event)) && event.ok
          )),
          searchedExpectedPositionAfterAnswer: positionSearchAfterAnswer,
          completedAfterAnswer: response.status === "completed" && response.report !== null,
        } : {
          remainedPausedForUser: response.status === "needs_input" && response.report === null,
          noAnswerWasInjected: input.answersUsed === 0,
        }),
      } : {}),
      ...(scenario.requireClarificationResume ? {
        ...clarificationResumeChecks(input, false),
      } : {}),
      ...(scenario.expectedPosition ? {
        searchedExpectedPosition: candidateSearches.some((event) => event.filters.position === scenario.expectedPosition),
        recommendationsMatchExpectedPosition: !report || report.recommendations.every((recommendation) => (
          playerPositionMatches(recommendation.player, scenario.expectedPosition!)
        )),
      } : {}),
      ...(scenario.requireRecommendationsWhenEvidenceObserved ? {
        returnsLeadWhenRelevantEvidenceObserved: !report
          || !report.requestedCapabilityCoverage.some((coverage) => (
            coverage.observedMetricKeys.length > 0 && coverage.candidatesWithEvidenceCount > 0
          ))
          || report.recommendations.length > 0,
      } : {}),
    };
  }

  return { checks, allPassed: Object.values(checks).every(Boolean) };
}

export { summarizeEvaluationRuns } from "./harness-run-summary.js";
export type { EvaluationOperationLatencySample, EvaluationRunSummary, EvaluationRunSummaryInput } from "./harness-run-summary.js";
export { localAgentEvaluationScenarios, understatLocalAgentEvaluationScenario } from "./harness-scenarios.js";
export type { ClarificationIntent, EvaluationScenario } from "./harness-scenarios.js";
