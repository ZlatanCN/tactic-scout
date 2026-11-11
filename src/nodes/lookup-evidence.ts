import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import type { ContextProcessingAllowanceConfiguration } from "../context-processing-state.js";
import { scoutingEvidenceProjections } from "../lookup-evidence.js";
import type { ModelContextConfiguration } from "../model-context.js";
import type { AgentState, AgentStateType } from "../state.js";
import { createEvidenceBatchNodes } from "./evidence-batches.js";
import type {
  EvidenceProjection,
  EvidenceWorkflow,
} from "./evidence-batches.js";

const lookupEvidencePrompt = `你在解释一条已验证球员查询的结构化证据。输入是从完整结果生成的单批 scouting evidence projection；digest、记录引用、来源、赛季、coverage 和剩余范围来自程序。只回答当前这一批直接支持的事实，不从单批推导所有来源、所有赛季或整组球员的结论。fieldStates 中 state=value 表示来源给出了该值，state=source_null 表示来源明确返回 null。unselectedFields 表示没有选择的字段，不是缺失值。provider status=unavailable、not_found 和 not_queried 含义不同。Understat 的表现记录保留实际赛事和赛季；FM 是能力快照，不能据此声称赛季表现或当前注册。当 understat seasonMode=explicit_unresolved 时，说明用户明确写了赛季，但程序没有把它转换为查询范围；不能把 default_snapshot 的记录当成所请求的赛季，要求用户补充完整范围。可以标注记录实际包含的赛季，但不能用它替代用户的请求范围。不要引入外部事实，也不要重查来源。`;

const evidenceBatchProjectionSchema = z.object({
  batch: z.object({ recordRefs: z.array(z.string()) }),
});

type LookupEvidenceNodeConfiguration = {
  allowance?: ContextProcessingAllowanceConfiguration;
  model: BaseChatModel;
  modelContextConfiguration?: ModelContextConfiguration;
};

const lookupEvidenceWorkflow: EvidenceWorkflow = {
  cacheTag: "lookup-evidence-v1",
  getEvidence: (state) => state.lookupEvidence,
  getResult: (state) => {
    const { outcome } = state;

    if (
      outcome?.kind !== "player_lookup" ||
      outcome.resultJson === null ||
      !("source" in outcome)
    ) {
      return null;
    }

    return { resultJson: outcome.resultJson, source: outcome.source };
  },
  operation: "explain_lookup_evidence",
  project: ({ question, resultJson, source }): EvidenceProjection[] | null => {
    const projections = scoutingEvidenceProjections(
      resultJson,
      question,
      source
    );

    if (projections === null) {
      return null;
    }

    return projections.map((projectionJson) => {
      const projection = evidenceBatchProjectionSchema.parse(
        JSON.parse(projectionJson)
      );

      return {
        projectionJson,
        recordRefs: projection.batch.recordRefs,
      };
    });
  },
  questionMessage: (question, projectionJson) =>
    `用户问题：${question}\n\nScouting evidence projection JSON:\n${projectionJson}`,
  setEvidence: (lookupEvidence) => ({ lookupEvidence }),
  systemPrompt: lookupEvidencePrompt,
};

const lookupEvidenceNodes = createEvidenceBatchNodes(lookupEvidenceWorkflow);

const createPrepareLookupEvidenceNode = (
  configuration: Pick<LookupEvidenceNodeConfiguration, "allowance">
): GraphNode<typeof AgentState> =>
  lookupEvidenceNodes.createPrepareNode(configuration);

const createAnswerLookupEvidenceBatchNode = (
  configuration: LookupEvidenceNodeConfiguration
): GraphNode<typeof AgentState> =>
  lookupEvidenceNodes.createAnswerNode(configuration);

const lookupEvidenceMatchesCurrentOutcome = (state: AgentStateType): boolean =>
  lookupEvidenceNodes.matchesCurrentOutcome(state);

const lookupEvidenceRoute = (state: AgentStateType): string =>
  lookupEvidenceNodes.route(state) ? "answer_lookup_evidence_batch" : "answer";

export {
  createAnswerLookupEvidenceBatchNode,
  createPrepareLookupEvidenceNode,
  lookupEvidenceMatchesCurrentOutcome,
  lookupEvidenceRoute,
};
