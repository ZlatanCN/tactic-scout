import { z } from "zod/v4";
import {
  CapabilityMetricKeySchema,
  type Position,
  type CapabilityEvidence,
  type CapabilityMetricKey,
  type PlayerProfile,
  type RequestedCapabilityCoverage,
} from "../domain/schemas.js";
import type { KnowledgeSearchResult } from "../knowledge/schemas.js";
import { positionMatches } from "../domain/positions.js";
import {
  AskUserActionSchema,
  FinishActionSchema,
  SearchCandidatesActionSchema,
  type ParsedRecruitmentAction,
} from "./recruitment-actions.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import type { EvaluatedCandidate } from "./recruitment-evidence-evaluator.js";
import type { CandidateIdentityGroupReference } from "../identity/candidate-groups.js";

export interface RecruitmentDecisionConstraints {
  targetTeam: string | null;
  evaluatedCandidates: Array<{ playerId: string; evidenceKeys: CapabilityMetricKey[] }>;
  reportObservations: Array<{ playerId: string; documentId: string; evidenceKeys: CapabilityMetricKey[] }>;
  requestedCapabilityCoverage: RequestedCapabilityCoverage[];
}

export interface RecruitmentExpansionConstraints {
  targetTeam: string | null;
  nextOffset: number;
  position: Position | null;
  playerName: string | null;
  maxAge: number | null;
  minimumMinutes: number;
  competition: string | null;
  season: string | null;
}

const requestedCapabilityEvidenceMappings: readonly {
  name: string;
  pattern: RegExp;
  metricKeys: readonly CapabilityMetricKey[];
}[] = [
  {
    name: "进攻一对一对抗",
    pattern: /进攻一对一(?:对抗)?|进攻s*1v1|attacking one[- ]on[- ]ones?|ground attacking duels?/i,
    metricKeys: ["wyscoutGroundAttackingDuelsPer90", "wyscoutExplicitlyWonGroundAttackingDuelSharePct"],
  },
  {
    name: "带球推进",
    pattern: /带球(?:向前)?推进|向前带球|渐进带球|progressive\s+(?:carry|carrying|dribble|dribbling)|progression by carrying/i,
    metricKeys: [],
  },
  {
    name: "推进",
    pattern: /推进|带球推进|渐进传球|progression|progressive(?:\s+passing)?/i,
    metricKeys: [
      "wyscoutProgressivePassesPer90",
      "wyscoutAccurateProgressivePassesPct",
      "lineBreakPassesCompletedPer30Tip",
    ],
  },
  {
    name: "压迫",
    pattern: /前场压迫|高位压迫|压迫|施压|逼抢|press(?:ing|ure)?/i,
    metricKeys: ["pressures"],
  },
  {
    name: "进球产出",
    pattern: /进球(?:产出|数|能力)?|破门|得分(?:能力|产出)?|终结(?!能力|技术|动作|选择|水准|技巧)|goal[- ]scoring|\bgoals?\b/i,
    metricKeys: ["goals", "premierLeagueGoalsPer90"],
  },
  {
    name: "创造机会",
    pattern: /创造机会|机会创造|做球|关键传球|射门助攻|chance creation|key passes?|shot assists?/i,
    metricKeys: ["assists", "shotAssists", "keyPasses", "asaExpectedAssistsPer90", "fplExpectedAssistsPer90", "premierLeagueAssistsPer90", "premierLeagueKeyPassesPer90", "understatExpectedAssistsPer90", "understatKeyPassesPer90"],
  },
  {
    name: "成功盘带",
    pattern: /成功盘带|过人(?:次数|能力|成功)?|盘带(?:能力|成功率|过人)?|successful dribbles?|take[- ]ons?/i,
    metricKeys: ["premierLeagueSuccessfulDribblesPer90"],
  },
  {
    name: "向前传球",
    pattern: /向前传球|前向传球|forward passes?/i,
    metricKeys: ["premierLeagueForwardPassesPer90"],
  },
  {
    name: "无球跑动",
    pattern: /无球跑动|身后跑动|套边跑动|前插跑动|off[- ]ball runs?|runs? in behind|overlapping runs?/i,
    metricKeys: ["behindRunsPer30Tip", "overlapRunsPer30Tip"],
  },
  {
    name: "防守事件参与",
    pattern: /抢断|拦截|地面对抗|防守对抗|防守事件|defensive actions?|tackles?|interceptions?/i,
    metricKeys: ["tacklesInterceptions", "wyscoutGroundDefensiveDuelsPer90", "wyscoutClearlyWonGroundDefensiveDuelPct", "premierLeagueTotalTacklesPer90", "premierLeagueTacklesWonPer90", "premierLeagueInterceptionsPer90"],
  },
  {
    name: "射门机会质量",
    pattern: /射门机会质量|非点球\s*xg|机会质量|non[- ]penalty\s*xg|xg per shot/i,
    metricKeys: ["statsbombNonPenaltyXgPer90", "statsbombNonPenaltyXgPerShot", "understatExpectedGoalsPer90", "understatNonPenaltyExpectedGoalsPer90", "understatExpectedGoalsPerShot", "asaExpectedGoalsPer90", "asaExpectedGoalsPerShot"],
  },
  {
    name: "射门终结",
    pattern: /射门终结|终结(?!产出)|门前把握|射术|finishing|shot conversion/i,
    metricKeys: [],
  },
  {
    name: "进攻接应",
    pattern: /接应|link[- ]up(?: play)?/i,
    metricKeys: [],
  },
  {
    name: "高强度跑动",
    pattern: /高强度跑动|冲刺距离|高强度跑动距离|high[- ]intensity running|sprint distance/i,
    metricKeys: ["highIntensityDistancePer90", "sprintDistancePer90", "highIntensityActionsPer90"],
  },
  {
    name: "压力下控球",
    pattern: /压力下控球|压迫下控球|护球|控球稳定|ball retention under pressure|press[- ]resistant/i,
    metricKeys: [],
  },
  {
    name: "防守站位",
    pattern: /防守站位|保护(?:防守)?空间|封锁线路|防守位置感|defensive positioning|covering space/i,
    metricKeys: [],
  },
  {
    name: "空中对抗",
    pattern: /空中对抗|制空|争顶|aerial duels?|aerial ability/i,
    metricKeys: ["premierLeagueAerialDuelsWonPer90"],
  },
  {
    name: "速度与加速",
    pattern: /绝对速度|加速(?:能力)?|起步速度|冲刺速度|acceleration|top speed/i,
    metricKeys: [],
  },
  {
    name: "进攻链条参与",
    pattern: /进攻链条|进攻串联|xg\s*chain|xg\s*buildup/i,
    metricKeys: ["understatXgChainPer90", "understatXgBuildupPer90"],
  },
];

function userExplicitlyRequestsCapability(userMessages: readonly string[], name: string, pattern: RegExp): boolean {
  const allText = userMessages.join("\n");
  const matcher = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, "")}g`);
  for (const match of allText.matchAll(matcher)) {
    const index = match.index ?? 0;
    const prefix = allText.slice(Math.max(0, index - 14), index);
    const negatedBefore = /(?:不要|不需要|无需|不考虑|不强调|不重视|不追求|不要求|不必|不看|don't need|no emphasis on|not prioritiz(?:e|ing))\s*$/i.test(prefix);
    const suffix = allText.slice(index + match[0].length, index + match[0].length + 10);
    const negatedAfter = /^\s*(?:不是(?:重点|优先项|主要诉求)|不重要|不需要|不必|无需)/i.test(suffix);
    const surrounding = allText.slice(Math.max(0, index - 20), index + match[0].length + 20);
    const meansPressResistance = name === "压迫" && /压迫下控球|压迫下持球|press[- ]resistant|resistant to pressing/i.test(surrounding);
    const meansCarryingProgression = name === "推进" && (
      /(?:带球(?:向前)?|向前带球|渐进带球)\s*$/i.test(prefix)
      || /^\s*(?:by\s+)?(?:carry(?:ing)?|dribbl(?:e|ing))\b/i.test(suffix)
    );
    if (!negatedBefore && !negatedAfter && !meansPressResistance && !meansCarryingProgression) {
      return true;
    }
  }
  return false;
}

export function requestedCapabilityEvidenceAreas(userMessages: readonly string[]): Array<{
  name: string;
  metricKeys: readonly CapabilityMetricKey[];
}> {
  const requested = requestedCapabilityEvidenceMappings.flatMap(({ name, pattern, metricKeys }) => (
    userExplicitlyRequestsCapability(userMessages, name, pattern) ? [{ name, metricKeys }] : []
  ));
  const explicitlyRequestsCarryingProgression = requested.some(({ name }) => name === "带球推进");
  return requested.filter(({ name }) => !(explicitlyRequestsCarryingProgression && name === "推进"));
}

export function summarizeRequestedCapabilityCoverage(input: {
  userMessages: readonly string[];
  evaluatedPlayers: EvaluatedCandidate[];
  candidateIdentityGroups?: readonly CandidateIdentityGroupReference[];
}): RequestedCapabilityCoverage[] {
  const eligibleAreas = requestedCapabilityEvidenceAreas(input.userMessages);
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

export function createConstrainedConclusionSchema(constraints: RecruitmentDecisionConstraints) {
  const requestedMetricKeys = new Set(constraints.requestedCapabilityCoverage.flatMap(({ requestedMetricKeys }) => requestedMetricKeys));
  const requestedCapabilitiesExist = constraints.requestedCapabilityCoverage.length > 0;
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
      linkedMetricKeys: z.array(CapabilityMetricKeySchema).max(0),
    });
  const constrainedFinishActionSchema = FinishActionSchema.extend({
    targetTeam: constraints.targetTeam === null ? z.null() : z.literal(constraints.targetTeam),
    needSummary: z.string().trim().min(1).max(500),
    capabilityProfile: z.array(z.string().trim().min(1).max(160)).max(8),
    recommendations: z.array(recommendationItemSchema)
      .min(requireEvidenceBackedLead ? 1 : 0)
      .max(recommendationPlayerIds.length ? 5 : 0)
      .describe(requireEvidenceBackedLead
        ? "给出有用户所述能力直接指标支持的后续考察线索；候选人和指标需经复核。"
        : "没有用户要求的直接指标证据时，不要用相邻数据替代推荐；可以为空。"),
    reportObservations: z.array(reportObservationItemSchema)
      .max(reportPlayerIds.length && reportDocumentIds.length ? 3 : 0).default([]),
  });
  const constrainedAskUserActionSchema = AskUserActionSchema.extend({
    question: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(1).max(300),
  });
  return z.discriminatedUnion("action", [constrainedAskUserActionSchema, constrainedFinishActionSchema]);
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
}): ParsedRecruitmentAction {
  const { decisionConstraints, expansionConstraints } = input;
  const coverage = decisionConstraints.requestedCapabilityCoverage;
  const hasMeasurableCoverageGap = coverage.some((area) => (
    area.requestedMetricKeys.length > 0 && area.status !== "observed"
  ));
  if (hasMeasurableCoverageGap) {
    return SearchCandidatesActionSchema.parse({
      action: "search_candidates",
      targetTeam: expansionConstraints.targetTeam,
      position: expansionConstraints.position,
      playerName: expansionConstraints.playerName,
      maxAge: expansionConstraints.maxAge,
      minimumMinutes: expansionConstraints.minimumMinutes,
      competition: expansionConstraints.competition,
      season: expansionConstraints.season,
      offset: expansionConstraints.nextOffset,
      limit: 20,
    });
  }

  const recommendations = recommendationsFromRequestedEvidence(decisionConstraints);
  return FinishActionSchema.parse({
    action: "finish",
    targetTeam: decisionConstraints.targetTeam,
    needSummary: "扩展决策未能生成有效动作，已根据当前可观测证据收束本轮调查。",
    capabilityProfile: coverage.slice(0, 8).map((area) => (
      `${area.name}：${coverageStatusLabel(area.status)}（${area.candidatesWithEvidenceCount}/${area.evaluatedCandidateCount}）`.slice(0, 120)
    )),
    recommendations,
    limitationKeys: ["other"],
    reportObservations: [],
  });
}

export function conclusionPlannerOutputFallback(
  decisionConstraints: RecruitmentDecisionConstraints,
): ParsedRecruitmentAction {
  const coverage = decisionConstraints.requestedCapabilityCoverage;
  return FinishActionSchema.parse({
    action: "finish",
    targetTeam: decisionConstraints.targetTeam,
    needSummary: "报告模型输出达到长度上限，系统按本轮已复核的比赛证据完成报告。",
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

function recommendationsFromRequestedEvidence(constraints: RecruitmentDecisionConstraints) {
  const requestedMetricKeys = new Set(constraints.requestedCapabilityCoverage.flatMap((area) => area.requestedMetricKeys));
  if (requestedMetricKeys.size === 0) return [];
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

export function createConstrainedReorientationSchema(constraints: RecruitmentDecisionConstraints) {
  const conclusionSchema = createConstrainedConclusionSchema(constraints);
  const constrainedFinishActionSchema = conclusionSchema.options.find((option) => {
    const action = option.shape.action;
    return action instanceof z.ZodLiteral && action.value === "finish";
  });
  if (!constrainedFinishActionSchema) throw new Error("Constrained finish action schema is missing.");
  return z.discriminatedUnion("action", [
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
  confirmedPosition?: Position | null;
  userMessages?: readonly string[];
  evaluatedPlayers: EvaluatedCandidate[];
  retrievedKnowledge: KnowledgeSearchResult[];
  candidateIdentityGroups?: readonly CandidateIdentityGroupReference[];
}): RecruitmentDecisionConstraints {
  const eligiblePlayers = input.evaluatedPlayers.filter(({ player }) =>
    !input.confirmedPosition || positionMatches(player.position, input.confirmedPosition),
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
      userMessages: input.userMessages ?? [],
      evaluatedPlayers: eligiblePlayers,
      ...(input.candidateIdentityGroups ? { candidateIdentityGroups: input.candidateIdentityGroups } : {}),
    }),
  };
}

export function alignRecommendationEvidenceToRequestedCapabilities(input: {
  action: ParsedRecruitmentAction | undefined;
  userMessages: readonly string[];
  evaluatedPlayers: Record<string, EvaluatedCandidate>;
}): { action: ParsedRecruitmentAction | undefined; repairedReferenceCount: number } {
  if (input.action?.action !== "finish") return { action: input.action, repairedReferenceCount: 0 };
  const areas = requestedCapabilityEvidenceAreas(input.userMessages);
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
  confirmedPosition?: Position | null;
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
  const requestedEvidenceAreas = requestedCapabilityEvidenceAreas(input.userMessages ?? []);
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
    if (input.confirmedPosition && !positionMatches(evaluated.player.position, input.confirmedPosition)) {
      problems.push(`球员 ${recommendation.playerId} 不符合用户确认的位置 ${input.confirmedPosition}。`);
      continue;
    }
    const availableKeys = new Set(evaluated.evidence.map((item) => item.key));
    const invalidKeys = recommendation.evidenceKeys.filter((key) => !availableKeys.has(key));
    if (invalidKeys.length) problems.push(`球员 ${recommendation.playerId} 引用了不存在的证据：${invalidKeys.join(", ")}`);
    const hasAnyRequestedEvidence = requestedEvidenceAreas.some((area) => (
      area.metricKeys.some((key) => availableKeys.has(key))
    ));
    if (requestedEvidenceAreas.length > 0 && !hasAnyRequestedEvidence) {
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
    if (input.confirmedPosition && !positionMatches(evaluated.player.position, input.confirmedPosition)) {
      problems.push(`球员 ${observation.playerId} 不符合用户确认的位置 ${input.confirmedPosition}，不能附加球员定性观察。`);
      continue;
    }
    if (!document || document.corpus !== "player_report") {
      problems.push(`报告文档 ${observation.documentId} 未在本轮球员报告检索结果中出现。`);
      continue;
    }
    if (!document.displayAllowed) problems.push(`来源 ${document.sourceName} 不允许在报告中展示。`);
    const eligiblePlayers = Object.values(input.evaluatedPlayers).filter(({ player }) =>
      !input.confirmedPosition || positionMatches(player.position, input.confirmedPosition),
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
