import { AIMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { createInitialRequestState } from "../state.js";
import type { AgentState } from "../state.js";

const resumeValueSchema = z.union([
  z.string().transform((answer) => ({ answer })),
  z
    .looseObject({
      answer: z.string().optional(),
      candidateId: z.string().optional(),
      text: z.string().optional(),
    })
    .transform(({ answer, candidateId, text }) => ({
      answer: answer ?? text ?? candidateId ?? null,
    })),
]);

const createIdentityClarificationNode =
  (): GraphNode<typeof AgentState> => (state) => {
    const request = state.request ?? createInitialRequestState();
    const index = request.activePlayerIndex;
    const player = index === null ? null : (request.players[index] ?? null);
    const resolution = player?.resolution ?? null;

    const candidates =
      resolution?.candidates.map((candidate, candidateIndex) => ({
        identityLinked: candidate.identityVerified,
        name: candidate.name,
        number: candidateIndex + 1,
        records: candidate.records.map((record) => ({
          competition: record.competition,
          season: record.season,
          source: record.provider,
          team: record.team,
        })),
        sources: [
          ...new Set(candidate.records.map((record) => record.provider)),
        ],
      })) ?? [];

    const mention = player?.mention ?? "这位球员";

    const question =
      request.clarificationMessage ??
      (candidates.length
        ? `“${mention}”可能对应多个身份。请回复候选编号或完整姓名。`
        : `我无法确认“${mention}”指哪位球员。请提供完整姓名或球队线索。`);

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
