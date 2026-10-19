import { z } from "zod/v4";
import { CapabilityMetricKeySchema, type CapabilityMetricKey, type RequestedCapabilityCoverage } from "../domain/capabilities.js";
import { type PlayerProfile } from "../domain/players.js";
import { type Position } from "../domain/position-contracts.js";
import type { KnowledgeSearchResult } from "../knowledge/schemas.js";
import { playerPositionMatches } from "../domain/positions.js";
import {
  AskUserActionSchema,
  FinishActionSchema,
  SearchCandidatesActionSchema,
  ReadCaseEvidenceActionSchema,
  RecruitmentActionSchema,
  type RecruitmentPlannerAction,
  type ParsedRecruitmentAction,
} from "./recruitment-actions.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import type { EvaluatedCandidate } from "./recruitment-evidence-evaluator.js";
import type { CandidateIdentityGroupReference } from "../players/identity/candidate-groups.js";
import type { RecruitmentBrief } from "../domain/recruitment-brief.js";

export interface RecruitmentDecisionConstraints {
  targetTeam: string | null;
  evaluatedCandidates: Array<{ playerId: string; evidenceKeys: CapabilityMetricKey[] }>;
  reportObservations: Array<{ playerId: string; documentId: string; evidenceKeys: CapabilityMetricKey[] }>;
  requestedCapabilityCoverage: RequestedCapabilityCoverage[];
  candidateIdentityGroups?: CandidateIdentityGroupReference[];
}

export interface RecruitmentExpansionConstraints {
  positions?: Position[];
  targetTeam: string | null;
  nextOffset: number;
  position: Position | null;
  playerName: string | null;
  maxAge: number | null;
  minimumMinutes: number;
  competition: string | null;
  season: string | null;
}

import { requestedCapabilityEvidenceAreasForInput } from "../domain/recruitment-capabilities.js";
export { requestedCapabilityEvidenceAreas, requestedCapabilityEvidenceAreasFromBrief } from "../domain/recruitment-capabilities.js";

function resolveRequestedEvidenceAreas(input: {
  brief?: RecruitmentBrief | null;
  userMessages?: readonly string[];
}, position: Position | null | undefined, includeAbilityProfiles: boolean) {
  return requestedCapabilityEvidenceAreasForInput({ brief: input.brief, userMessages: input.userMessages ?? [] }, position, includeAbilityProfiles);
}

export function summarizeRequestedCapabilityCoverage(input: {
  userMessages?: readonly string[];
  brief?: RecruitmentBrief | null;
  evaluatedPlayers: EvaluatedCandidate[];
  candidateIdentityGroups?: readonly CandidateIdentityGroupReference[];
}): RequestedCapabilityCoverage[] {
  const eligibleAreas = resolveRequestedEvidenceAreas(input,
    input.evaluatedPlayers.length > 0 && input.evaluatedPlayers.every(candidate => candidate.player.position === "GK") ? "GK" : undefined,
    input.evaluatedPlayers.some(candidate => candidate.player.abilityProfile !== undefined));
  const identityGroupByPlayerId = new Map(input.candidateIdentityGroups?.flatMap((group) => (
    group.recordPlayerIds.map((playerId) => [playerId, group.identityKey] as const)
  )) ?? []);
  const identityKeyForCandidate = (candidate: EvaluatedCandidate) => (
    identityGroupByPlayerId.get(candidate.player.playerId) ?? `player:${candidate.player.playerId}`
  );
  return eligibleAreas.map((area) => {
    const evidenceByIdentity = new Map<string, boolean>();
    for (const candidate of input.evaluatedPlayers) {
      const identityKey = identityKeyForCandidate(candidate);
      evidenceByIdentity.set(identityKey, (evidenceByIdentity.get(identityKey) ?? false)
        || candidate.evidence.some((item) => area.metricKeys.includes(item.key)));
    }
    const candidatesWithEvidenceCount = [...evidenceByIdentity.values()].filter(Boolean).length;
    const observedKeys = new Set(input.evaluatedPlayers.flatMap(({ evidence }) => evidence
      .filter((item) => area.metricKeys.includes(item.key))
      .map(({ key }) => key)));
    const evaluatedCandidateCount = evidenceByIdentity.size;
    const status: RequestedCapabilityCoverage["status"] = candidatesWithEvidenceCount === 0
      ? "missing"
      : candidatesWithEvidenceCount < evaluatedCandidateCount ? "partial" : "observed";
    return {
      name: area.name,
      requestedMetricKeys: [...area.metricKeys],
      observedMetricKeys: area.metricKeys.filter((key) => observedKeys.has(key)),
      evaluatedCandidateCount,
      candidatesWithEvidenceCount,
      status,
    };
  });
}

export function createConstrainedConclusionSchema(
  constraints: RecruitmentDecisionConstraints,
  options: { allowReadCaseEvidence?: boolean } = {},
) {
  const requestedMetricKeys = new Set(constraints.requestedCapabilityCoverage.flatMap(({ requestedMetricKeys }) => requestedMetricKeys));
  const requestedCapabilitiesExist = requestedMetricKeys.size > 0;
  const candidateHasRequestedEvidence = (candidate: RecruitmentDecisionConstraints["evaluatedCandidates"][number]) => (
    candidate.evidenceKeys.some((key) => requestedMetricKeys.has(key))
  );
  const requireEvidenceBackedLead = constraints.evaluatedCandidates.some(candidateHasRequestedEvidence);
  const recommendationCandidates = constraints.evaluatedCandidates.filter((candidate) => {
    if (requireEvidenceBackedLead) return candidateHasRequestedEvidence(candidate);
    if (requestedCapabilitiesExist) return false;
    return candidate.evidenceKeys.length > 0;
  });
  const recommendationPlayerIds = recommendationCandidates.map(({ playerId }) => playerId);
  const recommendationEvidenceKeys = [...new Set(recommendationCandidates.flatMap(({ evidenceKeys }) => (
    requireEvidenceBackedLead
      ? evidenceKeys.filter((key) => requestedMetricKeys.has(key))
      : evidenceKeys
  )))];
  const reportPlayerIds = [...new Set(constraints.reportObservations.map(({ playerId }) => playerId))];
  const reportDocumentIds = [...new Set(constraints.reportObservations.map(({ documentId }) => documentId))];
  const reportEvidenceKeys = [...new Set(constraints.reportObservations.flatMap(({ evidenceKeys }) => evidenceKeys))];
  const recommendationItemSchema = recommendationPlayerIds.length
    ? z.object({
      playerId: z.enum(recommendationPlayerIds as [string, ...string[]]),
      evidenceKeys: z.array(z.enum(recommendationEvidenceKeys as [CapabilityMetricKey, ...CapabilityMetricKey[]])).min(1),
    })
    : z.object({
      playerId: z.string().min(1),
      evidenceKeys: z.array(CapabilityMetricKeySchema).min(1),
    });
  const reportObservationItemSchema = reportPlayerIds.length && reportDocumentIds.length
    ? z.object({
      playerId: z.enum(reportPlayerIds as [string, ...string[]]),
      documentId: z.enum(reportDocumentIds as [string, ...string[]]),
      summary: z.string().trim().min(1).max(280),
      linkedMetricKeys: z.array(reportEvidenceKeys.length
        ? z.enum(reportEvidenceKeys as [CapabilityMetricKey, ...CapabilityMetricKey[]])
        : CapabilityMetricKeySchema).max(reportEvidenceKeys.length ? 8 : 0),
    })
    : z.object({
      playerId: z.string().min(1),
      documentId: z.string().min(1),
      summary: z.string().trim().min(1).max(280),
      // No item can be accepted here, so an exhaustive metric enum adds no constraint.
      linkedMetricKeys: z.array(z.string()).max(0),
    });
  const constrainedFinishActionSchema = FinishActionSchema.extend({
    targetTeam: constraints.targetTeam === null ? z.null() : z.literal(constraints.targetTeam),
    needSummary: z.string().trim().min(1).max(500),
    capabilityProfile: z.array(z.string().trim().min(1).max(160)).max(8),
    recommendations: z.array(recommendationItemSchema)
      .min(recommendationPlayerIds.length ? 1 : 0)
      .max(recommendationPlayerIds.length ? 5 : 0)
      .describe(requireEvidenceBackedLead
        ? "给出有用户所述能力直接指标支持的后续考察线索；候选人和指标需经复核。"
        : "需求能力没有可测量项时，可依据已有统计给出待核实的考察线索；必须明确能力尚未核实，不能声称这些统计证明战术适配。没有任何表现证据时才为空。"),
    reportObservations: z.array(reportObservationItemSchema)
      .max(reportPlayerIds.length && reportDocumentIds.length ? 3 : 0).default([]),
  });
  const constrainedAskUserActionSchema = AskUserActionSchema.extend({
    question: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(1).max(300),
  });
  return options.allowReadCaseEvidence
    ? z.discriminatedUnion("action", [constrainedAskUserActionSchema, constrainedFinishActionSchema, ReadCaseEvidenceActionSchema])
    : z.discriminatedUnion("action", [constrainedAskUserActionSchema, constrainedFinishActionSchema]);
}

export function createConstrainedInvestigationSchema(availableActions: readonly RecruitmentPlannerAction[]) {
  const allowedActions = new Set<RecruitmentPlannerAction>([...availableActions, "ask_user", "finish"]);
  const options = RecruitmentActionSchema.options.filter((option) => {
    const discriminator = option.shape.action;
    return discriminator instanceof z.ZodLiteral
      && allowedActions.has(discriminator.value as RecruitmentPlannerAction);
  });
  if (options.length < 2) throw new Error("Investigation action schema must leave a safe ask-or-finish choice.");
  type ActionOption = (typeof RecruitmentActionSchema.options)[number];
  return z.discriminatedUnion("action", options as unknown as [ActionOption, ActionOption, ...ActionOption[]]);
}

export function createConstrainedExpansionSchema(
  decisionConstraints: RecruitmentDecisionConstraints,
  expansionConstraints: RecruitmentExpansionConstraints,
  options: { allowAskUser?: boolean } = {},
) {
  const conclusionSchema = createConstrainedConclusionSchema(decisionConstraints);
  const constrainedFinishActionSchema = conclusionSchema.options.find((option) => {
    const action = option.shape.action;
    return action instanceof z.ZodLiteral && action.value === "finish";
  });
  if (!constrainedFinishActionSchema) throw new Error("Constrained finish action schema is missing.");
  // Zod's .find() returns a union of both action schemas; runtime selection above
  // guarantees this is the constrained finish shape while retaining its refinements.
  const finishSchema = constrainedFinishActionSchema as unknown as typeof FinishActionSchema;
  const conciseFinishActionSchema = finishSchema.extend({
    needSummary: z.string().trim().min(1).max(280),
    capabilityProfile: z.array(z.string().trim().min(1).max(120)).max(5),
    recommendations: finishSchema.shape.recommendations.max(3),
  });
  const exactNullable = <T extends string | number>(value: T | null) => value === null ? z.null() : z.literal(value);
  const candidateSearchSchema = SearchCandidatesActionSchema.extend({
    targetTeam: expansionConstraints.targetTeam === null ? z.null() : z.literal(expansionConstraints.targetTeam),
    position: exactNullable(expansionConstraints.position),
    playerName: exactNullable(expansionConstraints.playerName),
    maxAge: exactNullable(expansionConstraints.maxAge),
    minimumMinutes: z.literal(expansionConstraints.minimumMinutes),
    competition: exactNullable(expansionConstraints.competition),
    season: exactNullable(expansionConstraints.season),
    offset: z.literal(expansionConstraints.nextOffset),
    limit: z.literal(20),
  });
  return options.allowAskUser === false
    ? z.discriminatedUnion("action", [candidateSearchSchema, conciseFinishActionSchema])
    : z.discriminatedUnion("action", [candidateSearchSchema, AskUserActionSchema, conciseFinishActionSchema]);
}

export function expansionPlannerFallback(input: {
  decisionConstraints: RecruitmentDecisionConstraints;
  expansionConstraints: RecruitmentExpansionConstraints;
  preserveExistingEvidence?: boolean;
  outcome?: "recovery" | "sufficient";
}): ParsedRecruitmentAction {
  const { decisionConstraints, expansionConstraints } = input;
  const coverage = decisionConstraints.requestedCapabilityCoverage;
  const measurableAreas = coverage.filter(area => area.requestedMetricKeys.length > 0);
  const completeLeads = decisionConstraints.evaluatedCandidates.filter(candidate => measurableAreas.every(area => (
    area.requestedMetricKeys.some(key => candidate.evidenceKeys.includes(key))
  )));
  const independentCompleteLeads = independentCandidates(completeLeads, decisionConstraints.candidateIdentityGroups);
  const preserveLeads = input.preserveExistingEvidence !== false
    && measurableAreas.length > 0
    && independentCompleteLeads.length >= 3;
  const hasMeasurableCoverageGap = coverage.some((area) => (
    area.requestedMetricKeys.length > 0 && area.status !== "observed"
  ));
  if (hasMeasurableCoverageGap && !preserveLeads) {
    return SearchCandidatesActionSchema.parse({
      action: "search_candidates",
      targetTeam: expansionConstraints.targetTeam,
      position: expansionConstraints.position,
      ...(expansionConstraints.positions ? { positions: expansionConstraints.positions } : {}),
      playerName: expansionConstraints.playerName,
      maxAge: expansionConstraints.maxAge,
      minimumMinutes: expansionConstraints.minimumMinutes,
      competition: expansionConstraints.competition,
      season: expansionConstraints.season,
      offset: expansionConstraints.nextOffset,
      limit: 20,
    });
  }

  const recommendations = recommendationsFromRequestedEvidence(preserveLeads
    ? { ...decisionConstraints, evaluatedCandidates: independentCompleteLeads }
    : decisionConstraints);
  return FinishActionSchema.parse({
    action: "finish",
    targetTeam: decisionConstraints.targetTeam,
    needSummary: fallbackNeedSummary(decisionConstraints, input.outcome === "sufficient"
      ? "当前已有多名候选共同覆盖用户明确提出的可测能力，本轮直接依据现有证据提供考察线索。"
      : "后续扩围未能完成，本轮先依据已经取得的证据提供考察线索。"),
    capabilityProfile: coverage.slice(0, 8).map((area) => (
      `${area.name}：${coverageStatusLabel(area.status)}（${area.candidatesWithEvidenceCount}/${area.evaluatedCandidateCount}）`.slice(0, 120)
    )),
    recommendations,
    limitationKeys: ["other"],
    reportObservations: [],
  });
}

/** Three independently evidenced leads can satisfy the user's measurable request without model-directed page expansion. */
export function expansionEvidenceIsSufficient(
  decisionConstraints: RecruitmentDecisionConstraints,
): boolean {
  const measurableAreas = decisionConstraints.requestedCapabilityCoverage
    .filter(area => area.requestedMetricKeys.length > 0);
  if (measurableAreas.length === 0
    || measurableAreas.length !== decisionConstraints.requestedCapabilityCoverage.length) return false;
  const completeCandidates = decisionConstraints.evaluatedCandidates.filter(candidate => measurableAreas.every(area => (
    area.requestedMetricKeys.some(key => candidate.evidenceKeys.includes(key))
  )));
  return independentCandidates(completeCandidates, decisionConstraints.candidateIdentityGroups).length >= 3;
}

function independentCandidates<T extends { playerId: string }>(
  candidates: readonly T[],
  groups: readonly CandidateIdentityGroupReference[] | undefined,
): T[] {
  const identityKeyFor = (playerId: string) => groups
    ?.find(group => group.status === "resolved" && group.recordPlayerIds.includes(playerId))?.identityKey
    ?? `record:${playerId}`;
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const identityKey = identityKeyFor(candidate.playerId);
    if (seen.has(identityKey)) return false;
    seen.add(identityKey);
    return true;
  });
}

export function conclusionPlannerOutputFallback(
  decisionConstraints: RecruitmentDecisionConstraints,
  options: { reason?: "output_limit" | "timeout" } = {},
): ParsedRecruitmentAction {
  const coverage = decisionConstraints.requestedCapabilityCoverage;
  const outcome = options.reason === "timeout"
    ? "报告规划超时，以下结论以本轮已核对的比赛证据为依据。"
    : "报告输出达到长度上限，以下结论以本轮已核对的比赛证据为依据。";
  return FinishActionSchema.parse({
    action: "finish",
    targetTeam: decisionConstraints.targetTeam,
    needSummary: fallbackNeedSummary(decisionConstraints, outcome),
    capabilityProfile: coverage.length
      ? coverage.slice(0, 8).map((area) => (
        `${area.name}：${coverageStatusLabel(area.status)}（${area.candidatesWithEvidenceCount}/${area.evaluatedCandidateCount}）`.slice(0, 120)
      ))
      : ["本轮结构化比赛证据已复核；因报告模型输出不完整，不作额外能力判断。"],
    recommendations: recommendationsFromRequestedEvidence(decisionConstraints),
    limitationKeys: ["other"],
    reportObservations: [],
  });
}

function fallbackNeedSummary(constraints: RecruitmentDecisionConstraints, outcome: string): string {
  const team = constraints.targetTeam ? `为${constraints.targetTeam}` : "为目标球队";
  const capabilities = constraints.requestedCapabilityCoverage.map(({ name }) => name).join("、");
  return `${team}寻找值得继续考察的球员${capabilities ? `，重点考察${capabilities}` : "，以可观察的比赛表现为依据"}。${outcome}`;
}

function recommendationsFromRequestedEvidence(constraints: RecruitmentDecisionConstraints) {
  const requestedMetricKeys = new Set(constraints.requestedCapabilityCoverage.flatMap((area) => area.requestedMetricKeys));
  if (requestedMetricKeys.size === 0) return constraints.evaluatedCandidates
    .filter((candidate) => candidate.evidenceKeys.length > 0)
    .slice(0, 3)
    .map(({ playerId, evidenceKeys }) => ({ playerId, evidenceKeys }));
  return constraints.evaluatedCandidates
    .map((candidate) => ({
      playerId: candidate.playerId,
      evidenceKeys: candidate.evidenceKeys.filter((key) => requestedMetricKeys.has(key)),
    }))
    .filter((candidate) => candidate.evidenceKeys.length > 0)
    .slice(0, 3);
}

function coverageStatusLabel(status: RequestedCapabilityCoverage["status"]): string {
  switch (status) {
    case "observed": return "已观察到";
    case "partial": return "部分候选有数据";
    case "missing": return "未观察到";
  }
}

export function createConstrainedReorientationSchema(
  constraints: RecruitmentDecisionConstraints,
  options: { allowReadCaseEvidence?: boolean } = {},
) {
  const conclusionSchema = createConstrainedConclusionSchema(constraints, options);
  const constrainedFinishActionSchema = conclusionSchema.options.find((option) => {
    const action = option.shape.action;
    return action instanceof z.ZodLiteral && action.value === "finish";
  });
  if (!constrainedFinishActionSchema) throw new Error("Constrained finish action schema is missing.");
  return options.allowReadCaseEvidence ? z.discriminatedUnion("action", [
    SearchCandidatesActionSchema,
    AskUserActionSchema,
    constrainedFinishActionSchema,
    ReadCaseEvidenceActionSchema,
  ]) : z.discriminatedUnion("action", [
    SearchCandidatesActionSchema,
    AskUserActionSchema,
    constrainedFinishActionSchema,
  ]);
}

function reportMatchesCandidate(
  document: KnowledgeSearchResult,
  player: PlayerProfile,
  eligiblePlayers: EvaluatedCandidate[],
): boolean {
  const normalizeEntityId = (value: string) => {
    const separator = value.indexOf(":");
    return separator < 0 ? value : `${value.slice(0, separator).toLocaleLowerCase()}:${value.slice(separator + 1)}`;
  };
  const documentIds = document.entityIds.map(normalizeEntityId);
  const candidateIds = [
    player.playerId,
    ...(player.sourceIdentity ? [`${player.sourceIdentity.provider}:${player.sourceIdentity.playerId}`] : []),
  ].map(normalizeEntityId);
  if (documentIds.length) return documentIds.some((id) => candidateIds.includes(id));
  const documentNames = new Set(document.entityNames.map(normalizeSearchText));
  const matchingCandidates = new Map<string, EvaluatedCandidate>();
  for (const candidate of eligiblePlayers) {
    if (documentNames.has(normalizeSearchText(candidate.player.name))) {
      matchingCandidates.set(candidate.player.playerId, candidate);
    }
  }
  return matchingCandidates.size === 1 && matchingCandidates.has(player.playerId);
}

export function buildDecisionConstraints(input: {
  targetTeam: string | null;
  brief?: RecruitmentBrief | null;
  confirmedPosition?: Position | null;
  confirmedPositions?: readonly Position[];
  userMessages?: readonly string[];
  evaluatedPlayers: EvaluatedCandidate[];
  retrievedKnowledge: KnowledgeSearchResult[];
  candidateIdentityGroups?: readonly CandidateIdentityGroupReference[];
}): RecruitmentDecisionConstraints {
  const eligiblePlayers = input.evaluatedPlayers.filter(({ player }) =>
    matchesConfirmedPosition(player, input),
  );
  const playerReportDocuments = input.retrievedKnowledge.filter((document) =>
    document.corpus === "player_report" && document.displayAllowed,
  );
  return {
    targetTeam: input.targetTeam,
    evaluatedCandidates: eligiblePlayers.map(({ player, evidence }) => ({
      playerId: player.playerId,
      evidenceKeys: evidence.map((item) => item.key),
    })),
    reportObservations: eligiblePlayers.flatMap(({ player, evidence }) => playerReportDocuments
      .filter((document) => reportMatchesCandidate(document, player, eligiblePlayers))
      .map((document) => ({
        playerId: player.playerId,
        documentId: document.documentId,
        evidenceKeys: evidence.map((item) => item.key),
      }))),
    requestedCapabilityCoverage: summarizeRequestedCapabilityCoverage({
      ...(input.brief !== undefined ? { brief: input.brief } : {}),
      userMessages: input.userMessages ?? [],
      evaluatedPlayers: eligiblePlayers,
      ...(input.candidateIdentityGroups ? { candidateIdentityGroups: input.candidateIdentityGroups } : {}),
    }),
    ...(input.candidateIdentityGroups ? { candidateIdentityGroups: [...input.candidateIdentityGroups] } : {}),
  };
}

export function alignRecommendationEvidenceToRequestedCapabilities(input: {
  action: ParsedRecruitmentAction | undefined;
  brief?: RecruitmentBrief | null;
  userMessages: readonly string[];
  evaluatedPlayers: Record<string, EvaluatedCandidate>;
}): { action: ParsedRecruitmentAction | undefined; repairedReferenceCount: number } {
  if (input.action?.action !== "finish") return { action: input.action, repairedReferenceCount: 0 };
  const areas = resolveRequestedEvidenceAreas(input, undefined, Object.values(input.evaluatedPlayers).some(candidate => candidate.player.abilityProfile !== undefined));
  let repairedReferenceCount = 0;
  const recommendations = input.action.recommendations.map((recommendation) => {
    const candidate = input.evaluatedPlayers[recommendation.playerId];
    if (!candidate) return recommendation;
    const availableKeys = new Set(candidate.evidence.map(({ key }) => key));
    const supportedAreas = areas.flatMap((area) => {
      const availableKeysForArea = area.metricKeys.filter((key) => availableKeys.has(key));
      return availableKeysForArea.length ? [{ areaKeys: area.metricKeys, availableKeys: availableKeysForArea }] : [];
    });
    if (!supportedAreas.length) return recommendation;

    const directlyRelevantKeys = new Set(supportedAreas.flatMap(({ availableKeys: keys }) => keys));
    const alignedKeys = recommendation.evidenceKeys.filter((key) => directlyRelevantKeys.has(key));
    for (const { areaKeys, availableKeys: areaAvailableKeys } of supportedAreas) {
      if (!alignedKeys.some((key) => areaKeys.includes(key))) alignedKeys.push(areaAvailableKeys[0]!);
    }
    const uniqueAlignedKeys = [...new Set(alignedKeys)];
    if (uniqueAlignedKeys.length !== recommendation.evidenceKeys.length
      || uniqueAlignedKeys.some((key, index) => key !== recommendation.evidenceKeys[index])) {
      repairedReferenceCount += Math.max(1, Math.abs(uniqueAlignedKeys.length - recommendation.evidenceKeys.length));
      return { ...recommendation, evidenceKeys: uniqueAlignedKeys };
    }
    return recommendation;
  });
  return {
    action: repairedReferenceCount
      ? { ...input.action, recommendations }
      : input.action,
    repairedReferenceCount,
  };
}

export function validateConclusion(input: {
  action: ParsedRecruitmentAction | undefined;
  brief?: RecruitmentBrief | null;
  confirmedPosition?: Position | null;
  confirmedPositions?: readonly Position[];
  userMessages?: readonly string[];
  evaluatedPlayers: Record<string, EvaluatedCandidate>;
  retrievedKnowledge: Record<string, KnowledgeSearchResult>;
  candidateIdentityGroups?: readonly CandidateIdentityGroupReference[];
}): string[] {
  const action = input.action;
  if (action?.action !== "finish") return ["当前动作不是最终推荐。"];
  const problems: string[] = [];
  const ids = new Set<string>();
  const identityGroupByPlayerId = new Map(input.candidateIdentityGroups?.flatMap((group) => (
    group.recordPlayerIds.map((playerId) => [playerId, group] as const)
  )) ?? []);
  const recommendedIdentityKeys = new Set<string>();
  const requestedEvidenceAreas = resolveRequestedEvidenceAreas(input, undefined, Object.values(input.evaluatedPlayers).some(candidate => candidate.player.abilityProfile !== undefined));
  for (const recommendation of action.recommendations) {
    if (ids.has(recommendation.playerId)) problems.push(`球员 ${recommendation.playerId} 被重复推荐。`);
    ids.add(recommendation.playerId);
    const identityGroup = identityGroupByPlayerId.get(recommendation.playerId);
    if (identityGroup?.status === "resolved") {
      if (recommendedIdentityKeys.has(identityGroup.identityKey)) {
        problems.push(`来源记录 ${recommendation.playerId} 与另一条已推荐记录属于同一条经精确 ID 核实的候选身份；同一人只能推荐一次。`);
      }
      recommendedIdentityKeys.add(identityGroup.identityKey);
    }
    const evaluated = input.evaluatedPlayers[recommendation.playerId];
    if (!evaluated) {
      problems.push(`球员 ${recommendation.playerId} 没有能力评估证据。`);
      continue;
    }
    if (!matchesConfirmedPosition(evaluated.player, input)) {
      problems.push(`球员 ${recommendation.playerId} 不符合用户确认的位置 ${input.confirmedPosition}。`);
      continue;
    }
    const availableKeys = new Set(evaluated.evidence.map((item) => item.key));
    const invalidKeys = recommendation.evidenceKeys.filter((key) => !availableKeys.has(key));
    if (invalidKeys.length) problems.push(`球员 ${recommendation.playerId} 引用了不存在的证据：${invalidKeys.join(", ")}`);
    const hasAnyRequestedEvidence = requestedEvidenceAreas.some((area) => (
      area.metricKeys.some((key) => availableKeys.has(key))
    ));
    if (requestedEvidenceAreas.some((area) => area.metricKeys.length > 0) && !hasAnyRequestedEvidence) {
      problems.push(`用户明确要求的能力没有对应的直接指标证据；球员 ${recommendation.playerId} 不能仅凭相邻统计作为该需求的推荐。`);
    }
    for (const area of requestedEvidenceAreas) {
      const matchingAvailableKeys = area.metricKeys.filter((key) => availableKeys.has(key));
      if (matchingAvailableKeys.length && !recommendation.evidenceKeys.some((key) => matchingAvailableKeys.includes(key))) {
        problems.push(`用户明确要求${area.name}能力；球员 ${recommendation.playerId} 有可用相关指标 ${matchingAvailableKeys.join("、")}，但推荐没有引用它们。低样本指标仍可作为有限线索引用，并说明样本风险。`);
      }
    }
  }
  for (const observation of action.reportObservations) {
    const document = Object.values(input.retrievedKnowledge).find((candidate) => candidate.documentId === observation.documentId);
    const evaluated = input.evaluatedPlayers[observation.playerId];
    if (!evaluated) {
      problems.push(`球员 ${observation.playerId} 没有比赛数据评估，不能附加球员定性观察。`);
      continue;
    }
    if (!matchesConfirmedPosition(evaluated.player, input)) {
      problems.push(`球员 ${observation.playerId} 不符合用户确认的位置 ${input.confirmedPosition}，不能附加球员定性观察。`);
      continue;
    }
    if (!document || document.corpus !== "player_report") {
      problems.push(`报告文档 ${observation.documentId} 未在本轮球员报告检索结果中出现。`);
      continue;
    }
    if (!document.displayAllowed) problems.push(`来源 ${document.sourceName} 不允许在报告中展示。`);
    const eligiblePlayers = Object.values(input.evaluatedPlayers).filter(({ player }) =>
      matchesConfirmedPosition(player, input),
    );
    if (!reportMatchesCandidate(document, evaluated.player, eligiblePlayers)) {
      problems.push(`报告文档 ${observation.documentId} 的实体元数据不匹配球员 ${evaluated.player.name}。`);
    }
    const availableKeys = new Set(evaluated.evidence.map((item) => item.key));
    const invalidKeys = observation.linkedMetricKeys.filter((key) => !availableKeys.has(key));
    if (invalidKeys.length) problems.push(`球员定性观察引用了不存在的比赛指标：${invalidKeys.join(", ")}`);
  }
  return problems;
}

function matchesConfirmedPosition(player: EvaluatedCandidate["player"], input: { confirmedPosition?: Position | null; confirmedPositions?: readonly Position[] }): boolean {
  const positions = input.confirmedPositions?.length ? input.confirmedPositions : input.confirmedPosition ? [input.confirmedPosition] : [];
  return !positions.length || positions.some((position) => playerPositionMatches(player, position));
}
