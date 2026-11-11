import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod/v4";

import { contextProcessingEvidenceOperation } from "../context-processing-state.js";
import type { ContextProcessingAllowanceConfiguration } from "../context-processing-state.js";
import { assessModelRequest } from "../model-context.js";
import type { ModelContextConfiguration } from "../model-context.js";
import { teamRecommendationEvidenceMetadataSummary } from "../recommendation-answer.js";
import type { AgentStateType, EvidenceBatchState } from "../state.js";
import {
  teamRecommendationBatchIsComplete,
  teamRecommendationEvidenceProjections,
  teamRecommendationEvidenceProjectionsForBatchSizes,
  teamRecommendationEvidenceQuestionMessage,
} from "../team-recommendation-evidence.js";
import {
  createEvidenceBatchNodes,
  evidenceProjectionsFitModelInput,
  largestFittingEvidencePlan,
} from "./evidence-batches.js";
import type { EvidenceTask, EvidenceWorkflow } from "./evidence-batches.js";

const teamRecommendationEvidencePrompt = `你是足球球队推荐结果解释器。只依据投影中的已验证结果回答，不查询球队或重新排名。严格按原顺序分别呈现当前能力相似名单和高潜名单，不省略候选。每行保留 rank、姓名、FM ID、年龄、位置评分、CA、PA 和 currentDistance；null 明确写未提供。只解释本批候选，不重复全局球队、阵容、排名、参考、筛选和排除元数据；程序会根据完整结果统一呈现这些内容。映射覆盖人数不等于位置能力合格人数。不要把 PA 与 RMSE 混成一个分数，也不要推断阵容缺口、战术适配、当前球队或转会可行性。`;

type TeamRecommendationEvidenceConfiguration = {
  allowance?: ContextProcessingAllowanceConfiguration;
  model: BaseChatModel;
  modelContextConfiguration?: ModelContextConfiguration;
};

const projectionCandidateCountsSchema = z.object({
  candidateCoverage: z.object({
    currentCandidateCount: z.number().int().nonnegative(),
    potentialCandidateCount: z.number().int().nonnegative().nullable(),
  }),
});

const teamRecommendationEvidenceProjectionsWithinBudget = async (
  task: EvidenceTask & { deadlineAt: number },
  configuration: TeamRecommendationEvidenceConfiguration
) => {
  const singleCandidateProjections = teamRecommendationEvidenceProjections(
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

  const counts = projectionCandidateCountsSchema.safeParse(
    JSON.parse(firstProjection.projectionJson)
  );

  if (!counts.success) {
    return null;
  }

  const { currentCandidateCount } = counts.data.candidateCoverage;

  const potentialCandidateCount =
    counts.data.candidateCoverage.potentialCandidateCount ?? 0;

  const totalCandidateCount = currentCandidateCount + potentialCandidateCount;

  return await largestFittingEvidencePlan(
    totalCandidateCount,
    task.deadlineAt,
    (candidatesPerBatch) => {
      const batchSizes =
        totalCandidateCount === 0
          ? [0]
          : Array.from(
              { length: Math.ceil(totalCandidateCount / candidatesPerBatch) },
              (_unused, index) =>
                Math.min(
                  candidatesPerBatch,
                  totalCandidateCount - index * candidatesPerBatch
                )
            );

      return teamRecommendationEvidenceProjectionsForBatchSizes(
        task.resultJson,
        task.source,
        batchSizes
      );
    },
    async (projections) =>
      await evidenceProjectionsFitModelInput(
        projections,
        configuration.model,
        configuration.modelContextConfiguration,
        task.deadlineAt,
        (projectionJson) => [
          new SystemMessage(teamRecommendationEvidencePrompt),
          new HumanMessage(
            teamRecommendationEvidenceQuestionMessage(
              task.question,
              projectionJson
            )
          ),
        ]
      )
  );
};

const teamRecommendationEvidenceWorkflow = (
  configuration: TeamRecommendationEvidenceConfiguration
): EvidenceWorkflow => ({
  cacheTag: "team-recommendation-evidence-v1",
  complete: (evidence, task) =>
    teamRecommendationBatchIsComplete(evidence, task.resultJson),
  getEvidence: (state) => state.teamRecommendationEvidence,
  getResult: (state) => {
    const { outcome } = state;

    if (outcome?.kind !== "team_recommendation") {
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
  operation: contextProcessingEvidenceOperation.teamRecommendation,
  project: async (task) =>
    await teamRecommendationEvidenceProjectionsWithinBudget(
      task,
      configuration
    ),
  questionMessage: teamRecommendationEvidenceQuestionMessage,
  setEvidence: (teamRecommendationEvidence) => ({ teamRecommendationEvidence }),
  shouldProcess: async (_state, task) => {
    if (
      teamRecommendationEvidenceProjections(task.resultJson, task.source, 1) ===
      null
    ) {
      return true;
    }

    try {
      const assessment = await assessModelRequest(
        configuration.model,
        {
          messages: [
            new SystemMessage(teamRecommendationEvidencePrompt),
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
  systemPrompt: teamRecommendationEvidencePrompt,
});

const createTeamRecommendationEvidenceNodes = (
  configuration: TeamRecommendationEvidenceConfiguration
) => {
  const nodes = createEvidenceBatchNodes(
    teamRecommendationEvidenceWorkflow(configuration)
  );

  return {
    answer: nodes.createAnswerNode(configuration),
    matchesCurrentOutcome: nodes.matchesCurrentOutcome,
    prepare: nodes.createPrepareNode(configuration),
    route: nodes.route,
  };
};

const teamRecommendationEvidenceAnswerText = (
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
        batch: z.object({ index: z.number().int() }),
        candidateCoverage:
          projectionCandidateCountsSchema.shape.candidateCoverage,
      })
      .safeParse(rawProjection);

    if (!projection.success) {
      return null;
    }

    const { batch: batchMetadata, candidateCoverage } = projection.data;

    const firstAnswer = evidence.batches[0]?.answer ?? "";
    const language = /\p{Script=Han}/u.test(firstAnswer) ? "zh" : "en";

    const emptyListLabels = [
      ...(candidateCoverage.currentCandidateCount === 0
        ? [
            language === "zh"
              ? "当前能力相似候选：0 名。"
              : "Current-ability similarity candidates: 0.",
          ]
        : []),
      ...(candidateCoverage.potentialCandidateCount === 0
        ? [
            language === "zh"
              ? "高潜候选：0 名。"
              : "High-potential candidates: 0.",
          ]
        : []),
    ];

    return [
      `球队推荐解释第 ${batchMetadata.index + 1} 批`,
      ...emptyListLabels,
      batch.answer,
    ].join("\n");
  });

  if (sections.some((section) => section === null)) {
    return null;
  }

  const firstAnswer = evidence.batches[0]?.answer ?? "";
  const language = /\p{Script=Han}/u.test(firstAnswer) ? "zh" : "en";

  const metadataSummary = teamRecommendationEvidenceMetadataSummary(
    resultJson,
    language
  );

  if (metadataSummary === null) {
    return null;
  }

  return [
    metadataSummary,
    ...sections.flatMap((section) => (section === null ? [] : [section])),
  ].join("\n\n");
};

const teamRecommendationEvidenceMatchesCurrentOutcome = (
  state: AgentStateType,
  configuration: TeamRecommendationEvidenceConfiguration
): boolean =>
  createEvidenceBatchNodes(
    teamRecommendationEvidenceWorkflow(configuration)
  ).matchesCurrentOutcome(state);

export {
  createTeamRecommendationEvidenceNodes,
  teamRecommendationEvidenceAnswerText,
  teamRecommendationEvidenceMatchesCurrentOutcome,
};
