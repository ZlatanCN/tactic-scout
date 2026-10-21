import { activeReferenceMessages } from "./replacement-reference.js";
import { type CapabilityMetricKey } from "./capabilities.js";
import { type Position } from "./position-contracts.js";
import type { RecruitmentBrief } from "./recruitment-brief.js";

const abilityEvidenceByCapability: Readonly<Record<string, readonly CapabilityMetricKey[]>> = {
  "射门终结": ["abilityFinishing"],
  "进攻接应": ["abilityLinkForward"],
  "创造机会": ["abilityPlaymaking", "abilityLinkForward"],
  "带球推进": ["abilityCarrying"],
  "推进": ["abilityCarrying", "abilityPlaymaking", "abilityBallPlayingDefender"],
  "后场出球": ["abilityBallPlayingDefender", "abilitySweeperKeeper"],
  "整体防守": ["abilityHolding", "abilityBallPlayingDefender"],
  "门将专项能力": ["abilityGoalkeeping", "abilitySweeperKeeper"],
};

const requestedCapabilityEvidenceMappings: readonly {
  name: string;
  pattern: RegExp;
  metricKeys: readonly CapabilityMetricKey[];
}[] = [
  { name: "整体防守", pattern: /(?<!保护)防守(?!站位|位置感|型|对抗|事件)|defensive ability/i, metricKeys: [] },
  { name: "后场出球", pattern: /出球|build[- ]up distribution/i, metricKeys: [] },
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
    name: "高位压迫适配",
    pattern: /高位压迫|前场压迫|high[- ]press(?:ing)?/i,
    metricKeys: [],
  },
  {
    name: "进球产出",
    pattern: /进球(?:产出|数|能力)?|破门|得分(?:能力|产出)?|终结产出|goal[- ]scoring|\bgoals?\b/i,
    metricKeys: ["goals", "premierLeagueGoalsPer90"],
  },
  {
    name: "创造机会",
    pattern: /创造机会|机会创造|关键传球|射门助攻|喂饼|chance creation|key passes?|shot assists?/i,
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
    pattern: /接应|做球|背身回做|link[- ]up(?: play)?/i,
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

function explicitCapabilityQuote(userMessages: readonly string[], name: string, pattern: RegExp): string | null {
  const allText = userMessages.join("\n");
  const matcher = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, "")}g`);
  for (const match of allText.matchAll(matcher)) {
    const index = match.index ?? 0;
    const prefix = allText.slice(Math.max(0, index - 14), index);
    const negatedBefore = /(?:不要|不需要|无需|不考虑|不强调|不重视|不追求|不要求|不必|不看|don't need|no emphasis on|not prioritiz(?:e|ing))\s*$/i.test(prefix);
    const suffix = allText.slice(index + match[0].length, index + match[0].length + 10);
    const negatedAfter = /^\s*(?:不是(?:重点|优先项|主要诉求)|不重要|不需要|不必|无需)/i.test(suffix);
    const surrounding = allText.slice(Math.max(0, index - 20), index + match[0].length + 20);
    const meansPressResistance = (name === "压迫" || name === "高位压迫适配") && /压迫下控球|压迫下持球|press[- ]resistant|resistant to pressing/i.test(surrounding);
    const meansHighPressing = name === "压迫" && /高位压迫|前场压迫|high[- ]press(?:ing)?/i.test(surrounding);
    const meansCarryingProgression = name === "推进" && (
      /(?:带球(?:向前)?|向前带球|渐进带球)\s*$/i.test(prefix)
      || /^\s*(?:by\s+)?(?:carry(?:ing)?|dribbl(?:e|ing))\b/i.test(suffix)
    );
    if (!negatedBefore && !negatedAfter && !meansPressResistance && !meansHighPressing && !meansCarryingProgression) {
      return match[0];
    }
  }
  return null;
}

function userExplicitlyRequestsCapability(userMessages: readonly string[], name: string, pattern: RegExp): boolean {
  return explicitCapabilityQuote(userMessages, name, pattern) !== null;
}

function activeCapabilityMessages(userMessages: readonly string[]): readonly string[] {
  const roleMessages = activeReferenceMessages(userMessages);
  const replacementIndex = roleMessages.reduce((latest, message, index) => (
    /改(?:成|为).*(?:重点|优先|主要|侧重)/s.test(message)
      && requestedCapabilityEvidenceMappings.some(({ name, pattern }) => userExplicitlyRequestsCapability([message], name, pattern))
      ? index : latest
  ), -1);
  return replacementIndex >= 0 ? roleMessages.slice(replacementIndex) : roleMessages;
}

/** Canonical explicit capabilities used to complete a model-produced brief once, at the parse boundary. */
export function explicitCapabilityPrioritiesFromMessages(userMessages: readonly string[]) {
  const activeMessages = activeCapabilityMessages(userMessages);
  return requestedCapabilityEvidenceMappings.flatMap(({ name, pattern }) => {
    const quote = explicitCapabilityQuote(activeMessages, name, pattern);
    return quote ? [{ value: name, basis: "explicit" as const, quote }] : [];
  });
}

export function requestedCapabilityEvidenceAreas(userMessages: readonly string[], position?: Position | null, includeAbilityProfiles = false): Array<{
  name: string;
  metricKeys: readonly CapabilityMetricKey[];
}> {
  const activeMessages = activeCapabilityMessages(userMessages);
  const requested = requestedCapabilityEvidenceMappings.flatMap(({ name, pattern, metricKeys }) => (
    userExplicitlyRequestsCapability(activeMessages, name, pattern) ? [{ name, metricKeys }] : []
  ));
  if (position === "GK" || activeMessages.some(message => /\bGK\b|\bgoalkeeper\b|\u95e8\u5c06|\u5b88\u95e8\u5458/i.test(message))) {
    requested.push({ name: "\u95e8\u5c06\u4e13\u9879\u80fd\u529b", metricKeys: [] });
  }
  const explicitlyRequestsCarryingProgression = requested.some(({ name }) => name === "带球推进");
  return requested.filter(({ name }) => !(explicitlyRequestsCarryingProgression && name === "推进"))
    .map((area) => ({ ...area, metricKeys: [...new Set([...area.metricKeys, ...(includeAbilityProfiles ? abilityEvidenceByCapability[area.name] ?? [] : [])])] }));
}

/** Resolve requested evidence from the normalized brief, without reinterpreting conversation history. */
export function requestedCapabilityEvidenceAreasFromBrief(
  brief: Pick<RecruitmentBrief, "criteria">,
  position?: Position | null,
  includeAbilityProfiles = false,
): Array<{ name: string; metricKeys: readonly CapabilityMetricKey[] }> {
  const explicitPriorities = brief.criteria.filter((criterion) => criterion.field === "capability"
    && criterion.basis === "explicit" && criterion.strength !== "excluded")
    .flatMap(criterion => typeof criterion.value === "string" ? [{ value: criterion.value }] : []);
  const requested = requestedCapabilityEvidenceMappings.flatMap(({ name, pattern, metricKeys }) => (
    explicitPriorities.some(({ value }) => pattern.test(value)) ? [{ name, metricKeys }] : []
  ));
  const criterionRequestsGoalkeeper = brief.criteria.some(criterion => criterion.field === "position"
    && criterion.operator === "in"
    && (Array.isArray(criterion.value) ? criterion.value.includes("GK") : criterion.value === "GK"));
  const isGoalkeeperRequest = position === "GK"
    || criterionRequestsGoalkeeper
    || explicitPriorities.some(({ value }) => /\bGK\b|goalkeeper|门将|守门员/i.test(value));
  if (isGoalkeeperRequest) requested.push({ name: "门将专项能力", metricKeys: [] });
  const explicitlyRequestsCarryingProgression = requested.some(({ name }) => name === "带球推进");
  return requested.filter(({ name }) => !(explicitlyRequestsCarryingProgression && name === "推进"))
    .map((area) => ({
      ...area,
      metricKeys: [...new Set([...area.metricKeys, ...(includeAbilityProfiles ? abilityEvidenceByCapability[area.name] ?? [] : [])])],
    }));
}

/** Prefer normalized requirements when available; keep legacy/test callers functional before interpretation. */
export function requestedCapabilityEvidenceAreasForInput(input: {
  brief?: RecruitmentBrief | null;
  userMessages: readonly string[];
}, position?: Position | null, includeAbilityProfiles = false) {
  return input.brief
    ? requestedCapabilityEvidenceAreasFromBrief(input.brief, position, includeAbilityProfiles)
    : requestedCapabilityEvidenceAreas(input.userMessages, position, includeAbilityProfiles);
}
