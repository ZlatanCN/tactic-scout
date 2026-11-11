import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod/v4";

import { contextProcessingHash } from "./context-processing-state.js";
import type { EvidenceProjection } from "./nodes/evidence-batches.js";
import { comparisonResultSchema } from "./player-data/compare-records.js";
import type { AgentStateType, EvidenceBatchState } from "./state.js";

const comparisonEvidencePrompt = `你是一个足球资料助手。当前请求是多人球员比较，只能依据下面提供的结构化比较结果作答。优先用表格逐项呈现全部已确认球员。Understat 的 understatScopeGroups 表示至少两名球员有记录的赛事和赛季范围，不保证覆盖所有参与者。每组必须检查 coverage.coversAllParticipants；只有它为 true 时，才能称该范围对所有参与者共同。为 false 时，只能比较该组中 record 非 null 的球员，明确指出未覆盖的球员；如果 coverage.commonUnderstatScopeCount 为 0，必须说明没有覆盖全部参与者的共同 Understat 范围，不得把该组说成所有参与者共同范围或据此给所有球员排名。各球员原始 Understat 记录仍按自己的赛事和赛季分别呈现。Football Manager 的能力值和属性单独呈现，不要把它们说成比赛表现，也不要与 Understat 指标合并成综合分。FM 的 naturalPositions 表示球员的自然位置，不代表当前注册位置或本场位置；表格必须标为“自然位置”或“Natural position”，不得写“当前位置”或“Current position”。FM 属性键 technique 表示“技术”，dribbling 表示“盘带”；不要把 technique 写成“盘带技术”。若 FM 记录的 birthDate、heightCm 或属性字段有具体值，应准确报告；只有对应值为 null 或无记录时，才能说该球员该字段未提供，不得笼统声称全部缺失。不要补猜缺失值、当前球队、合同、身价、转会可行性或谁整体更强。`;

const comparisonBatchPrompt = `${comparisonEvidencePrompt.replace(
  "优先用表格逐项呈现全部已确认球员。",
  "本批只解释 selectedPlayers 中列出的参与者。"
)}

当前输入是证据批次。participants 是完整的已确认参与者清单；selectedPlayers 只包含本批详细资料。不要把未选入本批的字段说成缺失。understatScopes[].coverage 保留完整结果的全局人数和 coversAllParticipants；includedPlayers 只列本批的范围记录。coversAllParticipants 为 false 时，只能依据 includedPlayers 中非 null 的记录描述本批覆盖。每一批只解释 selectedPlayers；跨批内容合并后也不要给全体参与者排名或判断谁整体更强。`;

const comparisonAnswerMessages = (question: string, resultJson: string) => [
  new SystemMessage(comparisonEvidencePrompt),
  new HumanMessage(`用户请求：${question}\n\n结构化工具结果：\n${resultJson}`),
];

const comparisonEvidenceQuestionMessage = (
  question: string,
  projectionJson: string
): string =>
  `用户请求：${question}\n\nComparison evidence projection JSON:\n${projectionJson}`;

type CompletedComparisonResult = Extract<
  z.output<typeof comparisonResultSchema>,
  { status: "ready" | "no_comparable_data" }
>;

type ComparisonParticipant = CompletedComparisonResult["players"][number];

type ParticipantProviderResult =
  | ComparisonParticipant["fm"]
  | ComparisonParticipant["understat"];

const participantProviderCoverage = (result: ParticipantProviderResult) => {
  if (result === null) {
    return { status: "not_queried" as const };
  }

  if (result.status === "unavailable") {
    return { reason: result.reason, status: result.status };
  }

  if (result.status === "found") {
    return { recordCount: result.records.length, status: result.status };
  }

  return { status: result.status };
};

const parseCompletedComparison = (
  resultJson: string
): CompletedComparisonResult | null => {
  let rawResult: unknown;

  try {
    rawResult = JSON.parse(resultJson);
  } catch {
    return null;
  }

  const parsed = comparisonResultSchema.safeParse(rawResult);

  return parsed.success && "coverage" in parsed.data ? parsed.data : null;
};

const selectedParticipantIndexes = (
  start: number,
  participantCount: number,
  participantsPerBatch: number
): number[] =>
  Array.from(
    {
      length: Math.min(participantsPerBatch, participantCount - start),
    },
    (_, offset) => start + offset
  );

const participantRefsFor = (participantCount: number): string[] =>
  Array.from({ length: participantCount }, (_, index) => `players[${index}]`);

const playerRecordRefs = (
  result: CompletedComparisonResult,
  participantIndexes: number[]
): string[] =>
  participantIndexes.flatMap((index) => {
    const player = result.players[index];

    if (player === undefined) {
      return [];
    }

    const fmRefs =
      player.fm?.status === "found"
        ? player.fm.records.map(
            (_, recordIndex) => `players[${index}].fm.records[${recordIndex}]`
          )
        : [];

    const understatRefs =
      player.understat?.status === "found"
        ? player.understat.records.map(
            (_, recordIndex) =>
              `players[${index}].understat.records[${recordIndex}]`
          )
        : [];

    return [...fmRefs, ...understatRefs];
  });

const scopeRecordRefs = (
  result: CompletedComparisonResult,
  participantIndexes: number[]
): string[] =>
  result.understatScopeGroups.flatMap((scope, scopeIndex) =>
    participantIndexes.flatMap((playerIndex) => {
      const scopedPlayer = scope.players[playerIndex];

      return scopedPlayer?.record === null || scopedPlayer === undefined
        ? []
        : [
            `understatScopeGroups[${scopeIndex}].players[${playerIndex}].record`,
          ];
    })
  );

const scopeProjections = (
  result: CompletedComparisonResult,
  participantRefs: string[],
  participantIndexes: number[]
) =>
  result.understatScopeGroups.map((scope, scopeIndex) => ({
    competition: scope.competition,
    coverage: scope.coverage,
    includedPlayers: participantIndexes.map((playerIndex) => {
      const player = scope.players[playerIndex];

      return {
        participantRef: participantRefs[playerIndex],
        playerName:
          player?.playerName ?? result.players[playerIndex]?.playerName ?? "",
        record: player?.record ?? null,
        recordRef:
          player?.record === null || player === undefined
            ? null
            : `understatScopeGroups[${scopeIndex}].players[${playerIndex}].record`,
      };
    }),
    season: scope.season,
  }));

const participantRoster = (
  result: CompletedComparisonResult,
  participantRefs: string[]
) =>
  result.players.map((player, index) => ({
    identityBasis: player.identityBasis ?? null,
    participantRef: participantRefs[index],
    playerName: player.playerName,
    providerCoverage: {
      fm: participantProviderCoverage(player.fm),
      understat: participantProviderCoverage(player.understat),
    },
  }));

const comparisonProjectionForBatch = (
  result: CompletedComparisonResult,
  resultJson: string,
  source: "executed" | "saved",
  start: number,
  index: number,
  total: number,
  participantsPerBatch: number
): EvidenceProjection => {
  const refs = participantRefsFor(result.players.length);

  const participantIndexes = selectedParticipantIndexes(
    start,
    result.players.length,
    participantsPerBatch
  );

  const selectedRefs = participantIndexes.flatMap((playerIndex) => {
    const reference = refs[playerIndex];

    return reference === undefined ? [] : [reference];
  });

  const recordRefs = [
    ...playerRecordRefs(result, participantIndexes),
    ...scopeRecordRefs(result, participantIndexes),
  ];

  const projection = {
    batch: {
      completedParticipantRefs: refs.slice(0, start),
      index,
      participantRefs: selectedRefs,
      remainingParticipantRefs: refs.slice(start + participantIndexes.length),
      total,
    },
    coverage: result.coverage,
    digest: contextProcessingHash(resultJson),
    participants: participantRoster(result, refs),
    recordRefs,
    selectedPlayers: participantIndexes.flatMap((playerIndex) => {
      const player = result.players[playerIndex];
      const participantRef = refs[playerIndex];

      return player === undefined || participantRef === undefined
        ? []
        : [{ ...player, participantRef }];
    }),
    source,
    understatScopes: scopeProjections(result, refs, participantIndexes),
    version: 1,
  };

  return { projectionJson: JSON.stringify(projection), recordRefs };
};

const comparisonEvidenceProjectionsForBatchSizes = (
  resultJson: string,
  source: "executed" | "saved",
  batchSizes: number[]
): EvidenceProjection[] | null => {
  const result = parseCompletedComparison(resultJson);

  if (
    result === null ||
    batchSizes.length === 0 ||
    batchSizes.some((size) => !Number.isSafeInteger(size) || size < 1) ||
    batchSizes.reduce((total, size) => total + size, 0) !==
      result.players.length
  ) {
    return null;
  }

  let start = 0;
  const total = batchSizes.length;

  return batchSizes.map((size, index) => {
    const projection = comparisonProjectionForBatch(
      result,
      resultJson,
      source,
      start,
      index,
      total,
      size
    );

    start += size;

    return projection;
  });
};

const comparisonEvidenceProjections = (
  resultJson: string,
  source: "executed" | "saved",
  participantsPerBatch = 2
): EvidenceProjection[] | null => {
  const result = parseCompletedComparison(resultJson);

  if (
    result === null ||
    !Number.isSafeInteger(participantsPerBatch) ||
    participantsPerBatch < 1
  ) {
    return null;
  }

  const batchSizes = Array.from(
    { length: Math.ceil(result.players.length / participantsPerBatch) },
    (_unused, index) =>
      Math.min(
        participantsPerBatch,
        result.players.length - index * participantsPerBatch
      )
  );

  return comparisonEvidenceProjectionsForBatchSizes(
    resultJson,
    source,
    batchSizes
  );
};

const comparisonBatchHeaderSchema = z.object({
  batch: z.object({
    index: z.number().int().nonnegative(),
    participantRefs: z.array(z.string()),
    total: z.number().int().positive(),
  }),
  coverage: z.object({
    commonUnderstatScopeCount: z.number().int().nonnegative(),
    fmPlayerCount: z.number().int().nonnegative(),
    hasFmRecords: z.boolean(),
    hasUnderstatRecords: z.boolean(),
    playerCount: z.number().int().positive(),
  }),
  participants: z.array(
    z.object({
      identityBasis: z.string().nullable(),
      participantRef: z.string(),
      playerName: z.string(),
      providerCoverage: z.object({
        fm: z.object({
          reason: z.string().optional(),
          recordCount: z.number().int().nonnegative().optional(),
          status: z.string(),
        }),
        understat: z.object({
          reason: z.string().optional(),
          recordCount: z.number().int().nonnegative().optional(),
          status: z.string(),
        }),
      }),
    })
  ),
  selectedPlayers: z.array(z.object({ participantRef: z.string() })),
  understatScopes: z.array(
    z.object({
      competition: z.string(),
      coverage: z.object({
        coveredPlayerCount: z.number().int().nonnegative(),
        coversAllParticipants: z.boolean(),
        participantCount: z.number().int().positive(),
      }),
      season: z.string(),
    })
  ),
});

const parseComparisonBatchHeader = (projectionJson: string) => {
  try {
    return comparisonBatchHeaderSchema.safeParse(JSON.parse(projectionJson));
  } catch {
    return { success: false as const };
  }
};

const escapeRegularExpression = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const answerMentionsParticipants = (
  answer: string,
  playerNames: string[]
): boolean => {
  let requiredNames = "";

  for (const playerName of playerNames) {
    requiredNames += `(?=[\\s\\S]*${escapeRegularExpression(playerName)})`;
  }

  return new RegExp(`^${requiredNames}[\\s\\S]*$`, "u").test(answer);
};

const comparisonBatchIsComplete = (
  evidence: NonNullable<AgentStateType["comparisonEvidence"]>,
  resultJson: string
): boolean => {
  const result = parseCompletedComparison(resultJson);

  if (result === null || evidence.batches.length === 0) {
    return false;
  }

  const batchSizes = evidence.batches.map(({ projectionJson }) => {
    const parsed = parseComparisonBatchHeader(projectionJson);

    return parsed.success ? parsed.data.batch.participantRefs.length : 0;
  });

  const expected = comparisonEvidenceProjectionsForBatchSizes(
    resultJson,
    evidence.source,
    batchSizes
  );

  if (expected === null || expected.length !== evidence.batches.length) {
    return false;
  }

  let participantStart = 0;

  for (const [index, batch] of evidence.batches.entries()) {
    const expectedProjection = expected[index];
    const batchSize = batchSizes[index] ?? 0;
    const { answer } = batch;

    const expectedNames = result.players
      .slice(participantStart, participantStart + batchSize)
      .map(({ playerName }) => playerName);

    participantStart += batchSize;

    if (
      expectedProjection === undefined ||
      answer === null ||
      JSON.stringify(batch.recordRefs) !==
        JSON.stringify(expectedProjection.recordRefs)
    ) {
      return false;
    }

    if (!answerMentionsParticipants(answer, expectedNames)) {
      return false;
    }

    if (batch.projectionJson !== expectedProjection.projectionJson) {
      return false;
    }
  }

  return true;
};

const playerNamesFromProjection = (projectionJson: string): string[] | null => {
  let projection: unknown;

  try {
    projection = JSON.parse(projectionJson);
  } catch {
    return null;
  }

  const parsed = z
    .object({
      selectedPlayers: z.array(z.object({ playerName: z.string() })),
    })
    .safeParse(projection);

  return parsed.success
    ? parsed.data.selectedPlayers.map(({ playerName }) => playerName)
    : null;
};

type ComparisonProviderCoverage = z.output<
  typeof comparisonBatchHeaderSchema
>["participants"][number]["providerCoverage"]["fm"];

const formatProviderCoverage = (
  coverage: ComparisonProviderCoverage
): string => {
  if (coverage.status === "found") {
    return `found (${coverage.recordCount ?? 0} records)`;
  }

  if (coverage.status === "unavailable" && coverage.reason !== undefined) {
    return `unavailable (${coverage.reason})`;
  }

  return coverage.status;
};

const comparisonEvidenceAnswerText = (
  evidence: EvidenceBatchState
): string | null => {
  const [firstBatch] = evidence.batches;

  if (firstBatch === undefined) {
    return null;
  }

  const header = parseComparisonBatchHeader(firstBatch.projectionJson);

  if (!header.success) {
    return null;
  }

  const sections = evidence.batches.map((batch) => {
    if (batch.answer === null) {
      return null;
    }

    const playerNames = playerNamesFromProjection(batch.projectionJson);

    if (playerNames === null) {
      return null;
    }

    const participantLabel = playerNames.join("、");

    return `第 ${batch.index + 1} 批（${participantLabel}）\n${batch.answer}`;
  });

  if (sections.some((section) => section === null)) {
    return null;
  }

  const completeSections = sections.flatMap((section) =>
    section === null ? [] : [section]
  );

  const participantLines = header.data.participants.map(
    ({ playerName, providerCoverage }) =>
      `${playerName}（FM: ${formatProviderCoverage(providerCoverage.fm)}；Understat: ${formatProviderCoverage(providerCoverage.understat)}）`
  );

  const scopeLines = header.data.understatScopes.map(
    ({ competition, coverage, season }) =>
      `${competition} ${season}：${coverage.coveredPlayerCount}/${coverage.participantCount} 人；${coverage.coversAllParticipants ? "覆盖全部参与者" : "仅覆盖部分参与者"}`
  );

  const coverageSummary = [
    `已确认参与者（${header.data.coverage.playerCount}）：${participantLines.join("；")}`,
    `FM 有记录参与者：${header.data.coverage.fmPlayerCount}/${header.data.coverage.playerCount}；Understat 有记录：${header.data.coverage.hasUnderstatRecords ? "是" : "否"}`,
    `覆盖全部参与者的共同 Understat 范围数：${header.data.coverage.commonUnderstatScopeCount}`,
    ...(scopeLines.length > 0
      ? [`Understat 各范围覆盖：${scopeLines.join("；")}`]
      : ["没有覆盖至少两名参与者的共同 Understat 范围。"]),
  ].join("\n");

  return [
    coverageSummary,
    "以下分批说明仅覆盖各自列出的参与者与范围，不构成全体参与者的整体强弱排名。",
    ...completeSections,
  ].join("\n\n");
};

export {
  comparisonAnswerMessages,
  comparisonBatchPrompt,
  comparisonBatchIsComplete,
  comparisonEvidenceAnswerText,
  comparisonEvidenceProjections,
  comparisonEvidenceProjectionsForBatchSizes,
  comparisonEvidencePrompt,
  comparisonEvidenceQuestionMessage,
};
