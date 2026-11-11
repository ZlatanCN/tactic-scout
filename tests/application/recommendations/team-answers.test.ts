import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { END, START, StateGraph } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { z } from "zod/v3";

import { createAnswerNode } from "../../../src/nodes/assistant.js";
import { AgentState } from "../../../src/state.js";
import type { RecommendTeamPlayerCandidatesInput } from "../../../src/tools/recommend-team-player-candidates.js";
import {
  testModelContextConfiguration,
  testModelWithDeterministicTokenCount,
} from "../../fixtures/model-context.js";
import { teamRecommendationResult } from "../../fixtures/workflow-results.js";

describe("team recommendation answer corrections", () => {
  it("corrects team answers that claim null filters were applied", async () => {
    const team = { country: "England", id: 42, name: "Arsenal" };

    const input: RecommendTeamPlayerCandidatesInput = {
      includePotential: false,
      maxAge: null,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: "stc",
      referenceFmIds: ["team-reference"],
      referenceMode: "squad",
      resultLimit: 5,
      roster: {
        members: [],
        retrievedAt: "2026-11-03T00:00:00.000Z",
        team,
      },
      team,
    };

    const resultJson = teamRecommendationResult("ready", input, {
      currentCandidates: [
        {
          age: 24,
          attributes: [],
          currentAbility: 140,
          currentDistance: 0.5,
          fmId: "team-candidate",
          name: "Team Candidate",
          positionRating: 20,
          potentialAbility: 160,
          rank: 1,
          sourceRecordId: "team-candidate-record",
        },
      ],
    });

    const state = AgentState.parse({
      messages: [new HumanMessage("为 Arsenal 推荐 stc 球员。")],
      outcome: {
        kind: "team_recommendation",
        resultJson,
        source: "executed",
        status: "ready",
      },
    });

    const graph = new StateGraph(AgentState)
      .addNode(
        "answer",
        createAnswerNode(
          testModelWithDeterministicTokenCount(
            fakeModel().respond(
              new AIMessage(
                "应用年龄条件后有 5 个，应用 CA 条件后有 5 个，应用 PA 条件后有 5 个。"
              )
            )
          ),
          testModelContextConfiguration
        )
      )
      .addEdge(START, "answer")
      .addEdge("answer", END)
      .compile();

    const result = await graph.invoke(state);
    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      ageAppliedClaim: answer.includes("应用年龄条件后"),
      caAppliedClaim: answer.includes("应用 CA 条件后"),
      candidate: answer.includes("Team Candidate"),
      noAgeFilter: answer.includes("年龄限制未设置"),
      noCaFilter: answer.includes("CA 下限未设置"),
      noPaFilter: answer.includes("PA 下限未设置"),
      paAppliedClaim: answer.includes("应用 PA 条件后"),
    }).toStrictEqual({
      ageAppliedClaim: false,
      caAppliedClaim: false,
      candidate: true,
      noAgeFilter: true,
      noCaFilter: true,
      noPaFilter: true,
      paAppliedClaim: false,
    });
  });

  it.each([
    "工具未提供团队参考画像的成员筛选标准或计算方法。",
    "工具未提供这些参考对象的筛选标准或计算方法。",
  ])(
    "corrects team answers that deny the provided basis: %s",
    async (falseBasisClaim) => {
      const team = { country: "Testland", id: 901, name: "Synthetic Town FC" };

      const input: RecommendTeamPlayerCandidatesInput = {
        includePotential: false,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceFmIds: [],
        referenceMode: "squad",
        resultLimit: 5,
        roster: {
          members: [],
          retrievedAt: "2025-11-20T12:00:00.000Z",
          team,
        },
        team,
      };

      const resultJson = teamRecommendationResult("ready", input);

      const state = AgentState.parse({
        messages: [new HumanMessage("为 Synthetic Town FC 推荐 stc 球员。")],
        outcome: {
          kind: "team_recommendation",
          resultJson,
          source: "executed",
          status: "ready",
        },
      });

      const graph = new StateGraph(AgentState)
        .addNode(
          "answer",
          createAnswerNode(
            testModelWithDeterministicTokenCount(
              fakeModel().respond(
                new AIMessage([
                  {
                    text: falseBasisClaim,
                    type: "text",
                  },
                ])
              )
            ),
            testModelContextConfiguration
          )
        )
        .addEdge(START, "answer")
        .addEdge("answer", END)
        .compile();

      const result = await graph.invoke(state);
      const answer = z.string().parse(result.messages.at(-1)?.content);

      expect({
        hasGroundedBasis: answer.includes(
          "参考画像计算方式：选取目标位置评分至少 15 且该位置所需属性完整的队内 FM 画像，对该位置所需属性取等权平均。"
        ),
        repeatsMissingBasisClaim: answer.includes("未在结果中说明"),
      }).toStrictEqual({
        hasGroundedBasis: true,
        repeatsMissingBasisClaim: false,
      });
    }
  );

  it("names reference profiles when an answer claims no exclusion identities were returned", async () => {
    const team = { country: "England", id: 42, name: "Arsenal" };

    const input: RecommendTeamPlayerCandidatesInput = {
      includePotential: false,
      maxAge: null,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: "stc",
      referenceFmIds: ["team-reference"],
      referenceMode: "squad",
      resultLimit: 5,
      roster: {
        members: [],
        retrievedAt: "2026-11-03T00:00:00.000Z",
        team,
      },
      team,
    };

    const candidate = {
      age: 24,
      attributes: [],
      currentAbility: 140,
      currentDistance: 0.5,
      fmId: "team-candidate",
      name: "Team Candidate",
      positionRating: 20,
      potentialAbility: 160,
      rank: 1,
      sourceRecordId: "team-candidate-record",
    };

    const reference = {
      currentAbility: 150,
      fmId: "team-reference",
      name: "Team Reference",
      positionRating: 20,
      potentialAbility: 180,
      sourceRecordId: "team-reference-record",
    };

    const resultJson = teamRecommendationResult("ready", input, {
      currentCandidates: [candidate],
      referenceFmIds: [reference.fmId],
      references: [reference],
    });

    const state = AgentState.parse({
      messages: [new HumanMessage("为 Arsenal 推荐 stc 球员。")],
      outcome: {
        kind: "team_recommendation",
        resultJson,
        source: "executed",
        status: "ready",
      },
    });

    const graph = new StateGraph(AgentState)
      .addNode(
        "answer",
        createAnswerNode(
          testModelWithDeterministicTokenCount(
            fakeModel().respond(
              new AIMessage("工具未提供身份排除的具体对象，无法判断排除了谁。")
            )
          ),
          testModelContextConfiguration
        )
      )
      .addEdge(START, "answer")
      .addEdge("answer", END)
      .compile();

    const result = await graph.invoke(state);
    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      listsReference: answer.includes("Team Reference"),
      namesExclusion: answer.includes("从候选中排除"),
      repeatsUnsupportedClaim: answer.includes("工具未提供身份排除的具体对象"),
    }).toStrictEqual({
      listsReference: true,
      namesExclusion: true,
      repeatsUnsupportedClaim: false,
    });
  });
});
