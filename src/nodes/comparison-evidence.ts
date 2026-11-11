import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { correctComparisonEvidenceBatchAnswer } from "../comparison-answer.js";
import {
  comparisonAnswerMessages,
  comparisonBatchPrompt,
  comparisonBatchIsComplete,
  comparisonEvidenceProjections,
  comparisonEvidenceQuestionMessage,
} from "../comparison-evidence.js";
import { contextProcessingEvidenceOperation } from "../context-processing-state.js";
import type { ContextProcessingAllowanceConfiguration } from "../context-processing-state.js";
import { assessModelRequest } from "../model-context.js";
import type { ModelContextConfiguration } from "../model-context.js";
import type { AgentStateType } from "../state.js";
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

type ComparisonEvidenceConfiguration = {
  allowance?: ContextProcessingAllowanceConfiguration;
  model: BaseChatModel;
  modelContextConfiguration?: ModelContextConfiguration;
};

const comparisonEvidenceProjectionsWithinBudget = async (
  task: EvidenceTask & { deadlineAt: number },
  configuration: ComparisonEvidenceConfiguration
): Promise<EvidenceProjection[] | null> => {
  if (Date.now() >= task.deadlineAt) {
    return null;
  }

  const singleParticipantProjections = comparisonEvidenceProjections(
    task.resultJson,
    task.source,
    1
  );

  if (singleParticipantProjections === null) {
    return null;
  }

  return await largestFittingEvidencePlan(
    singleParticipantProjections.length,
    task.deadlineAt,
    (participantsPerBatch) =>
      participantsPerBatch === 1
        ? singleParticipantProjections
        : comparisonEvidenceProjections(
            task.resultJson,
            task.source,
            participantsPerBatch
          ),
    async (projections) =>
      await evidenceProjectionsFitModelInput(
        projections,
        configuration.model,
        configuration.modelContextConfiguration,
        task.deadlineAt,
        (projectionJson) => [
          new SystemMessage(comparisonBatchPrompt),
          new HumanMessage(
            comparisonEvidenceQuestionMessage(task.question, projectionJson)
          ),
        ]
      )
  );
};

const comparisonEvidenceWorkflow = (
  configuration: ComparisonEvidenceConfiguration
): EvidenceWorkflow => ({
  cacheTag: "comparison-evidence-v1",
  complete: (evidence, task) =>
    comparisonBatchIsComplete(evidence, task.resultJson),
  getEvidence: (state) => state.comparisonEvidence,
  getResult: (state) => {
    const { outcome } = state;

    if (outcome?.kind !== "player_comparison") {
      return null;
    }

    if (outcome.resultJson === null || !("source" in outcome)) {
      return null;
    }

    if (outcome.status !== "ready" && outcome.status !== "no_comparable_data") {
      return null;
    }

    return { resultJson: outcome.resultJson, source: outcome.source };
  },
  operation: contextProcessingEvidenceOperation.comparison,
  project: async (task) =>
    await comparisonEvidenceProjectionsWithinBudget(task, configuration),
  questionMessage: comparisonEvidenceQuestionMessage,
  setEvidence: (comparisonEvidence) => ({ comparisonEvidence }),
  shouldProcess: async (_state, task) => {
    try {
      const assessment = await assessModelRequest(
        configuration.model,
        {
          messages: comparisonAnswerMessages(task.question, task.resultJson),
          purpose: "answer",
        },
        configuration.modelContextConfiguration ?? {}
      );

      return (
        assessment.failure !== null || assessment.assessment.compactionSuggested
      );
    } catch {
      return false;
    }
  },
  systemPrompt: comparisonBatchPrompt,
  transformAnswer: (answer, projectionJson) =>
    correctComparisonEvidenceBatchAnswer(answer, projectionJson) ?? answer,
});

const createComparisonEvidenceNodes = (
  configuration: ComparisonEvidenceConfiguration
) => {
  const nodes = createEvidenceBatchNodes(
    comparisonEvidenceWorkflow(configuration)
  );

  return {
    answer: nodes.createAnswerNode(configuration),
    matchesCurrentOutcome: nodes.matchesCurrentOutcome,
    prepare: nodes.createPrepareNode(configuration),
    route: nodes.route,
  };
};

const comparisonEvidenceMatchesCurrentOutcome = (
  state: AgentStateType,
  configuration: ComparisonEvidenceConfiguration
): boolean =>
  createEvidenceBatchNodes(
    comparisonEvidenceWorkflow(configuration)
  ).matchesCurrentOutcome(state);

const comparisonEvidenceRoute = (
  state: AgentStateType,
  configuration: ComparisonEvidenceConfiguration
): string =>
  createEvidenceBatchNodes(comparisonEvidenceWorkflow(configuration)).route(
    state
  )
    ? "answer_comparison_evidence_batch"
    : "answer";

export {
  comparisonEvidenceMatchesCurrentOutcome,
  comparisonEvidenceRoute,
  createComparisonEvidenceNodes,
};

export type { ComparisonEvidenceConfiguration };
