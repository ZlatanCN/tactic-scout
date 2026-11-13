import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod/v4";

import { contextProcessingEvidenceOperation } from "../context-processing-state.js";
import type { ContextProcessingAllowanceConfiguration } from "../context-processing-state.js";
import { splitEvidenceBatchProjections } from "../evidence-batch-planning.js";
import { assessModelRequest } from "../model-context.js";
import type { ModelContextConfiguration } from "../model-context.js";
import {
  playerRecommendationEvidenceIsComplete,
  playerRecommendationEvidenceProjections,
  playerRecommendationEvidenceProjectionsForBatchPlan,
  playerRecommendationEvidenceQuestionMessage,
} from "../player-recommendation-evidence.js";
import type { PlayerRecommendationEvidenceBatchPlan } from "../player-recommendation-evidence.js";
import { recommendationEvidenceMetadataSummary } from "../recommendation-answer.js";
import type { AgentStateType, EvidenceBatchState } from "../state.js";
import {
  createEvidenceBatchNodes,
  evidenceProjectionsFitModelInput,
  largestFittingEvidencePlan,
} from "./evidence-batches.js";
import type {
  EvidenceProjection,
  EvidenceTask,
  EvidenceWorkflow,
} from "./evidence-batches.js";

const playerRecommendationEvidencePrompt = `你是足球球员推荐结果解释器。只依据投影中的已验证结果回答，不调用排名器、不改变原始顺序、不省略候选，也不合并当前能力榜与高潜榜。每批只解释 selectedCandidates 指定的那一份名单，保留 rank、姓名、FM ID、年龄、位置评分、CA、PA 和 currentDistance。null 要明确写未提供，不把投影未选择的字段说成来源缺失。只解释本批候选，不重复全局参考画像、日期、筛选和阶段计数；程序会根据完整结果统一呈现这些内容。PA 是潜力信号，不保证未来能力。`;

type PlayerRecommendationEvidenceConfiguration = {
  allowance?: ContextProcessingAllowanceConfiguration;
  model: BaseChatModel;
  modelContextConfiguration?: ModelContextConfiguration;
};

const projectionCountsSchema = z.object({
  candidateCounts: z.object({
    current: z.number().int().nonnegative(),
    potential: z.number().int().nonnegative(),
  }),
});

const playerRecommendationEvidenceProjectionsWithinBudget = async (
  task: EvidenceTask & { deadlineAt: number },
  configuration: PlayerRecommendationEvidenceConfiguration
) => {
  const singleCandidateProjections = playerRecommendationEvidenceProjections(
    task.resultJson,
    task.source,
    1
  );

  if (singleCandidateProjections === null || Date.now() >= task.deadlineAt) {
    return null;
  }

  const [firstProjection] = singleCandidateProjections;

  if (firstProjection === undefined) {
    return null;
  }

  const counts = projectionCountsSchema.safeParse(
    JSON.parse(firstProjection.projectionJson)
  );

  if (!counts.success) {
    return null;
  }

  const largestListCount = Math.max(
    counts.data.candidateCounts.current,
    counts.data.candidateCounts.potential
  );

  return await largestFittingEvidencePlan(
    Math.min(largestListCount, task.maxItemsPerBatch ?? largestListCount),
    task.deadlineAt,
    (candidatesPerBatch) =>
      playerRecommendationEvidenceProjections(
        task.resultJson,
        task.source,
        candidatesPerBatch
      ),
    async (projections) =>
      await evidenceProjectionsFitModelInput(
        projections,
        configuration.model,
        configuration.modelContextConfiguration,
        task.deadlineAt,
        (projectionJson) => [
          new SystemMessage(playerRecommendationEvidencePrompt),
          new HumanMessage(
            playerRecommendationEvidenceQuestionMessage(
              task.question,
              projectionJson
            )
          ),
        ]
      )
  );
};

const recommendationBatchPlanFor = (
  batches: NonNullable<
    AgentStateType["playerRecommendationEvidence"]
  >["batches"]
): PlayerRecommendationEvidenceBatchPlan[] | null => {
  const batchSchema = z.object({
    batch: z.object({
      candidateRefs: z.array(z.string()),
      list: z.enum(["current", "potential"]),
    }),
  });

  const plan: PlayerRecommendationEvidenceBatchPlan[] = [];

  for (const { projectionJson } of batches) {
    let value: unknown;

    try {
      value = JSON.parse(projectionJson);
    } catch {
      return null;
    }

    const parsed = batchSchema.safeParse(value);

    if (!parsed.success || parsed.data.batch.candidateRefs.length === 0) {
      return null;
    }

    plan.push({
      list: parsed.data.batch.list,
      size: parsed.data.batch.candidateRefs.length,
    });
  }

  return plan;
};

const splitPlayerRecommendationEvidenceBatch = (
  task: EvidenceTask,
  batches: NonNullable<
    AgentStateType["playerRecommendationEvidence"]
  >["batches"],
  batchIndex: number
): EvidenceProjection[] | null =>
  splitEvidenceBatchProjections({
    batchIndex,
    batchPlan: recommendationBatchPlanFor(batches),
    projectBatchPlan: (plan) =>
      playerRecommendationEvidenceProjectionsForBatchPlan(
        task.resultJson,
        task.source,
        plan
      ),
  });

const playerRecommendationEvidenceWorkflow = (
  configuration: PlayerRecommendationEvidenceConfiguration
): EvidenceWorkflow => ({
  cacheTag: "player-recommendation-evidence-v1",
  complete: (evidence, task) =>
    playerRecommendationEvidenceIsComplete(evidence, task.resultJson),
  getEvidence: (state) => state.playerRecommendationEvidence,
  getResult: (state) => {
    const { outcome } = state;

    if (outcome?.kind !== "player_recommendation") {
      return null;
    }

    if (outcome.resultJson === null || !("source" in outcome)) {
      return null;
    }

    if (outcome.status !== "ready" && outcome.status !== "no_candidates") {
      return null;
    }

    return { resultJson: outcome.resultJson, source: outcome.source };
  },
  operation: contextProcessingEvidenceOperation.playerRecommendation,
  project: async (task) =>
    await playerRecommendationEvidenceProjectionsWithinBudget(
      task,
      configuration
    ),
  questionMessage: playerRecommendationEvidenceQuestionMessage,
  setEvidence: (playerRecommendationEvidence) => ({
    playerRecommendationEvidence,
  }),
  shouldProcess: async (_state, task) => {
    try {
      const assessment = await assessModelRequest(
        configuration.model,
        {
          messages: [
            new SystemMessage(playerRecommendationEvidencePrompt),
            new HumanMessage(
              `用户请求：${task.question}\n\n结构化工具结果：\n${task.resultJson}`
            ),
          ],
          purpose: "answer",
        },
        configuration.modelContextConfiguration ?? {}
      );

      return (
        assessment.failure !== null || assessment.assessment.compactionSuggested
      );
    } catch {
      return true;
    }
  },
  splitBatch: splitPlayerRecommendationEvidenceBatch,
  systemPrompt: playerRecommendationEvidencePrompt,
});

const playerRecommendationEvidenceAnswerText = (
  evidence: EvidenceBatchState,
  resultJson: string
): string | null => {
  const sections = evidence.batches.map((batch) => {
    if (batch.answer === null) {
      return null;
    }

    let rawProjection: unknown;

    try {
      rawProjection = JSON.parse(batch.projectionJson);
    } catch {
      return null;
    }

    const projection = z
      .object({
        batch: z.object({
          index: z.number().int(),
          list: z.enum(["current", "potential"]),
        }),
      })
      .safeParse(rawProjection);

    if (!projection.success) {
      return null;
    }

    const { batch: batchMetadata } = projection.data;

    const listLabel =
      batchMetadata.list === "current" ? "当前能力相似候选" : "高潜候选";

    return `${listLabel}（第 ${batchMetadata.index + 1} 批）\n${batch.answer}`;
  });

  if (sections.some((section) => section === null)) {
    return null;
  }

  const [firstBatch] = evidence.batches;

  if (firstBatch === undefined) {
    return null;
  }

  let rawProjection: unknown;

  try {
    rawProjection = JSON.parse(firstBatch.projectionJson);
  } catch {
    return null;
  }

  const projection = z
    .object({
      candidateCounts: z.object({ current: z.number(), potential: z.number() }),
      potentialListStatus: z.enum(["not_requested", "requested"]),
    })
    .safeParse(rawProjection);

  if (!projection.success) {
    return null;
  }

  const { candidateCounts, potentialListStatus } = projection.data;
  const firstAnswer = evidence.batches[0]?.answer ?? "";
  const language = /\p{Script=Han}/u.test(firstAnswer) ? "zh" : "en";

  const metadataSummary = recommendationEvidenceMetadataSummary(
    resultJson,
    language
  );

  if (metadataSummary === null) {
    return null;
  }

  const emptyListSections = [
    ...(candidateCounts.current === 0
      ? [
          language === "zh"
            ? "当前能力相似候选：0 名。"
            : "Current-ability similarity candidates: 0.",
        ]
      : []),
    ...(potentialListStatus === "requested" && candidateCounts.potential === 0
      ? [
          language === "zh"
            ? "高潜候选：0 名。"
            : "High-potential candidates: 0.",
        ]
      : []),
  ];

  const completeSections = sections.flatMap((section) =>
    section === null ? [] : [section]
  );

  return [metadataSummary, ...emptyListSections, ...completeSections].join(
    "\n\n"
  );
};

const createPlayerRecommendationEvidenceNodes = (
  configuration: PlayerRecommendationEvidenceConfiguration
) => {
  const nodes = createEvidenceBatchNodes(
    playerRecommendationEvidenceWorkflow(configuration)
  );

  return {
    answer: nodes.createAnswerNode(configuration),
    matchesCurrentOutcome: nodes.matchesCurrentOutcome,
    prepare: nodes.createPrepareNode(configuration),
    route: nodes.route,
  };
};

const playerRecommendationEvidenceMatchesCurrentOutcome = (
  state: AgentStateType,
  configuration: PlayerRecommendationEvidenceConfiguration
): boolean =>
  createEvidenceBatchNodes(
    playerRecommendationEvidenceWorkflow(configuration)
  ).matchesCurrentOutcome(state);

export {
  createPlayerRecommendationEvidenceNodes,
  playerRecommendationEvidenceAnswerText,
  playerRecommendationEvidenceMatchesCurrentOutcome,
};
