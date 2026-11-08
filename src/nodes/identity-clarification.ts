import { AIMessage } from "@langchain/core/messages";
import { getStore, interrupt } from "@langchain/langgraph";
import type { BaseStore, GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { mergeComparisonConstraints } from "../comparison-context.js";
import { selectedReferenceCandidate } from "../player-data/contracts.js";
import type {
  rememberRosterIdentity,
  RosterIdentityConfirmation,
} from "../player-memory.js";
import { resumeWorkflowClarification } from "../request-building.js";
import { stateCompatibilityUpdate } from "../state-compatibility.js";
import { createInitialPlayerMemoryStatus } from "../state.js";
import type {
  AgentState,
  AgentStateType,
  PendingClarification,
  PlayerMemoryManagementTarget,
  RequestPlayerState,
} from "../state.js";
import { workflowLabels } from "../workflow-continuation.js";

type WorkflowOption = Extract<
  PendingClarification,
  { kind: "workflow" }
>["options"][number];

const resumeValueSchema = z.union([
  z.string().transform((answer) => ({ answer })),
  z
    .looseObject({
      answer: z.string().optional(),
      candidateId: z.string().optional(),
      candidateIds: z.array(z.union([z.string(), z.number()])).optional(),
      text: z.string().optional(),
    })
    .transform((resume) => {
      let { answer } = resume;
      answer ??= resume.text;
      answer ??= resume.candidateId;
      answer ??= resume.candidateIds?.map(String).join(",");

      return { answer: answer ?? null };
    }),
]);

const identityCandidates = (state: AgentStateType) => {
  const pending = state.pendingClarification;

  if (pending?.kind !== "identity") {
    return [];
  }

  const player = state.request.players[pending.playerIndex];
  const resolution = player?.resolution;

  return (
    resolution?.candidates.map((candidate, candidateIndex) => ({
      candidateId: candidate.candidateId,
      identityBasis:
        candidate.identityBasis ??
        (candidate.identityVerified ? "reep_registry" : "source_record"),
      identityLinked: candidate.identityVerified,
      name: candidate.name,
      number: candidateIndex + 1,
      records: candidate.records.map((record) => ({
        competition: record.competition,
        identityLinked:
          record.identityVerified ??
          (candidate.identityVerified &&
            candidate.canonicalIdentityId !== null),
        name: record.name,
        season: record.season,
        source: record.provider,
        sourceId: record.sourceId,
        team: record.team,
      })),
      sources: [...new Set(candidate.records.map((record) => record.provider))],
    })) ?? []
  );
};

const candidatesForClarification = (
  state: AgentStateType,
  pending: PendingClarification
) => {
  if (pending.kind === "identity") {
    return identityCandidates(state);
  }

  if (pending.kind === "team") {
    return pending.candidates.map((candidate, index) => ({
      country: candidate.country,
      id: candidate.id,
      name: candidate.name,
      number: index + 1,
    }));
  }

  if (pending.kind === "team_roster_profile") {
    return pending.candidates.map((candidate, index) => ({
      birthDate: candidate.birthDate ?? null,
      currentAbility: candidate.currentAbility ?? null,
      fmId: candidate.fmId,
      name: candidate.name,
      naturalPositions: candidate.naturalPositions ?? null,
      number: index + 1,
      potentialAbility: candidate.potentialAbility ?? null,
    }));
  }

  if (pending.kind === "player_memory_management") {
    return pending.options.map((option, index) => ({
      label: option.label,
      number: index + 1,
    }));
  }

  if (pending.kind === "workflow") {
    return pending.options.map((workflow, index) => ({
      label: workflowLabels[workflow],
      number: index + 1,
      workflow,
    }));
  }

  return [];
};

const answerForOptions = (answer: string, options: string[]): string | null => {
  const normalized = answer.trim().toLocaleLowerCase();
  const number = Number(normalized);

  if (Number.isInteger(number) && number >= 1 && number <= options.length) {
    return options[number - 1] ?? null;
  }

  const exactPosition = options.find(
    (option) => option.toLocaleLowerCase() === normalized
  );

  if (exactPosition !== undefined) {
    return exactPosition;
  }

  const positionAliases = new Map([
    ["amc", "amc"],
    ["前腰", "amc"],
    ["aml", "aml"],
    ["左边锋", "aml"],
    ["amr", "amr"],
    ["右边锋", "amr"],
    ["dc", "dc"],
    ["中后卫", "dc"],
    ["中卫", "dc"],
    ["dl", "dl"],
    ["左后卫", "dl"],
    ["dm", "dm"],
    ["后腰", "dm"],
    ["dr", "dr"],
    ["右后卫", "dr"],
    ["gk", "gk"],
    ["守门员", "gk"],
    ["门将", "gk"],
    ["mc", "mc"],
    ["中场", "mc"],
    ["中场中路", "mc"],
    ["ml", "ml"],
    ["左中场", "ml"],
    ["mr", "mr"],
    ["右中场", "mr"],
    ["stc", "stc"],
    ["中锋", "stc"],
    ["striker", "stc"],
    ["wbl", "wbl"],
    ["左翼卫", "wbl"],
    ["wbr", "wbr"],
    ["右翼卫", "wbr"],
  ]);

  const selectedPosition = positionAliases.get(normalized);

  return selectedPosition !== undefined && options.includes(selectedPosition)
    ? selectedPosition
    : null;
};

const workflowOptionFromAnswer = (
  answer: string,
  options: WorkflowOption[]
): WorkflowOption | null => {
  const byNumberOrName = answerForOptions(answer, options);
  const exactOption = options.find((option) => option === byNumberOrName);

  if (exactOption !== undefined) {
    return exactOption;
  }

  const aliases = new Map<string, WorkflowOption>([
    ["查询", "player_lookup"],
    ["球员查询", "player_lookup"],
    ["比较", "player_comparison"],
    ["对比", "player_comparison"],
    ["球员比较", "player_comparison"],
    ["球员推荐", "player_recommendation"],
    ["球队推荐", "team_recommendation"],
  ]);

  const alias = aliases.get(answer.trim());

  return alias !== undefined && options.includes(alias) ? alias : null;
};

const teamFromAnswer = (
  answer: string,
  candidates: Extract<PendingClarification, { kind: "team" }>["candidates"]
) => {
  const normalized = answer.trim().toLocaleLowerCase();
  const number = Number(normalized);

  if (Number.isInteger(number) && number >= 1 && number <= candidates.length) {
    return candidates[number - 1] ?? null;
  }

  const matchingTeams = candidates.filter(
    (team) => team.name.toLocaleLowerCase() === normalized
  );

  return matchingTeams.length === 1 ? (matchingTeams[0] ?? null) : null;
};

const fmCandidateFromAnswer = (
  answer: string,
  candidates: Extract<
    PendingClarification,
    { kind: "team_roster_profile" }
  >["candidates"]
) => {
  const selectedFmId = answerForOptions(
    answer,
    candidates.map((candidate) => candidate.fmId)
  );

  return (
    candidates.find((candidate) => candidate.fmId === selectedFmId) ?? null
  );
};

const answerForAge = (answer: string): number | null => {
  const digits = /\d{1,3}/u.exec(answer)?.[0];
  const age = digits === undefined ? Number.NaN : Number(digits);

  return Number.isInteger(age) && age >= 1 && age <= 60 ? age : null;
};

const answerForSeason = (answer: string): string | null => {
  const match = /\b(?<start>20\d{2})\s*\/\s*(?<end>\d{2}|20\d{2})\b/u.exec(
    answer
  );

  if (match?.groups?.start === undefined || match.groups.end === undefined) {
    return null;
  }

  const start = Number(match.groups.start);

  const end =
    match.groups.end.length === 2
      ? Math.floor(start / 100) * 100 + Number(match.groups.end)
      : Number(match.groups.end);

  return end === start + 1 ? `${start}/${String(end).slice(-2)}` : null;
};

const roleFromAnswer = (answer: string): "reference" | "exclude" | null => {
  const normalized = answer.trim().toLocaleLowerCase();

  if (/^(?:reference|参考|作为参考|参考球员)$/iu.test(normalized)) {
    return "reference";
  }

  if (/^(?:exclude|排除|不要|不需要)$/iu.test(normalized)) {
    return "exclude";
  }

  return null;
};

const nextRecommendationClarification = (
  state: AgentStateType,
  players: RequestPlayerState[]
): PendingClarification | null => {
  const ambiguousIndex = players.findIndex(
    (player) => player.recommendationRole === "ambiguous"
  );

  if (ambiguousIndex !== -1) {
    const mention = players[ambiguousIndex]?.mention ?? "这位球员";

    return {
      answer: null,
      kind: "recommendation_role",
      playerIndex: ambiguousIndex,
      question: `“${
        mention
      }”要作为能力参考球员，还是从候选中排除？请回复“参考”或“排除”。`,
    };
  }

  if (
    state.request.kind === "player_recommendation" &&
    state.request.recommendation.needsAgeClarification &&
    state.request.recommendation.maxAge === null
  ) {
    return {
      answer: null,
      kind: "age",
      question: "请给出高潜候选的具体年龄上限，例如 23 岁以下。",
    };
  }

  return null;
};

const interruptForAnswer = (
  state: AgentStateType,
  pending: PendingClarification
): string | null => {
  const isIdentity = pending.kind === "identity";

  const player = isIdentity
    ? (state.request.players[pending.playerIndex] ?? null)
    : null;

  const candidates = candidatesForClarification(state, pending);
  let kind = `recommendation_${pending.kind}_clarification`;

  if (pending.kind === "identity") {
    kind = "player_identity_confirmation";
  } else if (pending.kind === "team") {
    kind = "team_identity_confirmation";
  } else if (pending.kind === "team_roster_profile") {
    kind = "team_roster_profile_confirmation";
  } else if (pending.kind === "player_memory_management") {
    kind =
      state.playerMemoryManagementRequest?.action === "clear"
        ? "player_memory_clear_confirmation"
        : "player_memory_forget_target_confirmation";
  } else if (pending.kind === "workflow") {
    kind = "workflow_continuation_selection";
  }

  const payload = {
    candidates,
    kind,
    mention: player?.mention ?? null,
    playerIndex: isIdentity ? pending.playerIndex : null,
    question: pending.question,
    requestKind: state.request.kind,
  };

  let rawResume: unknown;

  if (
    pending.kind === "position" ||
    pending.kind === "fm_profile" ||
    pending.kind === "team_position" ||
    pending.kind === "workflow"
  ) {
    rawResume = interrupt({ ...payload, options: pending.options });
  } else if (pending.kind === "team_roster_profile") {
    rawResume = interrupt({ ...payload, rosterIndex: pending.rosterIndex });
  } else {
    rawResume = interrupt(payload);
  }

  const parsedResume = resumeValueSchema.safeParse(rawResume);

  return parsedResume.success ? parsedResume.data.answer : null;
};

const invalidAnswer = (pending: PendingClarification, question: string) => ({
  pendingClarification: { ...pending, answer: null, question },
});

const clarifyPosition = (
  state: AgentStateType,
  pending: Extract<PendingClarification, { kind: "position" }>,
  answer: string
) => {
  const position = answerForOptions(answer, pending.options);

  if (position === null || state.request.kind !== "player_recommendation") {
    return invalidAnswer(
      pending,
      `请选择一个有效位置：${pending.options.join("、")}。`
    );
  }

  return {
    outcome: null,
    pendingClarification: null,
    request: {
      ...state.request,
      recommendation: { ...state.request.recommendation, position },
    },
  };
};

const clarifyTeam = (
  state: AgentStateType,
  pending: Extract<PendingClarification, { kind: "team" }>,
  answer: string
) => {
  if (state.request.kind !== "team_recommendation") {
    return invalidAnswer(
      pending,
      "球队请求状态已变化，请重新描述球队推荐需求。"
    );
  }

  const team = teamFromAnswer(answer, pending.candidates);

  if (team === null) {
    const teamName = answer.trim();

    if (Number.isFinite(Number(teamName)) || teamName.length < 3) {
      return invalidAnswer(
        pending,
        "请回复一个有效球队编号，或输入至少三个字符的另一个球队全名。"
      );
    }

    return {
      outcome: null,
      pendingClarification: null,
      request: {
        ...state.request,
        teamRecommendation: {
          ...state.request.teamRecommendation,
          roster: null,
          team: null,
          teamName,
          teamSearchName: teamName,
        },
        teams: [teamName],
      },
    };
  }

  return {
    outcome: null,
    pendingClarification: null,
    request: {
      ...state.request,
      teamRecommendation: {
        ...state.request.teamRecommendation,
        roster: null,
        team,
        teamName: team.name,
        teamSearchName: team.name,
      },
    },
  };
};

const clarifyTeamPosition = (
  state: AgentStateType,
  pending: Extract<PendingClarification, { kind: "team_position" }>,
  answer: string
) => {
  if (state.request.kind !== "team_recommendation") {
    return invalidAnswer(
      pending,
      "球队请求状态已变化，请重新描述球队推荐需求。"
    );
  }

  const position = answerForOptions(answer, pending.options);

  if (position !== null) {
    return {
      outcome: null,
      pendingClarification: null,
      request: {
        ...state.request,
        teamRecommendation: {
          ...state.request.teamRecommendation,
          position,
        },
      },
    };
  }

  const mention = answer.trim();

  if (mention.length < 2) {
    return invalidAnswer(
      pending,
      "请回复一个位置代码，或输入完整的参考球员姓名。"
    );
  }

  const player: RequestPlayerState = {
    attempts: 0,
    lookupName: null,
    mention,
    recommendationRole: "reference",
    referenceScope: "explicit",
    referenceTargetMention: null,
    resolution: null,
  };

  return {
    outcome: null,
    pendingClarification: null,
    request: {
      ...state.request,
      players: [player],
      teamRecommendation: {
        ...state.request.teamRecommendation,
        referenceMode: "named" as const,
      },
    },
  };
};

const clarifyTeamRosterProfile = (
  state: AgentStateType,
  pending: Extract<PendingClarification, { kind: "team_roster_profile" }>,
  answer: string
) => {
  if (
    state.request.kind !== "team_recommendation" ||
    state.request.teamRecommendation.roster === null
  ) {
    return invalidAnswer(pending, "球队阵容状态已变化，请重新发起球队推荐。");
  }

  if (pending.candidates.length === 0) {
    const normalizedAnswer = answer
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase();

    return /^(?:重试|重新查找|retry|retry lookup)$/u.test(normalizedAnswer)
      ? { outcome: null, pendingClarification: null, request: state.request }
      : invalidAnswer(
          pending,
          "当前没有可选的 FM 画像。更新或补齐 FM 资料后，请回复“重试”重新查找。"
        );
  }

  const selectedCandidate = fmCandidateFromAnswer(answer, pending.candidates);

  const member =
    state.request.teamRecommendation.roster.members[pending.rosterIndex];

  if (selectedCandidate === null || member === undefined) {
    return invalidAnswer(
      pending,
      `请选择一个有效的 FM 画像编号：${pending.question}`
    );
  }

  const members = state.request.teamRecommendation.roster.members.map(
    (rosterMember, index) =>
      index === pending.rosterIndex
        ? {
            ...rosterMember,
            fmCandidates: [],
            fmId: selectedCandidate.fmId,
            mappingMethod: "user_confirmation" as const,
            mappingStatus: "resolved" as const,
          }
        : rosterMember
  );

  return {
    outcome: null,
    pendingClarification: null,
    request: {
      ...state.request,
      teamRecommendation: {
        ...state.request.teamRecommendation,
        roster: {
          ...state.request.teamRecommendation.roster,
          members,
        },
      },
    },
  };
};

const memoryForgetOptionFromAnswer = (
  answer: string,
  pending: Extract<PendingClarification, { kind: "player_memory_management" }>
): PlayerMemoryManagementTarget | null => {
  const normalized = answer.trim().toLocaleLowerCase();
  const number = Number(normalized);

  if (
    Number.isInteger(number) &&
    number >= 1 &&
    number <= pending.options.length
  ) {
    return pending.options[number - 1]?.target ?? null;
  }

  const matches = pending.options.filter(
    (option) => option.label.toLocaleLowerCase() === normalized
  );

  return matches.length === 1 ? (matches[0]?.target ?? null) : null;
};

const isCancellationAnswer = (answer: string): boolean =>
  ["取消", "cancel", "no", "否"].includes(
    answer.normalize("NFKC").trim().toLocaleLowerCase()
  );

const cancelledPlayerMemoryManagement = (
  message: string
): Partial<AgentStateType> => ({
  messages: [new AIMessage(message)],
  outcome: {
    kind: "player_memory_management",
    resultJson: null,
    status: "cancelled",
  },
  pendingClarification: null,
  playerMemoryManagementRequest: null,
});

const clarifyPlayerMemoryClear = (
  state: AgentStateType,
  pending: Extract<PendingClarification, { kind: "player_memory_management" }>,
  answer: string
): Partial<AgentStateType> => {
  const request = state.playerMemoryManagementRequest;

  if (request === null || request.action !== "clear") {
    return invalidAnswer(pending, "清空请求已变化，请重新发起操作。");
  }

  if (isCancellationAnswer(answer)) {
    return cancelledPlayerMemoryManagement(
      "已取消清空球员记忆，没有删除任何记录。"
    );
  }

  const normalizedAnswer = answer.normalize("NFKC").trim().toLocaleLowerCase();

  const confirmed = [
    "确认",
    "确认清空",
    "是",
    "同意",
    "yes",
    "confirm",
  ].includes(normalizedAnswer);

  return confirmed
    ? {
        outcome: null,
        pendingClarification: null,
        playerMemoryManagementRequest: {
          ...request,
          clearAllApproved: true,
          clearAllConfirmationIds: pending.clearAllConfirmationIds,
        },
      }
    : invalidAnswer(
        pending,
        "请明确回复“确认”执行清空，或回复“取消”；其他回答不会删除记忆。"
      );
};

const clarifyPlayerMemoryManagement = (
  state: AgentStateType,
  pending: Extract<PendingClarification, { kind: "player_memory_management" }>,
  answer: string
): Partial<AgentStateType> => {
  const request = state.playerMemoryManagementRequest;

  if (request?.action === "clear") {
    return clarifyPlayerMemoryClear(state, pending, answer);
  }

  if (isCancellationAnswer(answer)) {
    return cancelledPlayerMemoryManagement(
      request?.action === "correct"
        ? "已取消称呼纠正，原有球员记忆保持不变。"
        : "已取消，没有删除任何球员身份记忆。"
    );
  }

  const target = memoryForgetOptionFromAnswer(answer, pending);

  if (target === null) {
    return invalidAnswer(
      pending,
      `请选择一个有效的记忆目标编号，或回复“取消”：${pending.question}`
    );
  }

  if (
    request === null ||
    (request.action !== "forget" && request.action !== "correct")
  ) {
    return invalidAnswer(pending, "记忆管理请求已变化，请重新发起操作。");
  }

  return {
    outcome: null,
    pendingClarification: null,
    playerMemoryManagementRequest: { ...request, selectedTarget: target },
  };
};

const clarifyFmProfile = (
  state: AgentStateType,
  pending: Extract<PendingClarification, { kind: "fm_profile" }>,
  answer: string
) => {
  const sourceId = answerForOptions(answer, pending.options);
  const { request } = state;

  const canChooseFmProfile =
    request.kind === "player_recommendation" ||
    (request.kind === "team_recommendation" &&
      request.teamRecommendation.referenceMode === "named");

  if (sourceId === null || !canChooseFmProfile) {
    return invalidAnswer(
      pending,
      `请选择一个有效 FM source ID：${pending.options.join("、")}。`
    );
  }

  const player = request.players[pending.playerIndex];
  const resolution = player?.resolution;

  if (player === undefined || resolution?.status !== "resolved") {
    return invalidAnswer(
      pending,
      "参考球员身份状态已变化，请重新发起推荐请求。"
    );
  }

  const selectedCandidate = selectedReferenceCandidate(resolution);

  if (selectedCandidate === null) {
    return invalidAnswer(pending, "已确认身份中没有可选的 FM 画像记录。");
  }

  const selectedFmRecord = selectedCandidate.records.find(
    (record) => record.provider === "fm" && record.sourceId === sourceId
  );

  if (selectedFmRecord === undefined) {
    return invalidAnswer(pending, "所选 FM source ID 不属于已确认的球员身份。");
  }

  const candidateWithSelectedFmRecord = {
    ...selectedCandidate,
    records: selectedCandidate.records.filter(
      (record) => record.provider !== "fm" || record.sourceId === sourceId
    ),
  };

  const candidates = resolution.candidates.map((candidate) =>
    candidate.candidateId === candidateWithSelectedFmRecord.candidateId
      ? candidateWithSelectedFmRecord
      : candidate
  );

  const players = request.players.map((requestPlayer, index) =>
    index === pending.playerIndex
      ? {
          ...requestPlayer,
          resolution: { ...resolution, candidates },
        }
      : requestPlayer
  );

  return {
    outcome: null,
    pendingClarification: null,
    request: { ...request, players },
  };
};

const clarifyAge = (
  state: AgentStateType,
  pending: Extract<PendingClarification, { kind: "age" }>,
  answer: string
) => {
  const maxAge = answerForAge(answer);

  if (maxAge === null || state.request.kind !== "player_recommendation") {
    return invalidAnswer(
      pending,
      "请给出 1 到 60 之间的具体年龄上限，例如 23 岁以下。"
    );
  }

  return {
    outcome: null,
    pendingClarification: null,
    request: {
      ...state.request,
      recommendation: {
        ...state.request.recommendation,
        maxAge,
        needsAgeClarification: false,
      },
    },
  };
};

const clarifySeason = (
  state: AgentStateType,
  pending: Extract<PendingClarification, { kind: "season" }>,
  answer: string
) => {
  const season = answerForSeason(answer);

  if (season === null || state.request.kind !== "player_comparison") {
    return invalidAnswer(
      pending,
      "请用明确格式输入连续两个赛季，例如 2024/25。"
    );
  }

  return {
    outcome: null,
    pendingClarification: null,
    request: {
      ...state.request,
      constraints: mergeComparisonConstraints(state.request.constraints, [
        { name: "season", value: season },
      ]),
    },
  };
};

const clarifyRole = (
  state: AgentStateType,
  pending: Extract<PendingClarification, { kind: "recommendation_role" }>,
  answer: string
) => {
  const role = roleFromAnswer(answer);

  if (role === null) {
    return invalidAnswer(pending, "请回复“参考”或“排除”。");
  }

  const players = state.request.players.map((player, index) =>
    index === pending.playerIndex
      ? { ...player, recommendationRole: role }
      : player
  );

  return {
    outcome: null,
    pendingClarification: nextRecommendationClarification(state, players),
    request: { ...state.request, players },
  };
};

const resumeClarification = (
  state: AgentStateType,
  pending: PendingClarification,
  answer: string | null
): Partial<AgentStateType> => {
  if (
    pending.kind === "identity" &&
    state.playerMemoryManagementRequest?.action === "correct" &&
    answer !== null &&
    isCancellationAnswer(answer)
  ) {
    return cancelledPlayerMemoryManagement(
      "已取消称呼纠正，原有球员记忆保持不变。"
    );
  }

  if (pending.kind === "identity") {
    return { pendingClarification: { ...pending, answer } };
  }

  if (answer === null) {
    return invalidAnswer(pending, "请提供有效回答后继续。");
  }

  if (pending.kind === "position") {
    return clarifyPosition(state, pending, answer);
  }

  if (pending.kind === "fm_profile") {
    return clarifyFmProfile(state, pending, answer);
  }

  if (pending.kind === "age") {
    return clarifyAge(state, pending, answer);
  }

  if (pending.kind === "season") {
    return clarifySeason(state, pending, answer);
  }

  if (pending.kind === "team") {
    return clarifyTeam(state, pending, answer);
  }

  if (pending.kind === "team_position") {
    return clarifyTeamPosition(state, pending, answer);
  }

  if (pending.kind === "team_roster_profile") {
    return clarifyTeamRosterProfile(state, pending, answer);
  }

  if (pending.kind === "player_memory_management") {
    return clarifyPlayerMemoryManagement(state, pending, answer);
  }

  if (pending.kind === "workflow") {
    const workflow = workflowOptionFromAnswer(answer, pending.options);

    return workflow === null
      ? invalidAnswer(
          pending,
          `请选择一个有效工作流：${pending.options.join("、")}。`
        )
      : resumeWorkflowClarification(state, pending.draft, workflow);
  }

  return clarifyRole(state, pending, answer);
};

type PlayerMemoryCapability = {
  rememberRosterIdentity: typeof rememberRosterIdentity;
};

type RosterConfirmationDetails = Omit<
  RosterIdentityConfirmation,
  "originThreadId" | "processedMessageId"
>;

const rosterConfirmationDetails = (
  state: AgentStateType,
  pending: Extract<PendingClarification, { kind: "team_roster_profile" }>,
  request: AgentStateType["request"] | undefined
): RosterConfirmationDetails | null => {
  if (
    state.request.kind !== "team_recommendation" ||
    request?.kind !== "team_recommendation"
  ) {
    return null;
  }

  const previousRoster = state.request.teamRecommendation.roster;
  const updatedRoster = request.teamRecommendation.roster;
  const previousMember = previousRoster?.members[pending.rosterIndex];
  const updatedMember = updatedRoster?.members[pending.rosterIndex];

  if (
    previousMember === undefined ||
    updatedMember?.mappingMethod !== "user_confirmation" ||
    updatedMember.fmId === null
  ) {
    return null;
  }

  const fmCandidate = pending.candidates.find(
    (candidate) => candidate.fmId === updatedMember.fmId
  );

  if (fmCandidate === undefined) {
    return null;
  }

  return {
    apiFootballPlayerId: previousMember.apiFootballPlayerId,
    fmId: updatedMember.fmId,
    fmPlayerName: fmCandidate.name,
    playerName: previousMember.name,
    rosterIndex: pending.rosterIndex,
    rosterRetrievedAt: previousRoster?.retrievedAt ?? null,
  };
};

const createClarifyNode =
  (
    memory: PlayerMemoryCapability,
    configuredStore: BaseStore | null
  ): GraphNode<typeof AgentState> =>
  async (state, config) => {
    const compatibilityUpdate = stateCompatibilityUpdate(state);

    if (compatibilityUpdate !== null) {
      return compatibilityUpdate;
    }

    const pending = state.pendingClarification;

    if (pending === null) {
      return {};
    }

    const previousPlayerMemoryStatus =
      state.playerMemoryStatus ?? createInitialPlayerMemoryStatus();

    const answer = interruptForAnswer(state, pending);
    const update = resumeClarification(state, pending, answer);

    if (pending.kind !== "team_roster_profile" || answer === null) {
      return update;
    }

    const details = rosterConfirmationDetails(state, pending, update.request);

    if (details === null) {
      return update;
    }

    const store = configuredStore ?? getStore(config);
    const threadId = z.string().safeParse(config.configurable?.thread_id);

    if (store === undefined || !threadId.success) {
      return {
        ...update,
        playerMemoryStatus: {
          ...previousPlayerMemoryStatus,
          writeFailed: true,
        },
      };
    }

    const result = await memory.rememberRosterIdentity(store, {
      ...details,
      originThreadId: threadId.data,
      processedMessageId: state.request.processedMessageId,
    });

    return {
      ...update,
      playerMemoryStatus: {
        ...previousPlayerMemoryStatus,
        writeFailed:
          previousPlayerMemoryStatus.writeFailed ||
          result.status === "unavailable",
      },
    };
  };

export { createClarifyNode };
