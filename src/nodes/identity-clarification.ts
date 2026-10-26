import { interrupt } from "@langchain/langgraph";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { mergeComparisonConstraints } from "../comparison-context.js";
import { selectedReferenceCandidate } from "../player-data/contracts.js";
import type {
  AgentState,
  AgentStateType,
  PendingClarification,
  RequestPlayerState,
} from "../state.js";

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

  const candidates = isIdentity ? identityCandidates(state) : [];

  const kind = isIdentity
    ? "player_identity_confirmation"
    : `recommendation_${pending.kind}_clarification`;

  const payload = {
    candidates,
    kind,
    mention: player?.mention ?? null,
    playerIndex: isIdentity ? pending.playerIndex : null,
    question: pending.question,
    requestKind: state.request.kind,
  };

  const rawResume: unknown =
    pending.kind === "position" || pending.kind === "fm_profile"
      ? interrupt({ ...payload, options: pending.options })
      : interrupt(payload);

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

const clarifyFmProfile = (
  state: AgentStateType,
  pending: Extract<PendingClarification, { kind: "fm_profile" }>,
  answer: string
) => {
  const sourceId = answerForOptions(answer, pending.options);

  if (sourceId === null || state.request.kind !== "player_recommendation") {
    return invalidAnswer(
      pending,
      `请选择一个有效 FM source ID：${pending.options.join("、")}。`
    );
  }

  const player = state.request.players[pending.playerIndex];
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

  const players = state.request.players.map((requestPlayer, index) =>
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
    request: { ...state.request, players },
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
) => {
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

  return clarifyRole(state, pending, answer);
};

const createClarifyNode = (): GraphNode<typeof AgentState> => (state) => {
  const pending = state.pendingClarification;

  if (pending === null) {
    return {};
  }

  return resumeClarification(
    state,
    pending,
    interruptForAnswer(state, pending)
  );
};

export { createClarifyNode };
