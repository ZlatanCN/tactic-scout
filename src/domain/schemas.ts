import { z } from "zod/v4";

export const PositionSchema = z.enum(["GK", "DEF", "CB", "FB", "LB", "RB", "LWB", "RWB", "MID", "DM", "CM", "AM", "ATT", "WG", "LW", "RW", "ST"]);
export type Position = z.infer<typeof PositionSchema>;
export const PlayerPositionSchema = z.union([PositionSchema, z.literal("UNKNOWN")]);
export type PlayerPosition = z.infer<typeof PlayerPositionSchema>;

export const PlayerPositionEvidenceSchema = z.object({
  provider: z.string().min(1),
  targetPosition: PositionSchema,
  status: z.enum(["pending", "direct", "compatible", "not_observed", "unavailable", "broad_only"]),
  sourceScope: z.enum(["season_position_aggregate"]).optional(),
  season: z.string().nullable(),
  sourceCodes: z.array(z.string()),
  sampleMinutes: z.number().nonnegative().nullable(),
});
export type PlayerPositionEvidence = z.infer<typeof PlayerPositionEvidenceSchema>;

export const DatasetModeSchema = z.enum(["demo", "statsbomb", "sportmonks", "skillcorner", "wyscout", "fbref", "fpl", "premier_league", "asa", "understat", "mosaic", "curated"]);
export type DatasetMode = z.infer<typeof DatasetModeSchema>;

export const DatasetScopeSchema = z.object({
  kind: z.enum(["fictional_demo", "historical_sample", "current_limited"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  limitations: z.array(z.string().min(1)),
  datasetId: z.string().min(1).optional(),
  datasetBuiltAt: z.string().datetime().optional(),
  observedCoverage: z.object({
    playerRecordCount: z.number().int().nonnegative(),
    competitions: z.array(z.string().min(1)),
    seasons: z.array(z.string().min(1)),
  }).optional(),
});
export type DatasetScope = z.infer<typeof DatasetScopeSchema>;

export const InPossessionRoleSchema = z.enum(["progression", "retention", "creation"]);
export type InPossessionRole = z.infer<typeof InPossessionRoleSchema>;

export const OutOfPossessionRoleSchema = z.enum(["pressing", "defensive_disruption"]);
export type OutOfPossessionRole = z.infer<typeof OutOfPossessionRoleSchema>;

export const RolePhaseSchema = z.enum(["in_possession", "out_of_possession"]);

export const ScoutInputSchema = z.object({
  targetTeam: z.string().trim().min(1).describe("Club the recommendation is for"),
  query: z.string().optional().describe("Original natural-language scouting brief"),
  position: PositionSchema,
  maxAge: z.number().int().min(15).max(45).optional(),
  inPossessionRoles: z.array(InPossessionRoleSchema).default([]),
  outOfPossessionRoles: z.array(OutOfPossessionRoleSchema).default([]),
  topK: z.number().int().min(1).max(10).default(5),
  includeUnknownAge: z.boolean().default(false),
}).refine(
  (value) => value.inPossessionRoles.length + value.outOfPossessionRoles.length > 0,
  { message: "至少选择一项有球或无球职责。" },
);
export type ScoutInput = z.infer<typeof ScoutInputSchema>;

export const RequirementsSchema = z.object({
  targetTeam: z.string().trim().min(1),
  position: PositionSchema,
  maxAge: z.number().int().min(15).max(45).optional(),
  inPossessionRoles: z.array(InPossessionRoleSchema).default([]),
  outOfPossessionRoles: z.array(OutOfPossessionRoleSchema).default([]),
  includeUnknownAge: z.boolean().default(false),
  topK: z.number().int().min(1).max(10).default(5),
}).refine(
  (value) => value.inPossessionRoles.length + value.outOfPossessionRoles.length > 0,
  { message: "至少选择一项有球或无球职责。" },
);
export type Requirements = z.infer<typeof RequirementsSchema>;

export const RawStatsSchema = z.object({
  goals: z.number().default(0),
  assists: z.number().default(0),
  passesAttempted: z.number().default(0),
  passesCompleted: z.number().default(0),
  longPasses: z.number().default(0),
  carries: z.number().default(0),
  pressures: z.number().default(0),
  tackles: z.number().default(0),
  interceptions: z.number().default(0),
  shotAssists: z.number().default(0),
  keyPasses: z.number().default(0),
});

export const RawStatKeySchema = z.enum([
  "goals",
  "assists",
  "passesAttempted",
  "passesCompleted",
  "longPasses",
  "carries",
  "pressures",
  "tackles",
  "interceptions",
  "shotAssists",
  "keyPasses",
]);
export type RawStatKey = z.infer<typeof RawStatKeySchema>;

export const PlayerDataSourceIdentitySchema = z.object({
  provider: z.string().min(1),
  playerId: z.string().min(1),
  providerIdentifiers: z.array(z.object({
    provider: z.string().min(1),
    namespace: z.string().min(1),
    externalId: z.string().min(1),
    sourceField: z.string().min(1),
  })).optional(),
  teamId: z.string().optional(),
  competitionId: z.string().optional(),
  seasonId: z.string().optional(),
  positionGroup: z.string().optional(),
  positionGroups: z.array(PositionSchema).optional(),
  positionSamples: z.array(z.object({
    position: PositionSchema,
    minutes: z.number().nonnegative(),
  })).optional(),
  sourcePositionLabels: z.array(z.string()).optional(),
  retrievedAt: z.string().datetime(),
  isCurrentSeason: z.boolean().optional(),
});
export type PlayerDataSourceIdentity = z.infer<typeof PlayerDataSourceIdentitySchema>;

export const SupplementaryMetricKeySchema = z.enum([
  "wyscoutGroundAttackingDuelsPer90",
  "wyscoutExplicitlyWonGroundAttackingDuelSharePct",
  "wyscoutGroundDefensiveDuelsPer90",
  "wyscoutClearlyWonGroundDefensiveDuelPct",
  "wyscoutProgressivePassesPer90",
  "wyscoutAccurateProgressivePassesPct",
  "highIntensityDistancePer90",
  "sprintDistancePer90",
  "highIntensityActionsPer90",
  "behindRunsPer30Tip",
  "overlapRunsPer30Tip",
  "lineBreakPassesCompletedPer30Tip",
  "passesToRunsCompletionPct",
  "statsbombNonPenaltyXgPer90",
  "statsbombNonPenaltyXgPerShot",
  "fplExpectedGoalsPer90",
  "fplExpectedAssistsPer90",
  "fplExpectedGoalInvolvementsPer90",
  "fplTacklesPer90",
  "fplRecoveriesPer90",
  "fplClearancesBlocksInterceptionsPer90",
  "premierLeagueGoalsPer90",
  "premierLeagueAssistsPer90",
  "premierLeagueKeyPassesPer90",
  "premierLeagueSuccessfulDribblesPer90",
  "premierLeagueTotalTacklesPer90",
  "premierLeagueTacklesWonPer90",
  "premierLeagueInterceptionsPer90",
  "premierLeagueRecoveriesPer90",
  "premierLeagueForwardPassesPer90",
  "premierLeagueAerialDuelsWonPer90",
  "asaExpectedGoalsPer90",
  "asaExpectedAssistsPer90",
  "asaExpectedGoalContributionsPer90",
  "asaExpectedGoalsPerShot",
  "asaShotsPer90",
  "asaPassCompletionPct",
  "asaExpectedPassCompletionPct",
  "asaPassesCompletedOverExpectedPer100",
  "asaAverageVerticalPassDistanceYards",
  "asaGoalsAddedTotalAboveAveragePer90",
  "asaGoalsAddedDribblingPer90",
  "asaGoalsAddedFoulingPer90",
  "asaGoalsAddedInterruptingPer90",
  "asaGoalsAddedPassingPer90",
  "asaGoalsAddedReceivingPer90",
  "asaGoalsAddedShootingPer90",
  "understatExpectedGoalsPer90",
  "understatNonPenaltyExpectedGoalsPer90",
  "understatExpectedAssistsPer90",
  "understatExpectedGoalsPerShot",
  "understatShotsPer90",
  "understatKeyPassesPer90",
  "understatXgChainPer90",
  "understatXgBuildupPer90",
]);
export type SupplementaryMetricKey = z.infer<typeof SupplementaryMetricKeySchema>;

export const SupplementaryMetricNormalizationSchema = z.enum(["per90", "per30Tip", "percentage", "perShot", "per100", "perAttempt"]);
export type SupplementaryMetricNormalization = z.infer<typeof SupplementaryMetricNormalizationSchema>;

export const SupplementaryPerformanceMetricSchema = z.object({
  key: SupplementaryMetricKeySchema,
  definition: z.string().min(1),
  value: z.number().nullable(),
  unit: z.string(),
  normalization: SupplementaryMetricNormalizationSchema,
  sourceScope: z.enum(["season_position_aggregate"]).optional(),
  sourceField: z.string().min(1),
  sampleMinutes: z.number().nonnegative().nullable(),
  sampleMatches: z.number().int().nonnegative().nullable(),
  sampleAttempts: z.number().int().nonnegative().nullable().optional(),
  sampleAttemptsLabel: z.string().min(1).optional(),
});
export type SupplementaryPerformanceMetric = z.infer<typeof SupplementaryPerformanceMetricSchema>;

export const PlayerProfileSchema = z.object({
  playerId: z.string(),
  externalPlayerId: z.string().optional(),
  name: z.string(),
  team: z.string(),
  age: z.number().int().nullable(),
  ageSource: z.string().optional(),
  ageVerifiedAt: z.string().optional(),
  position: PlayerPositionSchema,
  positionEvidence: PlayerPositionEvidenceSchema.optional(),
  competition: z.string(),
  season: z.string(),
  minutes: z.number().nonnegative(),
  appearanceMatchCount: z.number().int().nonnegative().optional(),
  datasetId: z.string().min(1).optional(),
  datasetBuiltAt: z.string().datetime().optional(),
  stats: RawStatsSchema,
  sourceIdentity: PlayerDataSourceIdentitySchema.optional(),
  sourceUrl: z.string().url().optional(),
  availableStats: z.array(RawStatKeySchema).optional(),
  supplementaryMetrics: z.array(SupplementaryPerformanceMetricSchema).optional(),
  eventDataComplete: z.boolean().optional(),
  source: z.string(),
});
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;

export const Per90Schema = z.object({
  goals: z.number().nullable(),
  assists: z.number().nullable(),
  passesAttempted: z.number().nullable(),
  passCompletionPct: z.number().nullable(),
  longPasses: z.number().nullable(),
  carries: z.number().nullable(),
  pressures: z.number().nullable(),
  tacklesInterceptions: z.number().nullable(),
  shotAssists: z.number().nullable(),
  keyPasses: z.number().nullable(),
});
export type Per90 = z.infer<typeof Per90Schema>;

export const RoleAssessmentSchema = z.object({
  phase: RolePhaseSchema,
  role: z.union([InPossessionRoleSchema, OutOfPossessionRoleSchema]),
  fit: z.number().min(0).max(100).nullable(),
  evidence: z.array(z.string()),
  unsupportedAttributes: z.array(z.string()),
});
export type RoleAssessment = z.infer<typeof RoleAssessmentSchema>;

export const RankedCandidateSchema = z.object({
  player: PlayerProfileSchema,
  per90: Per90Schema,
  inPossessionFit: z.number().min(0).max(100).nullable(),
  outOfPossessionFit: z.number().min(0).max(100).nullable(),
  tacticalFit: z.number().min(0).max(100),
  score: z.number().min(0).max(100),
  roleAssessments: z.array(RoleAssessmentSchema),
  reasons: z.array(z.string()),
  risks: z.array(z.string()),
});
export type RankedCandidate = z.infer<typeof RankedCandidateSchema>;

export const ReviewSchema = z.object({
  evidenceCompleteness: z.number().min(0).max(1),
  evidenceCoverage: z.number().min(0).max(1),
  findings: z.array(z.string()),
  retryRecommended: z.boolean(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const ScoutResponseSchema = z.object({
  targetTeam: z.string(),
  requirements: RequirementsSchema,
  dataSource: z.string(),
  datasetMode: DatasetModeSchema,
  candidates: z.array(RankedCandidateSchema),
  review: ReviewSchema,
  caveats: z.array(z.string()),
});
export type ScoutResponse = z.infer<typeof ScoutResponseSchema>;

export const DatasetSnapshotStatusSchema = z.object({
  datasetId: z.string().min(1),
  builtAt: z.string().datetime(),
  playerSeasonRecords: z.number().int().nonnegative(),
  uniquePlayers: z.number().int().nonnegative(),
  teams: z.number().int().nonnegative(),
  matches: z.number().int().nonnegative(),
  competitions: z.array(z.string()),
  seasons: z.array(z.string()),
  metrics: z.array(z.object({
    key: z.string().min(1),
    availableRecords: z.number().int().nonnegative(),
    totalRecords: z.number().int().nonnegative(),
    coverageRatio: z.number().min(0).max(1),
    unit: z.string(),
  })),
});
export type DatasetSnapshotStatus = z.infer<typeof DatasetSnapshotStatusSchema>;

export const DatasetStatusSchema = z.object({
  mode: DatasetModeSchema,
  source: z.string(),
  snapshot: DatasetSnapshotStatusSchema.nullable().optional(),
});
export type DatasetStatus = z.infer<typeof DatasetStatusSchema>;

export const ConversationTurnRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4000),
  expectsExistingState: z.boolean().default(false),
});
export type ConversationTurnRequest = z.infer<typeof ConversationTurnRequestSchema>;

export const CapabilityMetricKeySchema = z.enum([
  "goals",
  "assists",
  "shotAssists",
  "keyPasses",
  "carries",
  "longPasses",
  "passCompletionPct",
  "pressures",
  "tacklesInterceptions",
  ...SupplementaryMetricKeySchema.options,
]);
export type CapabilityMetricKey = z.infer<typeof CapabilityMetricKeySchema>;

export const CapabilityMetricDefinitions = [
  { key: "goals", label: "进球", unit: "次/90" },
  { key: "assists", label: "助攻", unit: "次/90" },
  { key: "shotAssists", label: "射门助攻", unit: "次/90" },
  { key: "keyPasses", label: "关键传球", unit: "次/90" },
  { key: "carries", label: "带球", unit: "次/90" },
  { key: "longPasses", label: "长传", unit: "次/90" },
  { key: "passCompletionPct", label: "传球成功率", unit: "%" },
  { key: "pressures", label: "施压", unit: "次/90" },
  { key: "tacklesInterceptions", label: "抢断与拦截", unit: "次/90" },
] as const satisfies readonly { key: CapabilityMetricKey; label: string; unit: string }[];

export const SupplementaryCapabilityMetricDefinitions = [
  { key: "wyscoutGroundAttackingDuelsPer90", label: "地面进攻对抗 /90", definition: "Wyscout Ground attacking duel 子事件中带 701、702 或 703 之一的记录数，按估算出场分钟归一到每 90 分钟；它是进攻对抗事件频次，不等同于成功盘带或渐进带球。", unit: "次/90分钟", normalization: "per90" },
  { key: "wyscoutExplicitlyWonGroundAttackingDuelSharePct", label: "进攻对抗明确胜出占比（含中性）", definition: "Wyscout Ground attacking duel 子事件中带 703（明确胜出）的比例；分母包含 701（明确失利）和 702（中性）。这是简化的事件结果分类，不等同于通常意义的过人成功率或盘带成功率。", unit: "%", normalization: "percentage" },
  { key: "wyscoutGroundDefensiveDuelsPer90", label: "地面防守对抗 /90", definition: "Wyscout Ground defending duel 子事件次数，按估算出场分钟归一到每 90 分钟；这是事件频次，不等同于抢断次数。", unit: "次/90分钟", normalization: "per90" },
  { key: "wyscoutClearlyWonGroundDefensiveDuelPct", label: "明确胜出占比（含中性结果）", definition: "Wyscout Ground defending duel 子事件中带 703（明确胜出）的比例；分母包括 701（明确失利）和 702（中性）。这是较简单的事件结果分类，不等同于通常意义的对抗成功率或抢断成功率。", unit: "%", normalization: "percentage" },
  { key: "wyscoutProgressivePassesPer90", label: "渐进传球（推算）", definition: "根据传球起终点 x 坐标的向前距离推算：起终点均在本方半场需前进至少 30 米，跨越中线需至少 15 米，均在对方半场需至少 10 米。假设 100 个坐标点对应 105 米，再按估算出场分钟归一到每 90 分钟；不是来源直接提供的字段。", unit: "次/90分钟", normalization: "per90" },
  { key: "wyscoutAccurateProgressivePassesPct", label: "渐进传球成功率（推算）", definition: "仅统计按同一分区门槛判定为渐进的传球（本方半场至少前进 30 米、跨越中线至少 15 米、对方半场至少 10 米）；其中带有 Wyscout 成功标签 1801 的比例。假设 100 个坐标点对应 105 米，且依赖坐标、成功/失败标签完整；不是来源直接提供的字段。", unit: "%", normalization: "percentage" },
  { key: "highIntensityDistancePer90", label: "高强度跑动距离", definition: "来源全场高强度跑动距离按样本分钟归一到每 90 分钟。", unit: "米/90分钟", normalization: "per90" },
  { key: "sprintDistancePer90", label: "冲刺距离", definition: "来源全场冲刺距离按样本分钟归一到每 90 分钟。", unit: "米/90分钟", normalization: "per90" },
  { key: "highIntensityActionsPer90", label: "高强度跑动次数", definition: "来源全场高强度跑动次数按样本分钟归一到每 90 分钟。", unit: "次/90分钟", normalization: "per90" },
  { key: "behindRunsPer30Tip", label: "身后跑动", definition: "来源统计的身后无球跑动次数，按每 30 分钟球队持球时间标准化。", unit: "次/30分钟持球", normalization: "per30Tip" },
  { key: "overlapRunsPer30Tip", label: "套边跑动", definition: "来源统计的套边无球跑动次数，按每 30 分钟球队持球时间标准化。", unit: "次/30分钟持球", normalization: "per30Tip" },
  { key: "lineBreakPassesCompletedPer30Tip", label: "完成的穿线传球", definition: "来源统计的完成穿线传球次数，按每 30 分钟球队持球时间标准化。", unit: "次/30分钟持球", normalization: "per30Tip" },
  { key: "passesToRunsCompletionPct", label: "向跑动传球成功率", definition: "来源统计的向跑动传球完成率。", unit: "%", normalization: "percentage" },
  { key: "statsbombNonPenaltyXgPer90", label: "非点球 xG /90", definition: "StatsBomb 为每次非点球射门提供的 statsbomb_xg 之和，按样本实际出场分钟归一到每 90 分钟；排除点球和点球大战。它衡量射门机会的数量与质量，不是射门转化率或未来进球预测。", unit: "xG/90分钟", normalization: "per90" },
  { key: "statsbombNonPenaltyXgPerShot", label: "非点球平均射门 xG", definition: "StatsBomb 非点球射门的 statsbomb_xg 平均值（非点球 xG 总和 ÷ 非点球射门数），排除点球和点球大战。表示平均机会质量，不是球员射门技术或终结能力评分。", unit: "xG/次射门", normalization: "perShot" },
  { key: "fplExpectedGoalsPer90", label: "FPL xG /90", definition: "Fantasy Premier League 当前赛季 `expected_goals` 总量按来源分钟数归一到每 90 分钟；是来源 xG 模型对已获得射门机会的估计，不代表终结能力或未来进球保证。", unit: "xG/90分钟", normalization: "per90" },
  { key: "fplExpectedAssistsPer90", label: "FPL xA /90", definition: "Fantasy Premier League 当前赛季 `expected_assists` 总量按来源分钟数归一到每 90 分钟；是来源对传球最终形成助攻机会的估计，不等同于关键传球数。", unit: "xA/90分钟", normalization: "per90" },
  { key: "fplExpectedGoalInvolvementsPer90", label: "FPL xGI /90", definition: "Fantasy Premier League 当前赛季 `expected_goal_involvements` 总量按来源分钟数归一到每 90 分钟；这是来源提供的 xG 与 xA 综合字段，不代表完整进攻贡献。", unit: "xGI/90分钟", normalization: "per90" },
  { key: "fplTacklesPer90", label: "FPL 抢断 /90", definition: "Fantasy Premier League 当前赛季 `tackles` 总量按来源分钟数归一到每 90 分钟；保留来源动作定义，不等同于抢断成功率或全部防守贡献。", unit: "次/90分钟", normalization: "per90" },
  { key: "fplRecoveriesPer90", label: "FPL 球权恢复 /90", definition: "Fantasy Premier League 当前赛季 `recoveries` 总量按来源分钟数归一到每 90 分钟；是来源记录的球权恢复动作次数，不揭示发生位置或球队压迫结构。", unit: "次/90分钟", normalization: "per90" },
  { key: "fplClearancesBlocksInterceptionsPer90", label: "FPL 解围、封堵与拦截 /90", definition: "Fantasy Premier League 当前赛季 `clearances_blocks_interceptions` 合并总量按来源分钟数归一到每 90 分钟；来源未拆分三种动作，不能解释为单独拦截数。", unit: "次/90分钟", normalization: "per90" },
  { key: "premierLeagueGoalsPer90", label: "Premier League 进球 /90", definition: "Premier League 当前赛季来源统计字段 `goals`，按 `timePlayed` 分钟归一到每 90 分钟；只表示已记录进球产出，不表示终结能力或未来进球预测。", unit: "次/90分钟", normalization: "per90" },
  { key: "premierLeagueAssistsPer90", label: "Premier League 助攻 /90", definition: "Premier League 当前赛季来源统计字段 `goalAssists`，按 `timePlayed` 分钟归一到每 90 分钟；只表示已记录助攻，不代表机会创造质量。", unit: "次/90分钟", normalization: "per90" },
  { key: "premierLeagueKeyPassesPer90", label: "Premier League 关键传球 /90", definition: "Premier League 当前赛季来源字段 `keyPassesAttemptAssists`，按 `timePlayed` 分钟归一到每 90 分钟；按官方球员统计页面的 Key Passes 类别报告，不代表机会质量或完整创造力。", unit: "次/90分钟", normalization: "per90" },
  { key: "premierLeagueSuccessfulDribblesPer90", label: "Premier League 成功盘带 /90", definition: "Premier League 当前赛季来源字段 `successfulDribbles`，按 `timePlayed` 分钟归一到每 90 分钟；表示成功盘带次数，不说明推进距离、方向或推进后的场地价值。", unit: "次/90分钟", normalization: "per90" },
  { key: "premierLeagueTotalTacklesPer90", label: "Premier League 抢断动作 /90", definition: "Premier League 当前赛季来源字段 `totalTackles`，按 `timePlayed` 分钟归一到每 90 分钟；保留来源抢断动作口径，不等同于全部防守参与或抢断成功率。", unit: "次/90分钟", normalization: "per90" },
  { key: "premierLeagueTacklesWonPer90", label: "Premier League 成功抢断 /90", definition: "Premier League 当前赛季来源字段 `tacklesWon`，按 `timePlayed` 分钟归一到每 90 分钟；保留来源成功抢断定义，不等同于整体对抗成功率。", unit: "次/90分钟", normalization: "per90" },
  { key: "premierLeagueInterceptionsPer90", label: "Premier League 拦截 /90", definition: "Premier League 当前赛季来源字段 `interceptions`，按 `timePlayed` 分钟归一到每 90 分钟；表示记录到的拦截次数，不揭示防线位置或压迫协同。", unit: "次/90分钟", normalization: "per90" },
  { key: "premierLeagueRecoveriesPer90", label: "Premier League 球权恢复 /90", definition: "Premier League 当前赛季来源字段 `recoveries`，按 `timePlayed` 分钟归一到每 90 分钟；表示来源记录的球权恢复次数，不揭示发生区域或压迫结构。", unit: "次/90分钟", normalization: "per90" },
  { key: "premierLeagueForwardPassesPer90", label: "Premier League 向前传球 /90", definition: "Premier League 当前赛季来源字段 `forwardPasses`，按 `timePlayed` 分钟归一到每 90 分钟；仅表示向前传球次数，不等同于渐进传球、穿透防线或推进价值。", unit: "次/90分钟", normalization: "per90" },
  { key: "premierLeagueAerialDuelsWonPer90", label: "Premier League 空中对抗胜出 /90", definition: "Premier League 当前赛季来源字段 `aerialDuelsWon`，按 `timePlayed` 分钟归一到每 90 分钟；表示空中对抗胜出次数，不等同于争顶成功率。", unit: "次/90分钟", normalization: "per90" },
  { key: "asaExpectedGoalsPer90", label: "ASA xG /90", definition: "American Soccer Analysis (ASA) 当前赛事当前赛季 `xgoals` 按 ASA 记录的出场分钟归一到每 90 分钟；描述射门机会质量/数量，不是终结能力或未来进球预测。", unit: "xG/90分钟", normalization: "per90" },
  { key: "asaExpectedAssistsPer90", label: "ASA xA /90", definition: "ASA 当前赛事当前赛季 `xassists` 按该 xGoals 记录的出场分钟归一到每 90 分钟；表示预期助攻，不等于创造机会的完整评估。", unit: "xA/90分钟", normalization: "per90" },
  { key: "asaExpectedGoalContributionsPer90", label: "ASA xG+xA /90", definition: "ASA 当前赛事当前赛季来源字段 `xgoals_plus_xassists` 按记录分钟数归一到每 90 分钟；这是来源合并指标，不等于完整进攻贡献。", unit: "xG+xA/90分钟", normalization: "per90" },
  { key: "asaExpectedGoalsPerShot", label: "ASA 平均射门 xG", definition: "TactiScout 以 ASA `xgoals ÷ shots` 派生；表示该样本平均射门机会质量，不代表射术或终结能力。", unit: "xG/次射门", normalization: "perShot" },
  { key: "asaShotsPer90", label: "ASA 射门 /90", definition: "ASA 当前赛事当前赛季来源 `shots` 按记录分钟数归一到每 90 分钟；描述射门频次，不说明射门技术。", unit: "次/90分钟", normalization: "per90" },
  { key: "asaPassCompletionPct", label: "ASA 传球成功率", definition: "ASA 当前赛事当前赛季 xPass 表中的来源 `pass_completion_percentage`；仅描述来源口径下已完成传球比例，不表示压迫下控球能力。", unit: "%", normalization: "percentage" },
  { key: "asaExpectedPassCompletionPct", label: "ASA 预期传球成功率", definition: "ASA 当前赛事当前赛季 xPass 模型的来源 `xpass_completion_percentage`；描述所尝试传球的模型难度期望，不是实际成功率或创造力评分。", unit: "%", normalization: "percentage" },
  { key: "asaPassesCompletedOverExpectedPer100", label: "ASA 超预期完成传球 /100 次", definition: "ASA 当前赛事当前赛季来源 `passes_completed_over_expected_p100`；按每 100 次尝试表示实际完成数相对 xPass 期望的差值，不能单独解释传球方向或风险。", unit: "次/100次传球", normalization: "per100" },
  { key: "asaAverageVerticalPassDistanceYards", label: "ASA 平均纵向传球距离", definition: "ASA 当前赛事当前赛季来源 `avg_vertical_distance_yds`；按 ASA 坐标口径表示每次尝试的平均纵向传球距离，不等同于渐进传球次数。", unit: "码/次传球", normalization: "perAttempt" },
  { key: "asaGoalsAddedTotalAboveAveragePer90", label: "ASA g+ 高于平均值 /90", definition: "将 ASA 当前赛事当前赛季六类 g+ 动作来源字段 `goals_added_above_avg` 相加，再按 g+ 样本分钟归一到每 90 分钟；只有六类均可用时才提供。它是来源的综合场上价值指标，不是 TactiScout 的球队适配或转会评分。", unit: "g+/90分钟", normalization: "per90" },
  { key: "asaGoalsAddedDribblingPer90", label: "ASA 带球动作 g+ /90", definition: "ASA 当前赛事当前赛季 `Dribbling` 类 `goals_added_above_avg` 按样本分钟归一到每 90 分钟；表示这类动作贡献的来源价值，不代表向前带球距离或过人成功率。", unit: "g+/90分钟", normalization: "per90" },
  { key: "asaGoalsAddedFoulingPer90", label: "ASA 犯规动作 g+ /90", definition: "ASA 当前赛事当前赛季 `Fouling` 类 `goals_added_above_avg` 按样本分钟归一到每 90 分钟；保留来源动作与正负值，不作为防守适配分。", unit: "g+/90分钟", normalization: "per90" },
  { key: "asaGoalsAddedInterruptingPer90", label: "ASA 防守中断动作 g+ /90", definition: "ASA 当前赛事当前赛季 `Interrupting` 类 `goals_added_above_avg` 按样本分钟归一到每 90 分钟；表示来源为该类防守动作估算的价值，不等于抢断次数或压迫成功率。", unit: "g+/90分钟", normalization: "per90" },
  { key: "asaGoalsAddedPassingPer90", label: "ASA 传球动作 g+ /90", definition: "ASA 当前赛事当前赛季 `Passing` 类 `goals_added_above_avg` 按样本分钟归一到每 90 分钟；表示传球动作贡献的来源价值，不等于渐进传球或关键传球数。", unit: "g+/90分钟", normalization: "per90" },
  { key: "asaGoalsAddedReceivingPer90", label: "ASA 接球动作 g+ /90", definition: "ASA 当前赛事当前赛季 `Receiving` 类 `goals_added_above_avg` 按样本分钟归一到每 90 分钟；表示接球动作贡献的来源价值，不等同于无球跑动测量。", unit: "g+/90分钟", normalization: "per90" },
  { key: "asaGoalsAddedShootingPer90", label: "ASA 射门动作 g+ /90", definition: "ASA 当前赛事当前赛季 `Shooting` 类 `goals_added_above_avg` 按样本分钟归一到每 90 分钟；表示射门动作的来源价值，不等同于射术或射门转化率。", unit: "g+/90分钟", normalization: "per90" },
  { key: "understatExpectedGoalsPer90", label: "Understat xG /90", definition: "Understat 当前赛季来源字段 `xG` 按记录分钟归一到每 90 分钟；表示来源模型估计的射门机会数量与质量，不是终结能力或未来进球保证。", unit: "xG/90分钟", normalization: "per90" },
  { key: "understatNonPenaltyExpectedGoalsPer90", label: "Understat 非点球 xG /90", definition: "Understat 当前赛季来源字段 `npxG` 按记录分钟归一到每 90 分钟；表示非点球射门机会的模型估计，不是终结能力或未来进球保证。", unit: "npxG/90分钟", normalization: "per90" },
  { key: "understatExpectedAssistsPer90", label: "Understat xA /90", definition: "Understat 当前赛季来源字段 `xA` 按记录分钟归一到每 90 分钟；表示来源模型估计的预期助攻，不等同于关键传球数量或完整创造能力。", unit: "xA/90分钟", normalization: "per90" },
  { key: "understatExpectedGoalsPerShot", label: "Understat 平均射门 xG", definition: "TactiScout 以 Understat 当前赛季来源字段 `xG ÷ shots` 派生；描述该样本平均射门机会质量，不代表球员射术或终结能力。", unit: "xG/次射门", normalization: "perShot" },
  { key: "understatShotsPer90", label: "Understat 射门 /90", definition: "Understat 当前赛季来源字段 `shots` 按记录分钟归一到每 90 分钟；表示射门频率，不说明射门技术或机会质量。", unit: "次/90分钟", normalization: "per90" },
  { key: "understatKeyPassesPer90", label: "Understat 关键传球 /90", definition: "Understat 当前赛季来源字段 `key_passes` 按记录分钟归一到每 90 分钟；保留来源关键传球口径，不等同于预期助攻或机会质量。", unit: "次/90分钟", normalization: "per90" },
  { key: "understatXgChainPer90", label: "Understat xGChain /90", definition: "Understat 当前赛季来源字段 `xGChain` 按记录分钟归一到每 90 分钟；保留来源进攻链条参与指标，不解释为个人射门或助攻产出。", unit: "xGChain/90分钟", normalization: "per90" },
  { key: "understatXgBuildupPer90", label: "Understat xGBuildup /90", definition: "Understat 当前赛季来源字段 `xGBuildup` 按记录分钟归一到每 90 分钟；保留来源进攻组织链条指标，不等同于渐进传球或个人创造机会。", unit: "xGBuildup/90分钟", normalization: "per90" },
] as const satisfies readonly { key: SupplementaryMetricKey; label: string; definition: string; unit: string; normalization: SupplementaryMetricNormalization }[];

export const CapabilityEvidenceSchema = z.object({
  key: CapabilityMetricKeySchema,
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  peerPercentile: z.number().min(0).max(100).nullable(),
  peerGroupSize: z.number().int().nonnegative(),
  peerPercentileUnavailableReason: z.enum(["candidate_low_sample", "candidate_sample_unknown", "insufficient_peer_group", "competition_scope_unreported"]).optional(),
  minutes: z.number().nonnegative().nullable(),
  sampleMatches: z.number().int().nonnegative().optional(),
  sampleAttempts: z.number().int().nonnegative().optional(),
  sampleAttemptsLabel: z.string().min(1).optional(),
  competition: z.string(),
  season: z.string(),
  source: z.string(),
  sourceScope: z.enum(["season_position_aggregate"]).optional(),
  sourceField: z.string().optional(),
  definition: z.string().optional(),
  normalization: SupplementaryMetricNormalizationSchema.optional(),
});
export type CapabilityEvidence = z.infer<typeof CapabilityEvidenceSchema>;

export const RequestedCapabilityCoverageSchema = z.object({
  name: z.string().min(1),
  requestedMetricKeys: z.array(CapabilityMetricKeySchema),
  observedMetricKeys: z.array(CapabilityMetricKeySchema),
  evaluatedCandidateCount: z.number().int().nonnegative(),
  candidatesWithEvidenceCount: z.number().int().nonnegative(),
  status: z.enum(["missing", "partial", "observed"]),
});
export type RequestedCapabilityCoverage = z.infer<typeof RequestedCapabilityCoverageSchema>;

export const PlayerEloSignalSchema = z.object({
  provider: z.literal("PlayerElo"),
  providerPlayerId: z.string().min(1),
  playerName: z.string().min(1),
  elo: z.number().finite(),
  earLabel: z.string().nullable(),
  currentTeam: z.string().nullable(),
  currentLeague: z.string().nullable(),
  position: z.string().nullable(),
  identityMatch: z.enum(["exact_provider_id", "reep_crosswalk"]),
  identitySourceProvider: z.string().min(1),
  identitySourcePlayerId: z.string().min(1),
  identityCrosswalk: z.object({
    provider: z.literal("Reep"),
    releaseStamp: z.string().min(1),
    canonicalId: z.string().min(1),
    sourceRungs: z.array(z.string()),
    apiFootballRungs: z.array(z.string()),
  }).nullable().optional(),
  retrievedAt: z.string().datetime(),
}).refine(
  (signal) => signal.identityMatch !== "reep_crosswalk" || signal.identityCrosswalk != null,
  { path: ["identityCrosswalk"], message: "Reep crosswalk signals require crosswalk provenance." },
);
export type PlayerEloSignal = z.infer<typeof PlayerEloSignalSchema>;

export const ExternalSignalCoverageSchema = z.object({
  status: z.enum(["disabled", "not_run", "complete", "partial", "failed"]),
  disabledReason: z.enum(["api_key_missing", "report_display_not_allowed", "local_retention_not_allowed"]).nullable(),
  identityUnavailableCandidates: z.number().int().nonnegative(),
  directIdentityCandidates: z.number().int().nonnegative().default(0),
  crosswalkIdentityCandidates: z.number().int().nonnegative().default(0),
  checkedCandidates: z.number().int().nonnegative(),
  matchedCandidates: z.number().int().nonnegative(),
  failedCandidates: z.number().int().nonnegative(),
});
export type ExternalSignalCoverage = z.infer<typeof ExternalSignalCoverageSchema>;

export function createEmptyExternalSignalCoverage(
  status: ExternalSignalCoverage["status"] = "not_run",
  disabledReason: ExternalSignalCoverage["disabledReason"] = null,
): ExternalSignalCoverage {
  return {
    status,
    disabledReason,
    identityUnavailableCandidates: 0,
    directIdentityCandidates: 0,
    crosswalkIdentityCandidates: 0,
    checkedCandidates: 0,
    matchedCandidates: 0,
    failedCandidates: 0,
  };
}

export const HistoricalArchiveMetricSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number().finite(),
  unit: z.string(),
  definition: z.string().min(1),
  sourceField: z.string().min(1),
});

export const HistoricalArchiveSampleSchema = z.object({
  provider: z.literal("Wyscout Open Data"),
  providerPlayerId: z.string().min(1),
  playerName: z.string().min(1),
  team: z.string().min(1),
  competition: z.string().min(1),
  season: z.string().min(1),
  minutes: z.number().nonnegative(),
  metrics: z.array(HistoricalArchiveMetricSchema),
  license: z.literal("CC BY 4.0"),
  licenseUrl: z.literal("https://creativecommons.org/licenses/by/4.0/"),
  attribution: z.string().min(1),
  sourceUrl: z.string().url(),
  identityLink: z.object({
    reepReleaseStamp: z.string().min(1),
    reepId: z.string().min(1),
    sourceProvider: z.string().min(1),
    sourcePlayerId: z.string().min(1),
    sourceBridge: z.object({
      provider: z.string().min(1),
      namespace: z.string().min(1),
      externalId: z.string().min(1),
      sourceField: z.string().min(1).nullable(),
    }).optional(),
    sourceRung: z.string().nullable(),
    archiveRung: z.string().nullable(),
    sourceUpstreamStatus: z.string().nullable(),
    archiveUpstreamStatus: z.string().nullable(),
  }),
});
export type HistoricalArchiveSample = z.infer<typeof HistoricalArchiveSampleSchema>;

export const HistoricalArchiveCoverageSchema = z.object({
  status: z.enum(["disabled", "not_run", "complete", "partial", "failed"]),
  disabledReason: z.enum([
    "report_display_not_allowed",
    "local_retention_not_allowed",
    "reep_index_missing",
    "wyscout_archive_missing",
    "primary_source_is_archive",
  ]).nullable(),
  checkedCandidates: z.number().int().nonnegative(),
  mappedCandidates: z.number().int().nonnegative(),
  matchedCandidates: z.number().int().nonnegative(),
  failedCandidates: z.number().int().nonnegative(),
});
export type HistoricalArchiveCoverage = z.infer<typeof HistoricalArchiveCoverageSchema>;

export const CandidateIdentityResolutionStatusSchema = z.enum([
  "not_run",
  "resolved",
  "ambiguous",
  "not_found",
  "de_corroborated",
  "withheld",
  "target_not_published",
  "unsupported_provider",
  "registry_unavailable",
  "missing_source_identity",
]);
export type CandidateIdentityResolutionStatus = z.infer<typeof CandidateIdentityResolutionStatusSchema>;

export const CandidateIdentityCoverageSchema = z.object({
  registryAvailable: z.boolean(),
  releaseStamp: z.string().nullable(),
  sourceRecordCount: z.number().int().nonnegative(),
  resolvedIdentityCount: z.number().int().nonnegative(),
  resolvedSourceRecordCount: z.number().int().nonnegative(),
  unresolvedSourceRecordCount: z.number().int().nonnegative(),
  resolutionStatusCounts: z.array(z.object({
    status: CandidateIdentityResolutionStatusSchema,
    count: z.number().int().nonnegative(),
  })),
});
export type CandidateIdentityCoverage = z.infer<typeof CandidateIdentityCoverageSchema>;

export const CandidateIdentitySourceEvidenceSchema = z.object({
  sourceRecordId: z.string().min(1),
  source: z.string().min(1),
  provider: z.string().min(1),
  team: z.string().min(1),
  competition: z.string().min(1),
  season: z.string().min(1),
  retrievedAt: z.string().datetime().nullable(),
  minutes: z.number().nonnegative(),
  evaluated: z.boolean(),
  sourceUrl: z.string().url().optional(),
  evidence: z.array(CapabilityEvidenceSchema),
});
export type CandidateIdentitySourceEvidence = z.infer<typeof CandidateIdentitySourceEvidenceSchema>;

const NullableSourceTextSchema = z.string().nullable();
const NullableSourceNumberSchema = z.number().finite().nullable();

export const UnderstatPlayerResearchSchema = z.object({
  playerId: z.string().min(1),
  name: z.string().min(1),
  team: z.string().min(1),
  competition: z.string().min(1),
  season: z.string().min(1),
  sourcePlayerId: z.string().regex(/^[1-9]\d{0,14}$/),
  sourceUrl: z.string().url(),
  retrievedAt: z.string().datetime(),
  player: z.object({ id: z.string(), name: z.string(), favoritePosition: NullableSourceTextSchema }),
  lastMatch: z.object({ league: NullableSourceTextSchema, team: NullableSourceTextSchema, season: NullableSourceTextSchema }).nullable(),
  requestedSections: z.array(z.enum(["positions", "history", "recent", "shotProfile", "shots"])),
  availableSections: z.array(z.enum(["positions", "history", "recent", "shotProfile", "shots"])),
  positions: z.array(z.object({
    season: z.string(), code: z.string(), minutes: NullableSourceNumberSchema, games: NullableSourceNumberSchema,
    goals: NullableSourceNumberSchema, shots: NullableSourceNumberSchema, xG: NullableSourceNumberSchema,
    assists: NullableSourceNumberSchema, xA: NullableSourceNumberSchema, keyPasses: NullableSourceNumberSchema,
    npxG: NullableSourceNumberSchema, xGChain: NullableSourceNumberSchema, xGBuildup: NullableSourceNumberSchema,
  })).optional(),
  history: z.array(z.object({
    season: z.string(), team: NullableSourceTextSchema, position: NullableSourceTextSchema,
    games: NullableSourceNumberSchema, minutes: NullableSourceNumberSchema, goals: NullableSourceNumberSchema,
    shots: NullableSourceNumberSchema, xG: NullableSourceNumberSchema, assists: NullableSourceNumberSchema,
    xA: NullableSourceNumberSchema, keyPasses: NullableSourceNumberSchema, npxG: NullableSourceNumberSchema,
    xGChain: NullableSourceNumberSchema, xGBuildup: NullableSourceNumberSchema,
  })).optional(),
  recent: z.array(z.object({
    matchId: z.string(), date: NullableSourceTextSchema, season: NullableSourceTextSchema,
    homeTeam: NullableSourceTextSchema, awayTeam: NullableSourceTextSchema, homeGoals: NullableSourceNumberSchema,
    awayGoals: NullableSourceNumberSchema, position: NullableSourceTextSchema, minutes: NullableSourceNumberSchema,
    goals: NullableSourceNumberSchema, shots: NullableSourceNumberSchema, xG: NullableSourceNumberSchema,
    assists: NullableSourceNumberSchema, xA: NullableSourceNumberSchema, keyPasses: NullableSourceNumberSchema,
    npxG: NullableSourceNumberSchema, xGChain: NullableSourceNumberSchema, xGBuildup: NullableSourceNumberSchema,
  })).optional(),
  shotProfile: z.array(z.object({
    season: z.string(), dimension: z.enum(["situation", "shotZones", "shotTypes"]), category: z.string(),
    goals: NullableSourceNumberSchema, shots: NullableSourceNumberSchema, xG: NullableSourceNumberSchema,
    assists: NullableSourceNumberSchema, keyPasses: NullableSourceNumberSchema, xA: NullableSourceNumberSchema,
    npg: NullableSourceNumberSchema, npxG: NullableSourceNumberSchema, minutes: NullableSourceNumberSchema,
  })).optional(),
  shots: z.array(z.object({
    matchId: z.string(), date: NullableSourceTextSchema, minute: NullableSourceTextSchema,
    result: NullableSourceTextSchema, xG: NullableSourceNumberSchema, sourceX: NullableSourceNumberSchema,
    sourceY: NullableSourceNumberSchema, situation: NullableSourceTextSchema, shotType: NullableSourceTextSchema,
    lastAction: NullableSourceTextSchema, assistedBy: NullableSourceTextSchema,
  })).optional(),
  notes: z.array(z.string()),
});
export type UnderstatPlayerResearch = z.infer<typeof UnderstatPlayerResearchSchema>;

export const UnderstatTeamResearchSchema = z.object({
  team: z.string().min(1), competition: z.string().min(1), season: z.string().min(1), sourceUrl: z.string().url(), retrievedAt: z.string().datetime(),
  recentMatches: z.array(z.object({
    matchId: z.string(), date: NullableSourceTextSchema, status: NullableSourceTextSchema,
    homeTeam: NullableSourceTextSchema, awayTeam: NullableSourceTextSchema,
    homeGoals: NullableSourceNumberSchema, awayGoals: NullableSourceNumberSchema,
    homeXG: NullableSourceNumberSchema, awayXG: NullableSourceNumberSchema, result: NullableSourceTextSchema,
  })),
  statistics: z.array(z.object({
    dimension: z.string(), category: z.string(), shots: NullableSourceNumberSchema, goals: NullableSourceNumberSchema,
    xG: NullableSourceNumberSchema, againstShots: NullableSourceNumberSchema, againstGoals: NullableSourceNumberSchema,
    againstXG: NullableSourceNumberSchema, attempts: NullableSourceNumberSchema, time: NullableSourceNumberSchema,
  })),
  players: z.array(z.object({
    id: z.string(), name: z.string(), position: NullableSourceTextSchema, games: NullableSourceNumberSchema,
    minutes: NullableSourceNumberSchema, goals: NullableSourceNumberSchema, xG: NullableSourceNumberSchema,
    assists: NullableSourceNumberSchema, xA: NullableSourceNumberSchema, shots: NullableSourceNumberSchema,
    keyPasses: NullableSourceNumberSchema, xGChain: NullableSourceNumberSchema, xGBuildup: NullableSourceNumberSchema,
  })),
  notes: z.array(z.string()),
});
export type UnderstatTeamResearch = z.infer<typeof UnderstatTeamResearchSchema>;

export const UnderstatMatchResearchSchema = z.object({
  matchId: z.string(), sourceUrl: z.string().url(), homeTeam: NullableSourceTextSchema, awayTeam: NullableSourceTextSchema,
  date: NullableSourceTextSchema, score: z.object({ home: NullableSourceNumberSchema, away: NullableSourceNumberSchema }),
  rosters: z.array(z.object({
    team: z.enum(["home", "away"]), playerId: NullableSourceTextSchema, name: NullableSourceTextSchema,
    position: NullableSourceTextSchema, positionOrder: NullableSourceNumberSchema, minutes: NullableSourceNumberSchema,
    goals: NullableSourceNumberSchema, ownGoals: NullableSourceNumberSchema, shots: NullableSourceNumberSchema,
    xG: NullableSourceNumberSchema, assists: NullableSourceNumberSchema, xA: NullableSourceNumberSchema,
    keyPasses: NullableSourceNumberSchema, yellowCards: NullableSourceNumberSchema, redCards: NullableSourceNumberSchema,
  })),
  shots: z.array(z.object({
    team: z.enum(["home", "away"]), playerId: NullableSourceTextSchema, player: NullableSourceTextSchema,
    minute: NullableSourceTextSchema, result: NullableSourceTextSchema, xG: NullableSourceNumberSchema,
    sourceX: NullableSourceNumberSchema, sourceY: NullableSourceNumberSchema, situation: NullableSourceTextSchema,
    shotType: NullableSourceTextSchema, lastAction: NullableSourceTextSchema, assistedBy: NullableSourceTextSchema,
  })),
  notes: z.array(z.string()),
});
export type UnderstatMatchResearch = z.infer<typeof UnderstatMatchResearchSchema>;

export const PlayerRecommendationSchema = z.object({
  player: PlayerProfileSchema,
  identityResolution: z.object({
    status: CandidateIdentityResolutionStatusSchema,
    releaseStamp: z.string().nullable(),
    sourceRecordCount: z.number().int().positive(),
  }).optional(),
  sourceEvidenceRecords: z.array(CandidateIdentitySourceEvidenceSchema).default([]),
  rationale: z.string(),
  comparisonNotes: z.array(z.string()).max(3).default([]),
  referenceComparisonNotes: z.array(z.string()).max(4).default([]),
  strengths: z.array(z.string()),
  tradeoffs: z.array(z.string()),
  focusEvidenceKeys: z.array(CapabilityMetricKeySchema),
  evidence: z.array(CapabilityEvidenceSchema),
  externalSignals: z.array(PlayerEloSignalSchema).default([]),
  historicalArchiveSamples: z.array(HistoricalArchiveSampleSchema).default([]),
  reportObservations: z.array(z.object({
    summary: z.string(),
    verificationStatus: z.enum(["unverified", "linked_to_match_data"]),
    linkedMetricKeys: z.array(CapabilityMetricKeySchema),
    source: z.object({
      sourceId: z.string(),
      sourceName: z.string(),
      title: z.string(),
      url: z.string().url(),
      author: z.string(),
      publisher: z.string(),
      publishedAt: z.string().nullable(),
      license: z.string(),
      attribution: z.string(),
    }),
  })).default([]),
  understatResearch: UnderstatPlayerResearchSchema.optional(),
});
export type PlayerRecommendation = z.infer<typeof PlayerRecommendationSchema>;

export const ReferenceProfileMetricSchema = z.object({
  key: CapabilityMetricKeySchema,
  label: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1),
  definition: z.string().optional(),
});

export const ReportReferenceProfileSchema = z.object({
  playerId: z.string().min(1),
  name: z.string().min(1),
  source: z.string().min(1),
  competition: z.string().min(1),
  season: z.string().min(1),
  minutes: z.number().nonnegative(),
  metrics: z.array(ReferenceProfileMetricSchema),
});
export type ReportReferenceProfile = z.infer<typeof ReportReferenceProfileSchema>;

export const HistoricalArchiveCandidateEvidenceSchema = z.object({
  player: PlayerProfileSchema,
  samples: z.array(HistoricalArchiveSampleSchema).min(1),
});
export type HistoricalArchiveCandidateEvidence = z.infer<typeof HistoricalArchiveCandidateEvidenceSchema>;

export const EvidenceCoverageSummarySchema = z.object({
  evidenceAvailability: z.enum(["available", "experimentally_withheld"]).optional(),
  evaluatedCandidateCount: z.number().int().nonnegative(),
  evaluatedSourceRecordCount: z.number().int().nonnegative().default(0),
  availableMetricValues: z.number().int().nonnegative(),
  expectedMetricValues: z.number().int().nonnegative(),
  lowSampleCandidates: z.number().int().nonnegative(),
  limitedPeerGroupCandidates: z.number().int().nonnegative(),
});
export type EvidenceCoverageSummary = z.infer<typeof EvidenceCoverageSummarySchema>;

export const MethodologySourceReferenceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  author: z.string().min(1),
  publisher: z.string().min(1),
  publishedAt: z.string().nullable(),
  license: z.string().min(1),
  attribution: z.string().min(1),
});
export type MethodologySourceReference = z.infer<typeof MethodologySourceReferenceSchema>;

export const KnowledgeCoverageSchema = z.object({
  methodologyChunksRetrieved: z.number().int().nonnegative(),
  methodologySearchFailed: z.boolean().default(false),
  methodologySources: z.array(MethodologySourceReferenceSchema).default([]),
  playerReportSearchPerformed: z.boolean(),
  playerReportSearchFailed: z.boolean().default(false),
  playerReportChunksRetrieved: z.number().int().nonnegative(),
});
export type KnowledgeCoverage = z.infer<typeof KnowledgeCoverageSchema>;

export const RecruitmentSearchScopeSchema = z.object({
  position: PositionSchema.nullable(),
  maxAge: z.number().int().min(15).max(45).nullable(),
  minimumMinutes: z.number().int().nonnegative(),
  competition: z.string().nullable(),
  season: z.string().nullable(),
  source: z.enum(["agent_interpreted", "user_confirmed", "mixed"]),
});
export type RecruitmentSearchScope = z.infer<typeof RecruitmentSearchScopeSchema>;

export const PositionLeadSchema = z.object({
  player: PlayerProfileSchema,
  status: z.enum(["broad_only", "pending", "not_observed", "unavailable"]),
});
export type PositionLead = z.infer<typeof PositionLeadSchema>;

export const RecruitmentReportSchema = z.object({
  targetTeam: z.string().nullable(),
  needSummary: z.string(),
  capabilityProfile: z.array(z.string()),
  referenceProfiles: z.array(ReportReferenceProfileSchema).max(5).default([]),
  referenceNameSource: z.object({ entityId: z.string().regex(/^Q\d+$/), url: z.string().regex(/^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/) }).nullable().default(null),
  requestedCapabilityCoverage: z.array(RequestedCapabilityCoverageSchema).default([]),
  evidenceCoverage: EvidenceCoverageSummarySchema,
  externalSignalCoverage: ExternalSignalCoverageSchema.default(() => createEmptyExternalSignalCoverage()),
  historicalArchiveCoverage: HistoricalArchiveCoverageSchema.default({
    status: "not_run",
    disabledReason: null,
    checkedCandidates: 0,
    mappedCandidates: 0,
    matchedCandidates: 0,
    failedCandidates: 0,
  }),
  historicalArchiveCandidates: z.array(HistoricalArchiveCandidateEvidenceSchema).default([]),
  understatTeamResearch: UnderstatTeamResearchSchema.optional(),
  understatMatchResearch: z.array(UnderstatMatchResearchSchema).max(3).default([]),
  candidateIdentityCoverage: CandidateIdentityCoverageSchema.default({
    registryAvailable: false,
    releaseStamp: null,
    sourceRecordCount: 0,
    resolvedIdentityCount: 0,
    resolvedSourceRecordCount: 0,
    unresolvedSourceRecordCount: 0,
    resolutionStatusCounts: [],
  }),
  positionLeads: z.array(PositionLeadSchema).max(12).optional(),
  positionLeadCount: z.number().int().nonnegative().optional(),
  knowledgeCoverage: KnowledgeCoverageSchema.default({
    methodologyChunksRetrieved: 0,
    methodologySearchFailed: false,
    methodologySources: [],
    playerReportSearchPerformed: false,
    playerReportSearchFailed: false,
    playerReportChunksRetrieved: 0,
  }),
  searchScopes: z.array(RecruitmentSearchScopeSchema),
  recommendations: z.array(PlayerRecommendationSchema).max(5),
  limitations: z.array(z.string()),
  dataSource: z.string(),
  datasetMode: DatasetModeSchema,
  datasetScope: DatasetScopeSchema.optional(),
});
export type RecruitmentReport = z.infer<typeof RecruitmentReportSchema>;

export const TeamRosterContextStatusSchema = z.enum([
  "available",
  "not_configured",
  "partial",
  "empty",
  "not_found",
  "ambiguous",
  "unavailable",
]);
export type TeamRosterContextStatus = z.infer<typeof TeamRosterContextStatusSchema>;

export const TeamRosterFailureKindSchema = z.enum([
  "disabled",
  "missing_api_key",
  "paid_plan_required",
  "cancelled",
  "ephemeral_replay",
  "timeout",
  "rate_limited",
  "network",
  "http",
  "invalid_response",
]);

export const TeamRosterContextSchema = z.object({
  status: TeamRosterContextStatusSchema,
  requestedTeam: z.string().min(1),
  matchedTeams: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url(),
  })).max(5),
  team: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url(),
  }).nullable(),
  players: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    position: z.string().nullable(),
    dateOfBirth: z.string().nullable().optional(),
    nationality: z.string().nullable().optional(),
    url: z.string().url(),
  })).max(100),
  returnedCount: z.number().int().nonnegative(),
  resultLimit: z.number().int().min(1).max(100),
  possiblyTruncated: z.boolean(),
  retrievedAt: z.string().datetime().nullable(),
  sourceUrl: z.string().url(),
  failureKind: TeamRosterFailureKindSchema.nullable(),
  notice: z.string().min(1),
});
export type TeamRosterContext = z.infer<typeof TeamRosterContextSchema>;

export const RecruitmentProgressStageSchema = z.enum([
  "starting",
  "planning",
  "methodology",
  "team_sample",
  "player_detail",
  "match_detail",
  "candidate_search",
  "player_evaluation",
  "external_signal",
  "historical_archive",
  "report_search",
  "synthesizing",
  "review",
  "team_roster_context",
  "asking_user",
  "completed",
  "cancelling",
  "cancelled",
  "failed",
]);
export type RecruitmentProgressStage = z.infer<typeof RecruitmentProgressStageSchema>;

export const RecruitmentProgressEventStatusSchema = z.enum([
  "started",
  "completed",
  "waiting_for_user",
  "notice",
  "cancelled",
  "failed",
]);
export type RecruitmentProgressEventStatus = z.infer<typeof RecruitmentProgressEventStatusSchema>;

export const RecruitmentGraphProgressUpdateSchema = z.object({
  type: z.literal("tactiscout/recruitment-progress"),
  stage: RecruitmentProgressStageSchema,
  status: RecruitmentProgressEventStatusSchema,
  message: z.string().min(1),
  completedSteps: z.number().int().nonnegative(),
});
export type RecruitmentGraphProgressUpdate = z.infer<typeof RecruitmentGraphProgressUpdateSchema>;

export const RecruitmentProgressEventSchema = z.object({
  sequence: z.number().int().positive(),
  occurrence: z.number().int().positive(),
  stage: RecruitmentProgressStageSchema,
  status: RecruitmentProgressEventStatusSchema,
  message: z.string().min(1),
  occurredAt: z.string().datetime(),
});
export type RecruitmentProgressEvent = z.infer<typeof RecruitmentProgressEventSchema>;

export const ConversationTurnResponseSchema = z.object({
  threadId: z.string().min(1),
  status: z.enum(["needs_input", "completed", "cancelled"]),
  message: z.string().min(1),
  question: z.object({ reason: z.string().min(1) }).nullable(),
  report: RecruitmentReportSchema.nullable(),
  teamRosterContext: TeamRosterContextSchema.optional(),
  progressEvents: z.array(RecruitmentProgressEventSchema).max(24).optional(),
});
export type ConversationTurnResponse = z.infer<typeof ConversationTurnResponseSchema>;

export const RecruitmentTurnCancellationResponseSchema = z.object({
  status: z.enum(["requested", "already_settled"]),
});
export type RecruitmentTurnCancellationResponse = z.infer<typeof RecruitmentTurnCancellationResponseSchema>;

export const RecruitmentProgressSchema = z.object({
  requestId: z.string().uuid().optional(),
  active: z.boolean(),
  stage: RecruitmentProgressStageSchema,
  message: z.string().min(1),
  completedSteps: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  events: z.array(RecruitmentProgressEventSchema).max(24).default([]),
});
export type RecruitmentProgress = z.infer<typeof RecruitmentProgressSchema>;
