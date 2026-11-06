import { recommendationResultSchema } from "./player-data/recommend-players.js";
import type {
  RecommendationCandidate,
  RecommendationResult,
} from "./player-data/recommend-players.js";
import { teamRecommendationResultSchema } from "./team-data/recommendation-result.js";
import type { TeamRecommendationResult } from "./team-data/recommendation-result.js";

type CompletedRecommendationResult = Extract<
  RecommendationResult,
  { status: "ready" | "no_candidates" }
>;

type AnswerLanguage = "en" | "zh";

type RecommendationFilterValues = {
  maxAge: number | null;
  minimumCurrentAbility: number | null;
  minimumPotentialAbility: number | null;
  resultLimit: number;
};

type TeamRecommendationAnswerData = {
  filters: RecommendationFilterValues;
  fmSnapshotDate: string | null;
  position: string;
  rankingBasis: TeamRecommendationResult["rankingBasis"];
  recommendation: CompletedRecommendationResult;
  roster: TeamRecommendationResult["roster"];
  team: TeamRecommendationResult["team"];
};

const rosterDateFormatters = [
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }),
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }),
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }),
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }),
];

const falseEmptyListPhrases = {
  current: [
    "当前能力相似名单为空",
    "当前能力名单为空",
    "当前能力相似名单没有候选",
    "current ability similarity list is empty",
    "current candidate list is empty",
    "current candidates are empty",
    "no current ability candidates",
  ],
  potential: [
    "高潜名单为空",
    "高潜名单没有候选",
    "high-potential list is empty",
    "potential candidate list is empty",
    "no high-potential candidates",
  ],
};

const falseMissingExclusionPhrases = [
  "工具未提供身份排除的具体对象",
  "未提供具体身份排除对象",
  "无法判断排除了谁",
  "no specific excluded identities were provided",
  "the tool did not identify who was excluded",
  "cannot determine who was excluded",
];

const falseMissingTeamRankingBasisPhrases = [
  "队内参考画像的成员筛选方式未在结果中说明",
  "队内参考画像的选择方式未在结果中说明",
  "团队参考画像的成员筛选方式未在结果中说明",
  "工具未提供团队参考画像的成员筛选标准或计算方法",
  "工具未提供这些参考对象的筛选标准或计算方法",
  "这些参考对象的筛选标准或计算方法未提供",
  "the squad reference profile selection method was not specified",
  "the reference profile selection method was not provided",
  "the team reference selection criteria or calculation method was not provided",
  "the tool did not provide selection criteria or a calculation method for these references",
];

const answerContainsAnyPhrase = (
  answer: string,
  phrases: string[]
): boolean => {
  const normalized = answer.normalize("NFKC").toLocaleLowerCase();

  return phrases.some((phrase) =>
    normalized.includes(phrase.normalize("NFKC").toLocaleLowerCase())
  );
};

const answerClaimsAnUnsetFilterWasApplied = (
  answer: string,
  filters: RecommendationFilterValues
): boolean => {
  if (
    filters.maxAge === null &&
    answerContainsAnyPhrase(answer, [
      "应用年龄条件后",
      "应用年龄筛选后",
      "应用年龄、CA 和 PA 条件后",
      "应用年龄、CA、PA 条件后",
      "after applying age condition",
      "after applying age, CA, and PA filters",
      "after the age filter",
    ])
  ) {
    return true;
  }

  if (
    filters.minimumCurrentAbility === null &&
    answerContainsAnyPhrase(answer, [
      "应用 CA 条件后",
      "应用 CA 筛选后",
      "after applying CA condition",
      "after the CA filter",
    ])
  ) {
    return true;
  }

  return (
    filters.minimumPotentialAbility === null &&
    answerContainsAnyPhrase(answer, [
      "应用 PA 条件后",
      "应用 PA 筛选后",
      "after applying PA condition",
      "after the PA filter",
    ])
  );
};

const missingValue = (
  value: number | null,
  language: AnswerLanguage
): string => {
  if (value !== null) {
    return String(value);
  }

  return language === "zh" ? "未提供" : "not provided";
};

const candidateLine = (
  candidate: RecommendationCandidate,
  language: AnswerLanguage
): string => {
  const age = missingValue(candidate.age, language);
  const currentAbility = missingValue(candidate.currentAbility, language);
  const potentialAbility = missingValue(candidate.potentialAbility, language);

  if (language === "zh") {
    return `${candidate.rank}. ${candidate.name}（FM ID ${candidate.fmId}；年龄 ${age}；位置评分 ${candidate.positionRating}；CA ${currentAbility}；PA ${potentialAbility}；currentDistance ${candidate.currentDistance}）`;
  }

  return `${candidate.rank}. ${candidate.name} (FM ID ${candidate.fmId}; age ${age}; position rating ${candidate.positionRating}; CA ${currentAbility}; PA ${potentialAbility}; currentDistance ${candidate.currentDistance})`;
};

const referenceLine = (
  reference: CompletedRecommendationResult["references"][number],
  language: AnswerLanguage
): string => {
  const currentAbility = missingValue(reference.currentAbility, language);
  const potentialAbility = missingValue(reference.potentialAbility, language);

  if (language === "zh") {
    return `- ${reference.name}（FM ID ${reference.fmId}；CA ${currentAbility}；PA ${potentialAbility}）`;
  }

  return `- ${reference.name} (FM ID ${reference.fmId}; CA ${currentAbility}; PA ${potentialAbility})`;
};

const filterSummary = (
  filterValues: RecommendationFilterValues,
  language: AnswerLanguage
): string => {
  const labels: string[] = [];

  if (filterValues.maxAge === null) {
    labels.push(language === "zh" ? "年龄限制未设置" : "no age limit");
  } else {
    labels.push(
      language === "zh"
        ? `年龄上限 ${filterValues.maxAge}`
        : `age ≤ ${filterValues.maxAge}`
    );
  }

  if (filterValues.minimumCurrentAbility === null) {
    labels.push(language === "zh" ? "CA 下限未设置" : "no CA minimum");
  } else {
    labels.push(
      language === "zh"
        ? `CA 下限 ${filterValues.minimumCurrentAbility}`
        : `CA ≥ ${filterValues.minimumCurrentAbility}`
    );
  }

  if (filterValues.minimumPotentialAbility === null) {
    labels.push(language === "zh" ? "PA 下限未设置" : "no PA minimum");
  } else {
    labels.push(
      language === "zh"
        ? `PA 下限 ${filterValues.minimumPotentialAbility}`
        : `PA ≥ ${filterValues.minimumPotentialAbility}`
    );
  }

  labels.push(
    language === "zh"
      ? `名单上限 ${filterValues.resultLimit}`
      : `result limit ${filterValues.resultLimit}`
  );

  return language === "zh"
    ? `筛选条件：${labels.join("；")}`
    : `Filters: ${labels.join(", ")}`;
};

const teamRankingBasisSummary = (
  rankingBasis: TeamRecommendationAnswerData["rankingBasis"],
  language: AnswerLanguage
): string => {
  if (rankingBasis === "equal_weight_mean_of_position_capable_squad_profiles") {
    return language === "zh"
      ? "参考画像计算方式：选取目标位置评分至少 15 且该位置所需属性完整的队内 FM 画像，对该位置所需属性取等权平均。"
      : "Reference calculation: equally weight the target-position attributes of squad FM profiles rated at least 15 with all required attributes.";
  }

  return language === "zh"
    ? "参考画像计算方式：使用用户指定的 FM 参考画像。"
    : "Reference calculation: use the user-selected FM reference profiles.";
};

const renderChineseCorrection = (
  result: CompletedRecommendationResult
): string => {
  const sections = [
    `参考画像（${result.position.toUpperCase()}）：`,
    ...result.references.map((reference) => referenceLine(reference, "zh")),
    "",
    `年龄按 ${result.ageAsOfDate} 计算；CA、PA 和属性来自 ${result.snapshotDate} 的 FM 快照。`,
    `当前能力相似候选（${result.currentCandidates.length}）：`,
    ...result.currentCandidates.map((candidate) =>
      candidateLine(candidate, "zh")
    ),
  ];

  if (result.potentialCandidates !== null) {
    sections.push(
      "",
      `高潜候选（${result.potentialCandidates.length}）：`,
      ...result.potentialCandidates.map((candidate) =>
        candidateLine(candidate, "zh")
      )
    );
  }

  sections.push(
    "",
    filterSummary(result.filters, "zh"),
    "",
    "这些结果只反映 FM 属性画像相似。PA 是潜力信号，不代表未来 CA 保证、战术适配或转会可行性。"
  );

  return sections.join("\n");
};

const renderEnglishCorrection = (
  result: CompletedRecommendationResult
): string => {
  const sections = [
    `Reference profiles (${result.position.toUpperCase()}):`,
    ...result.references.map((reference) => referenceLine(reference, "en")),
    "",
    `Age is calculated as of ${result.ageAsOfDate}; CA, PA, and attributes come from the FM snapshot dated ${result.snapshotDate}.`,
    `Current-ability similarity candidates (${result.currentCandidates.length}):`,
    ...result.currentCandidates.map((candidate) =>
      candidateLine(candidate, "en")
    ),
  ];

  if (result.potentialCandidates !== null) {
    sections.push(
      "",
      `High-potential candidates (${result.potentialCandidates.length}):`,
      ...result.potentialCandidates.map((candidate) =>
        candidateLine(candidate, "en")
      )
    );
  }

  sections.push(
    "",
    filterSummary(result.filters, "en"),
    "",
    "These results describe FM profile similarity. PA is not a guarantee of future CA, tactical fit, or transfer feasibility."
  );

  return sections.join("\n");
};

const correctionForAnswer = (
  answer: string,
  result: CompletedRecommendationResult
): string | null => {
  const currentListContradiction =
    result.currentCandidates.length > 0 &&
    answerContainsAnyPhrase(answer, falseEmptyListPhrases.current);

  const potentialListContradiction =
    (result.potentialCandidates?.length ?? 0) > 0 &&
    answerContainsAnyPhrase(answer, falseEmptyListPhrases.potential);

  const unsetFilterContradiction = answerClaimsAnUnsetFilterWasApplied(
    answer,
    result.filters
  );

  const answerMentionsAge = answerContainsAnyPhrase(answer, ["年龄", "age"]);

  const ageDateMissing =
    answerMentionsAge && !answer.includes(result.ageAsOfDate);

  const correctionNeeded = [
    currentListContradiction,
    potentialListContradiction,
    unsetFilterContradiction,
    ageDateMissing,
  ].some(Boolean);

  if (!correctionNeeded) {
    return null;
  }

  const language = /\p{Script=Han}/u.test(answer) ? "zh" : "en";

  return language === "zh"
    ? renderChineseCorrection(result)
    : renderEnglishCorrection(result);
};

const correctRecommendationAnswer = (
  answer: string,
  resultJson: string
): string | null => {
  let result: RecommendationResult;

  try {
    result = recommendationResultSchema.parse(JSON.parse(resultJson));
  } catch {
    return null;
  }

  if (result.status !== "ready" && result.status !== "no_candidates") {
    return null;
  }

  const generalCorrection = correctionForAnswer(answer, result);

  if (generalCorrection !== null) {
    return generalCorrection;
  }

  const hasCandidates =
    result.currentCandidates.length > 0 ||
    (result.potentialCandidates?.length ?? 0) > 0;

  const referenceDetailsMissing =
    hasCandidates &&
    result.references.some(
      (reference) =>
        !answer.includes(referenceLine(reference, "zh")) &&
        !answer.includes(referenceLine(reference, "en"))
    );

  if (!referenceDetailsMissing) {
    return null;
  }

  const language = /\p{Script=Han}/u.test(answer) ? "zh" : "en";

  return language === "zh"
    ? renderChineseCorrection(result)
    : renderEnglishCorrection(result);
};

const answerReportsRosterRetrievalDate = (
  answer: string,
  retrievedAt: string
): boolean => {
  const retrievedDate = new Date(retrievedAt);

  if (!Number.isFinite(retrievedDate.getTime())) {
    return false;
  }

  const dateVariants = [
    retrievedDate.toISOString().slice(0, 10),
    `${retrievedDate.getUTCFullYear()}年${retrievedDate.getUTCMonth() + 1}月${retrievedDate.getUTCDate()}日`,
    ...rosterDateFormatters.map((formatter) => formatter.format(retrievedDate)),
  ];

  const retrievalLines = answer
    .split(/\r?\n/u)
    .filter((line) =>
      /(?:阵容|roster|squad|api-football).*(?:获取|来源|retrieved|source)|(?:获取|retrieved).*(?:阵容|roster|squad|api-football)/iu.test(
        line
      )
    );

  return retrievalLines.some((line) =>
    dateVariants.some((dateVariant) => line.includes(dateVariant))
  );
};

const renderChineseTeamCorrection = (
  data: TeamRecommendationAnswerData
): string => {
  const {
    fmSnapshotDate: rawFmSnapshotDate,
    position,
    recommendation,
    roster,
    team,
  } = data;

  const country = team.country === null ? "" : `（${team.country}）`;
  const fmSnapshotDate = rawFmSnapshotDate ?? "未提供";

  const sections = [
    `球队：${team.name}${country}；目标位置：${position.toUpperCase()}`,
    `阵容来源：${roster.source}，获取时间：${roster.retrievedAt}；FM 快照日期：${fmSnapshotDate}`,
    `候选年龄按 ${recommendation.ageAsOfDate} 计算；能力和属性仍按 FM 快照日期计算。`,
    `阵容映射：${roster.mappedMembers}/${roster.totalMembers} 人（Reep 桥接 ${roster.reepBridgeMappings}，用户确认 ${roster.userConfirmedMappings}）；无本地画像 ${roster.noLocalProfileMembers} 人，待确认 ${roster.pendingMembers} 人。映射到 FM 画像不代表位置评分达标。`,
    teamRankingBasisSummary(data.rankingBasis, "zh"),
    "",
    `队内参考画像（已作为参考并从候选中排除；${recommendation.references.length} 人）：`,
    ...recommendation.references.map((reference) =>
      referenceLine(reference, "zh")
    ),
    "",
    `当前能力相似候选（${recommendation.currentCandidates.length}）：`,
    ...recommendation.currentCandidates.map((candidate) =>
      candidateLine(candidate, "zh")
    ),
  ];

  if (recommendation.potentialCandidates !== null) {
    sections.push(
      "",
      `高潜候选（${recommendation.potentialCandidates.length}）：`,
      ...recommendation.potentialCandidates.map((candidate) =>
        candidateLine(candidate, "zh")
      )
    );
  }

  sections.push(
    "",
    filterSummary(data.filters, "zh"),
    "这些结果只反映 FM 属性画像相似，不代表战术适配或转会可行性。PA 是潜力信号，不代表未来 CA 保证。"
  );

  return sections.join("\n");
};

const renderEnglishTeamCorrection = (
  data: TeamRecommendationAnswerData
): string => {
  const {
    fmSnapshotDate: rawFmSnapshotDate,
    position,
    recommendation,
    roster,
    team,
  } = data;

  const country = team.country === null ? "" : ` (${team.country})`;
  const fmSnapshotDate = rawFmSnapshotDate ?? "not provided";

  const sections = [
    `Team: ${team.name}${country}; target position: ${position.toUpperCase()}`,
    `Roster source: ${roster.source}, retrieved ${roster.retrievedAt}; FM snapshot: ${fmSnapshotDate}`,
    `Candidate ages are calculated as of ${recommendation.ageAsOfDate}; ability and attributes use the FM snapshot date.`,
    `Roster mapping: ${roster.mappedMembers}/${roster.totalMembers} mapped (Reep ${roster.reepBridgeMappings}, user-confirmed ${roster.userConfirmedMappings}); no local profile ${roster.noLocalProfileMembers}; pending ${roster.pendingMembers}. Mapping does not imply position eligibility.`,
    teamRankingBasisSummary(data.rankingBasis, "en"),
    "",
    `Squad reference profiles (used as references and excluded from candidates; ${recommendation.references.length}):`,
    ...recommendation.references.map((reference) =>
      referenceLine(reference, "en")
    ),
    "",
    `Current-ability similarity candidates (${recommendation.currentCandidates.length}):`,
    ...recommendation.currentCandidates.map((candidate) =>
      candidateLine(candidate, "en")
    ),
  ];

  if (recommendation.potentialCandidates !== null) {
    sections.push(
      "",
      `High-potential candidates (${recommendation.potentialCandidates.length}):`,
      ...recommendation.potentialCandidates.map((candidate) =>
        candidateLine(candidate, "en")
      )
    );
  }

  sections.push(
    "",
    filterSummary(data.filters, "en"),
    "These results describe FM profile similarity, not tactical fit or transfer feasibility. PA is not a guarantee of future CA."
  );

  return sections.join("\n");
};

const teamRecommendationAnswerDataFrom = (
  result: TeamRecommendationResult
): TeamRecommendationAnswerData | null => {
  if (!("recommendation" in result)) {
    return null;
  }

  const { recommendation } = result;

  if (
    recommendation.status !== "ready" &&
    recommendation.status !== "no_candidates"
  ) {
    return null;
  }

  return {
    filters: result.filters,
    fmSnapshotDate: result.fmSnapshotDate,
    position: result.position,
    rankingBasis: result.rankingBasis,
    recommendation,
    roster: result.roster,
    team: result.team,
  };
};

const correctTeamRecommendationAnswer = (
  answer: string,
  resultJson: string
): string | null => {
  let parsedResult: ReturnType<typeof teamRecommendationResultSchema.safeParse>;

  try {
    parsedResult = teamRecommendationResultSchema.safeParse(
      JSON.parse(resultJson)
    );
  } catch {
    return null;
  }

  if (!parsedResult.success) {
    return null;
  }

  const data = teamRecommendationAnswerDataFrom(parsedResult.data);

  if (data === null) {
    return null;
  }

  const correctionNeeded = [
    correctionForAnswer(answer, data.recommendation) !== null,
    answerClaimsAnUnsetFilterWasApplied(answer, data.filters),
    !answerReportsRosterRetrievalDate(answer, data.roster.retrievedAt),
    answerContainsAnyPhrase(answer, falseMissingTeamRankingBasisPhrases),
    data.recommendation.references.length > 0 &&
      answerContainsAnyPhrase(answer, falseMissingExclusionPhrases),
  ].some(Boolean);

  if (!correctionNeeded) {
    return null;
  }

  const language = /\p{Script=Han}/u.test(answer) ? "zh" : "en";

  return language === "zh"
    ? renderChineseTeamCorrection(data)
    : renderEnglishTeamCorrection(data);
};

export { correctRecommendationAnswer, correctTeamRecommendationAnswer };
