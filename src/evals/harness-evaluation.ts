import type { RecruitmentTraceEvent } from "../agent/conversation.js";
import { type ToolActionName } from "../agent/recruitment-actions.js";
import { minimumMinutesForPercentileComparison } from "../domain/evidence-comparison.js";
import { positionMatches } from "../domain/positions.js";
import type {
  ConversationTurnResponse,
  Position,
  RecruitmentProgressEventStatus,
  RecruitmentProgressStage
} from "../domain/schemas.js";
import type { ClarificationIntent, EvaluationScenario, ExpectedCapabilityCoverage, RequestedCapabilityExpectation } from "./harness-scenarios.js";

export type EvaluationProgressEvent = {
  sequence: number;
  turn: number;
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
  threadId: string;
}

export interface ScenarioEvaluation {
  checks: Record<string, boolean>;
  allPassed: boolean;
}

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
  if (actualCoverage.length !== expectedCoverage.length) return false;

  return expectedCoverage.every((expected) => {
    const actual = actualCoverage.find(({ name }) => name === expected.name);
    return Boolean(actual && actual.requestedMetricKeys.length === expected.requestedMetricKeys.length
      && expected.requestedMetricKeys.every((key) => actual.requestedMetricKeys.includes(key)));
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

function candidateSearchPagesFollowCursors(events: CandidateSearchEvent[]): boolean {
  const successfulSearches = events.filter((event) => event.ok);
  if (successfulSearches.length === 0) return false;

  const searchesByScope = new Map<string, CandidateSearchEvent[]>();
  for (const event of successfulSearches) {
    const scopeKey = JSON.stringify({
      position: event.filters.position,
      maxAge: event.filters.maxAge,
      minimumMinutes: event.filters.minimumMinutes,
      competition: event.filters.competition,
      season: event.filters.season,
      playerNameFilterUsed: event.filters.playerNameFilterUsed,
    });
    searchesByScope.set(scopeKey, [...(searchesByScope.get(scopeKey) ?? []), event]);
  }

  for (const pages of searchesByScope.values()) {
    let expectedOffset = 0;
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

export function privacySafeTraceEvent(event: RecruitmentTraceEvent): Record<string, unknown> {
  const redactedKeys = ["targetTeam", "teamName", "query", "playerName", "playerNames", "searchedPlayerNames"] as const;
  if (event.phase === "decision") {
    const { targetTeam, ...safeEvent } = event;
    return { ...safeEvent, ...(targetTeam !== undefined ? { targetTeamProvided: Boolean(targetTeam) } : {}) };
  }
  if (event.phase === "review") return event;
  if (event.phase === "model_usage") return { ...event };
  if (event.phase === "tool_reuse") return { ...event };

  const filters = { ...event.filters };
  for (const key of redactedKeys) {
    if (key in filters) {
      const value = filters[key];
      delete filters[key];
      filters[`${key}Provided`] = Array.isArray(value) ? value.length > 0 : Boolean(value);
    }
  }
  return { ...event, filters };
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

function didNotRepeatPolicyBlockedAction(events: RecruitmentTraceEvent[]): boolean {
  let previousBlockedAction: string | null = null;
  for (const event of events) {
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

export function questionAddressesRoleAmbiguity(response: ConversationTurnResponse): boolean {
  const question = response.message;
  const asksAnotherDimension = /联赛|赛事|国籍|预算|年龄|身价|合同|薪资|市场/u.test(question);
  const addressesRole = /凯恩|替代者|接班人|替补|职责|角色|中锋|前锋|主力|首发|即战力|培养/u.test(question);
  const asksForAChoice = /还是|更偏向|优先|立即|即插即用|短期|长期|未来|潜力|培养|接班|主力|首发|哪种|什么样|什么类型/u.test(question);
  return !asksAnotherDimension && addressesRole && asksForAChoice;
}

export function questionMatchesClarificationIntent(
  intent: ClarificationIntent,
  response: ConversationTurnResponse,
): boolean {
  if (intent === "role_preference") return questionAddressesRoleAmbiguity(response);
  const question = response.message;
  const mentionsPosition = /位置|中锋|前锋|边锋|中场|后卫|ST|ATT/u.test(question);
  const asksToBroaden = /扩大|扩展|放宽|其他.{0,8}(?:位置|前锋|范围)|范围.{0,8}(?:扩大|扩展|放宽)|是否接受.{0,12}(?:其他|更宽)/u.test(question);
  const asksAnotherDimension = /年龄|预算|身价|国籍|合同|薪资|联赛|赛事|赛季/u.test(question);
  return mentionsPosition && asksToBroaden && !asksAnotherDimension;
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
  if (response.status === "needs_input") return candidateSearches.length > 0;
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
  if (progressEvents.some((event, index) => event.sequence !== index + 1
    || event.turn < 1
    || event.turn > input.answersUsed + 1)) return false;

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

  const finalTurn = input.answersUsed + 1;
  const expectedFinalStage = input.response.status === "needs_input" ? "asking_user" : "completed";
  const expectedFinalStatus = input.response.status === "needs_input" ? "waiting_for_user" : "completed";
  return progressEvents.some((event) => (
    event.turn === finalTurn && event.stage === expectedFinalStage && event.status === expectedFinalStatus
  ));
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
  const report = response.report;
  const expectedCapabilityCoverage = "expectedCapabilityCoverage" in scenario
    ? scenario.expectedCapabilityCoverage
    : undefined;
  const requestedCapabilities = "requestedCapabilities" in scenario
    ? scenario.requestedCapabilities
    : undefined;
  const commonChecks = {
    usedMultipleModelActions: successfulPlannerDecisions > 1,
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
    didNotRepeatPolicyBlockedAction: didNotRepeatPolicyBlockedAction(events),
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
    const candidatePagesFollowCursors = candidateSearchPagesFollowCursors(candidateSearches);
    const latestEvidenceEvaluation = successfulEvidenceEvaluations.at(-1);
    const latestEvidenceEvaluationIndex = latestEvidenceEvaluation ? events.lastIndexOf(latestEvidenceEvaluation) : -1;
    const successfulReportSearchAfterEvaluation = latestEvidenceEvaluationIndex >= 0 && events.some((event, index) => (
      index > latestEvidenceEvaluationIndex
      && isToolEvent(event)
      && event.toolName === "search_player_reports"
      && event.ok
    ));
    checks = {
      ...commonChecks,
      completedWithReport: response.status === "completed" && report !== null,
      requiredInvestigationToolsInOrder: includesInOrder(actualTools, scenario.requiredTools),
      noInferredCompetitionSeasonOrMinutesFilters: scopesAvoidUnauthorizedFilters,
      appliedUserAgeLimit: ageLimitApplied,
      broadPositionWasNotNarrowed: broadPositionPreserved,
      recommendationsRespectRequestedPosition: !report || !scenario.expectedBroadPosition
        || report.recommendations.every(({ player }) => positionMatches(player.position, scenario.expectedBroadPosition!)),
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
      && (candidateSearchPagesFollowCursors(constrainedPositionSearches)
        || candidateSearchPagesFollowCursors(allConstrainedPositionSearches));
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
    const broadenedSearchPaginationIsValid = candidateSearchPagesFollowCursors(broadenedSearches)
      || candidateSearchPagesFollowCursors(allBroadenedSearches);
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
        ? report.recommendations.every((recommendation) => positionMatches(
          recommendation.player.position,
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
              ? Boolean(report?.recommendations.every((recommendation) => positionMatches(
                recommendation.player.position,
                scenario.expectedBroadenedPosition!,
              )))
              : Boolean(report && explicitEmptyPositionLimitation(response, scenario.expectedBroadenedPosition)));
        }
        return Boolean(report && report.recommendations.length === 0
          && explicitEmptyPositionLimitation(response, scenario.expectedPosition));
      })(),
    };
  } else {
    checks = {
      ...commonChecks,
      ...(scenario.requireClarificationResume ? {
        ...clarificationResumeChecks(input, false),
      } : {}),
      ...(scenario.expectedPosition ? {
        searchedExpectedPosition: candidateSearches.some((event) => event.filters.position === scenario.expectedPosition),
        recommendationsMatchExpectedPosition: !report || report.recommendations.every((recommendation) => (
          recommendation.player.position === scenario.expectedPosition
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
