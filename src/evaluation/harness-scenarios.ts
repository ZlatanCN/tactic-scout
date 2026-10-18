import type { ToolActionName } from "../recruitment/recruitment-actions.js";
import { type CapabilityMetricKey } from "../domain/capabilities.js";
import { type Position } from "../domain/position-contracts.js";

export type RequestedCapabilityExpectation = {
  name: string;
  metricKeys: readonly CapabilityMetricKey[];
  limitationTerms: readonly string[];
};

export type ExpectedCapabilityCoverage = {
  name: string;
  requestedMetricKeys: readonly CapabilityMetricKey[];
};

export type ClarificationIntent = "role_preference" | "position_expansion";

export type EvaluationScenario = {
  id: string;
  message: string;
  answers: string[];
  kind: "shortlist";
  targetTeamAliases: readonly string[];
  requiredTools: readonly ToolActionName[];
  requireBroadPositionSearch: boolean;
  requireMethodologySearch?: boolean;
  requireReportSearchAfterEvaluation?: boolean;
  expectedBroadPosition?: Position;
  expectedMaxAge: number | null;
  requestedCapabilities?: readonly RequestedCapabilityExpectation[];
  expectedCapabilityCoverage?: readonly ExpectedCapabilityCoverage[];
} | {
  id: string;
  message: string;
  answers: string[];
  kind: "clarification-resume";
  targetTeamAliases: readonly string[];
  answerIntents: readonly ClarificationIntent[];
  expectedPosition: Position;
  expectedBroadenedPosition?: Position;
  requestedCapabilities?: readonly RequestedCapabilityExpectation[];
  expectedCapabilityCoverage?: readonly ExpectedCapabilityCoverage[];
  requireRecommendationsWhenEvidenceObserved?: boolean;
} | {
  id: "custom";
  message: string;
  answers: string[];
  kind: "custom";
  requireClarificationResume: boolean;
  expectedClarificationTopic?: "position";
  expectedPosition?: Position;
  requireRecommendationsWhenEvidenceObserved?: boolean;
};

export const localAgentEvaluationScenarios: readonly EvaluationScenario[] = [
  {
    id: "barcelona-under-23-midfielder",
    message: "为巴萨找一名 23 岁以下、能踢中场、推进和前场压迫能力强的球员。",
    answers: [],
    kind: "shortlist",
    targetTeamAliases: ["巴萨", "Barcelona", "FC Barcelona"],
    requiredTools: ["search_methodology", "search_candidates"],
    requireBroadPositionSearch: true,
    expectedBroadPosition: "MID",
    expectedMaxAge: 23,
    requestedCapabilities: [
      {
        name: "推进",
        metricKeys: ["wyscoutProgressivePassesPer90", "wyscoutAccurateProgressivePassesPct", "lineBreakPassesCompletedPer30Tip"],
        limitationTerms: ["推进", "渐进传球"],
      },
      {
        name: "压迫",
        metricKeys: ["pressures"],
        limitationTerms: ["施压", "压迫"],
      },
    ],
    expectedCapabilityCoverage: [
      {
        name: "推进",
        requestedMetricKeys: [
          "wyscoutProgressivePassesPer90",
          "wyscoutAccurateProgressivePassesPct",
          "lineBreakPassesCompletedPer30Tip",
        ],
      },
      { name: "压迫", requestedMetricKeys: ["pressures"] },
    ],
  },
  {
    id: "bayern-kane-replacement",
    message: "为拜仁寻找凯恩的替代者，重点看能接应、做球和终结的前锋。",
    answers: [
      "延续凯恩的中锋角色，暂不增加年龄或预算限制。",
      "可以扩大到其他前锋位置继续找，重点仍是能接应、做球和终结。",
    ],
    kind: "clarification-resume",
    targetTeamAliases: ["拜仁", "Bayern", "FC Bayern"],
    answerIntents: ["role_preference", "position_expansion"],
    expectedPosition: "ST",
    expectedBroadenedPosition: "ATT",
    requestedCapabilities: [
      {
        name: "创造机会",
        metricKeys: ["assists", "shotAssists", "keyPasses", "asaExpectedAssistsPer90", "fplExpectedAssistsPer90", "premierLeagueAssistsPer90", "premierLeagueKeyPassesPer90", "understatExpectedAssistsPer90", "understatKeyPassesPer90"],
        limitationTerms: ["创造机会", "做球"],
      },
      { name: "进球产出", metricKeys: ["goals", "premierLeagueGoalsPer90"], limitationTerms: ["进球产出", "终结"] },
      { name: "射门终结", metricKeys: [], limitationTerms: ["射门终结", "射术", "终结能力"] },
      { name: "进攻接应", metricKeys: [], limitationTerms: ["进攻接应", "接应"] },
    ],
    expectedCapabilityCoverage: [
      { name: "进球产出", requestedMetricKeys: ["goals", "premierLeagueGoalsPer90"] },
      { name: "创造机会", requestedMetricKeys: ["assists", "shotAssists", "keyPasses", "asaExpectedAssistsPer90", "fplExpectedAssistsPer90", "premierLeagueAssistsPer90", "premierLeagueKeyPassesPer90", "understatExpectedAssistsPer90", "understatKeyPassesPer90"] },
      { name: "射门终结", requestedMetricKeys: [] },
      { name: "进攻接应", requestedMetricKeys: [] },
    ],
    requireRecommendationsWhenEvidenceObserved: true,
  },
  {
    id: "barcelona-attacking-one-on-one-forward",
    message: "为巴萨找一位 23 岁以下的前锋，重点考察进攻一对一对抗。",
    answers: [],
    kind: "shortlist",
    targetTeamAliases: ["巴萨", "Barcelona", "FC Barcelona"],
    requiredTools: ["search_methodology", "search_candidates"],
    requireBroadPositionSearch: true,
    expectedBroadPosition: "ATT",
    expectedMaxAge: 23,
    requestedCapabilities: [{
      name: "进攻一对一对抗",
      metricKeys: ["wyscoutGroundAttackingDuelsPer90", "wyscoutExplicitlyWonGroundAttackingDuelSharePct"],
      limitationTerms: ["进攻一对一对抗", "地面进攻对抗"],
    }],
    expectedCapabilityCoverage: [{
      name: "进攻一对一对抗",
      requestedMetricKeys: ["wyscoutGroundAttackingDuelsPer90", "wyscoutExplicitlyWonGroundAttackingDuelSharePct"],
    }],
  },
];

export const understatLocalAgentEvaluationScenario: EvaluationScenario = {
  id: "understat-five-league-xg-creation",
  message: "为拜仁寻找一名前锋，候选范围是当前赛季五大联赛，按前锋大类检索，重点比较创造机会和射门机会质量，尤其是 xA、关键传球与非点球 xG。",
  answers: [],
  kind: "shortlist",
  targetTeamAliases: ["拜仁", "Bayern", "FC Bayern"],
  requiredTools: ["search_candidates"],
  requireBroadPositionSearch: true,
  expectedBroadPosition: "ATT",
  expectedMaxAge: null,
  requireMethodologySearch: false,
  requireReportSearchAfterEvaluation: false,
  requestedCapabilities: [
    {
      name: "创造机会",
      metricKeys: ["understatExpectedAssistsPer90", "understatKeyPassesPer90"],
      limitationTerms: ["创造机会", "机会创造"],
    },
    {
      name: "射门机会质量",
      metricKeys: ["understatExpectedGoalsPer90", "understatNonPenaltyExpectedGoalsPer90", "understatExpectedGoalsPerShot", "asaExpectedGoalsPer90", "asaExpectedGoalsPerShot"],
      limitationTerms: ["机会质量"],
    },
  ],
  expectedCapabilityCoverage: [
    {
      name: "创造机会",
      requestedMetricKeys: ["assists", "shotAssists", "keyPasses", "asaExpectedAssistsPer90", "fplExpectedAssistsPer90", "premierLeagueAssistsPer90", "premierLeagueKeyPassesPer90", "understatExpectedAssistsPer90", "understatKeyPassesPer90"],
    },
    {
      name: "射门机会质量",
      requestedMetricKeys: ["statsbombNonPenaltyXgPer90", "statsbombNonPenaltyXgPerShot", "understatExpectedGoalsPer90", "understatNonPenaltyExpectedGoalsPer90", "understatExpectedGoalsPerShot", "asaExpectedGoalsPer90", "asaExpectedGoalsPerShot"],
    },
  ],
};
