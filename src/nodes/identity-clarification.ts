import { AIMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { createInitialRequestState } from "../state.js";
import type { AgentState, RequestState } from "../state.js";

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

const candidateQuestion = (
  request: RequestState,
  candidates: { identityBasis: string }[],
  mention: string
): string => {
  if (request.clarificationMessage !== null) {
    return request.clarificationMessage;
  }

  if (
    candidates.some(
      (candidate) => candidate.identityBasis === "thread_candidate"
    )
  ) {
    return `“${mention}”有跨来源的待确认候选组。选择候选组会仅在当前 thread 将其中记录视为同一人；若只选一个来源，请说明 FM only 或 Understat only。`;
  }

  if (candidates.length > 0) {
    return `“${mention}”可能对应多个球员。请回复候选编号或完整姓名；同名时请补充球队、赛事或赛季。`;
  }

  return `我无法确认“${mention}”指哪位球员。请提供完整姓名或球队线索。`;
};

const createIdentityClarificationNode =
  (): GraphNode<typeof AgentState> => (state) => {
    const request = state.request ?? createInitialRequestState();
    const index = request.activePlayerIndex;
    const player = index === null ? null : (request.players[index] ?? null);
    const resolution = player?.resolution ?? null;

    const candidates =
      resolution === null
        ? []
        : resolution.candidates.map((candidate, candidateIndex) => ({
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
            sources: [
              ...new Set(candidate.records.map((record) => record.provider)),
            ],
          }));

    const mention = player?.mention ?? "这位球员";
    const question = candidateQuestion(request, candidates, mention);

    const resumeValue = resumeValueSchema.safeParse(
      interrupt({
        candidates,
        kind: "player_identity_confirmation",
        mention,
        playerIndex: index,
        question,
        requestKind: request.kind,
      })
    );

    return {
      requestAnswer: resumeValue.success ? resumeValue.data.answer : null,
    };
  };

const createUnresolvedRequestNode =
  (): GraphNode<typeof AgentState> => (state) => ({
    messages: [
      new AIMessage(
        (state.request ?? createInitialRequestState()).clarificationMessage ??
          "我仍无法确认目标球员，请提供完整姓名后再继续。"
      ),
    ],
  });

export { createIdentityClarificationNode, createUnresolvedRequestNode };
