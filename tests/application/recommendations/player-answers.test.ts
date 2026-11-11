import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { END, START, StateGraph } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import { createAnswerNode } from "../../../src/nodes/assistant.js";
import type { ReferenceIdentityLookup } from "../../../src/player-data/resolve-reference.js";
import { AgentState } from "../../../src/state.js";
import type { RecommendPlayerCandidates } from "../../../src/tools/recommend-player-candidates.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";
import { testModelContextConfiguration } from "../../fixtures/model-context.js";
import {
  recommendationResult,
  recommendationResultData,
} from "../../fixtures/workflow-results.js";

describe("player recommendation answers", () => {
  it("retains a completed player recommendation when its final explanation fails", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const message = "Find striker alternatives to Kane.";
    const recommendation = recommendationResult("ready");
    const recommend = vi.fn<RecommendPlayerCandidates>(() => recommendation);

    const model = fakeModel()
      .respond(
        Object.assign(new Error("temporary network failure"), {
          code: "ECONNRESET",
        })
      )
      .respond(
        Object.assign(new Error("temporary network failure"), {
          code: "ECONNRESET",
        })
      )
      .respond(
        Object.assign(new Error("temporary network failure"), {
          code: "ECONNRESET",
        })
      );

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers(
          "player_recommendation",
          ["Kane"],
          {
            recommendation: { includePotential: false, position: "stc" },
          }
        ),
      }),
      tools: agentGraphTest.createTools(agentGraphTest.emptySearch, recommend),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "recommendation-explanation-outage" } }
    );

    expect({
      activeRecommendation:
        result.conversationContext.activeRecommendation?.status,
      answer: result.messages.at(-1)?.content,
      outcome: result.outcome?.status,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      activeRecommendation: "ready",
      answer:
        "数据查询或计算已经完成，但模型暂时无法生成解释。已完成的结构化结果仍保留，可以继续追问。",
      outcome: "ready",
      recommendationCalls: 1,
    });
  });

  it("explains a saved player recommendation without rerunning identity or data tools", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const firstMessage = "Find striker alternatives to Kane.";
    const explainMessage = "Explain the previous player recommendation.";

    const wrongTargetMessage =
      "Explain the previous player recommendation for Kylian Mbappé.";

    const recommendation = recommendationResult("no_candidates");
    const recommend = vi.fn<RecommendPlayerCandidates>(() => recommendation);

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      agentGraphTest.resolvedLookup(kane)
    );

    const model = fakeModel()
      .respond(new AIMessage("No candidates were returned."))
      .respond(new AIMessage("The saved result contains no candidates."));

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [explainMessage]: {
          constraints: [],
          continuationAction: "explain",
          kind: "player_recommendation",
          players: [],
          teams: [],
        },
        [firstMessage]: agentGraphTest.requestForPlayers(
          "player_recommendation",
          ["Kane"],
          {
            recommendation: { position: "stc" },
          }
        ),
        [wrongTargetMessage]: agentGraphTest.requestForPlayers(
          "player_recommendation",
          ["Kylian Mbappé"],
          { continuationAction: "explain" }
        ),
      }),
      tools: agentGraphTest.createTools(agentGraphTest.emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "saved-recommendation-explanation" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const explained = await graph.invoke(
      { messages: [new HumanMessage(explainMessage)] },
      config
    );

    const unrelatedExplanation = await graph.invoke(
      { messages: [new HumanMessage(wrongTargetMessage)] },
      config
    );

    const { outcome } = explained;

    expect({
      answer: explained.messages.at(-1)?.content,
      identityLookups: identityLookup.mock.calls.length,
      outcomeSource:
        outcome !== null && outcome !== undefined && "source" in outcome
          ? outcome.source
          : null,
      outcomeStatus: outcome?.status,
      recommendationCalls: recommend.mock.calls.length,
      repeatedIdentityLookups: identityLookup.mock.calls.length,
      unrelatedAnswer: unrelatedExplanation.messages.at(-1)?.content,
      unrelatedOutcome: unrelatedExplanation.outcome?.status,
    }).toStrictEqual({
      answer: "The saved result contains no candidates.",
      identityLookups: 1,
      outcomeSource: "saved",
      outcomeStatus: "no_candidates",
      recommendationCalls: 1,
      repeatedIdentityLookups: 1,
      unrelatedAnswer:
        "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。",
      unrelatedOutcome: "saved_result_unavailable",
    });
  });

  it("instructs recommendation answers to include every candidate's CA and PA", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");

    const message =
      "Find high-potential striker alternatives to Kane aged 21 or younger.";

    const defaults = recommendationResultData("ready", "stc", {
      filters: {
        includePotential: true,
        maxAge: 21,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        resultLimit: 5,
      },
    });

    const recommendation = JSON.stringify({
      ...defaults,
      currentCandidates: [
        {
          age: 21,
          attributes: [],
          currentAbility: 146,
          currentDistance: 0.47,
          fmId: "fm-close-01",
          name: "Synthetic Close Candidate",
          positionRating: 20,
          potentialAbility: 181,
          rank: 1,
          sourceRecordId: "fm-close-record-01",
        },
        {
          age: 18,
          attributes: [],
          currentAbility: 124,
          currentDistance: 2.71,
          fmId: "fm-future-01",
          name: "Synthetic Future Prospect",
          positionRating: 19,
          potentialAbility: 195,
          rank: 2,
          sourceRecordId: "fm-future-record-01",
        },
      ],
      filterCounts: {
        ...defaults.filterCounts,
        excludedMissingPotentialForPotentialList: 1,
      },
      potentialCandidates: [
        {
          age: 19,
          attributes: [],
          currentAbility: 121,
          currentDistance: 3.42,
          fmId: "fm-high-pa-01",
          name: "Synthetic High Potential Candidate",
          positionRating: 18,
          potentialAbility: 199,
          rank: 1,
          sourceRecordId: "fm-high-pa-record-01",
        },
      ],
      references: [
        {
          currentAbility: 150,
          fmId: "fm-ref-01",
          name: "Synthetic Reference",
          positionRating: 20,
          potentialAbility: 178,
          sourceRecordId: "fm-ref-record-01",
        },
      ],
    });

    const model = fakeModel().respond(
      new AIMessage("The candidate list is ready.")
    );

    const modelInvoke = vi.spyOn(model, "invoke");

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers(
          "player_recommendation",
          ["Kane"],
          {
            recommendation: {
              includePotential: true,
              maxAge: 21,
              position: "stc",
            },
          }
        ),
      }),
      tools: agentGraphTest.createTools(
        agentGraphTest.emptySearch,
        () => recommendation
      ),
    });

    await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "recommendation-answer-completeness" } }
    );

    const modelInput = JSON.stringify(modelInvoke.mock.calls.at(-1)?.[0]);

    const filterStagesFullyDefined = [
      "afterPotentialAbility 是再应用 PA 条件后的数量",
      "afterIdentityExclusion 是应用请求中的身份排除规则后剩余的数量",
      "currentAttributeComplete 是身份排除后属性完整、能计算 currentDistance 的数量",
      "除非工具列出具体对象，否则不要推断具体排除了谁或属于哪类身份",
      "名单长度不等于任何阶段数量",
      "球员推荐只能从 filters.resultLimit 读取名单上限",
      "resultLimit 分别限制 currentCandidates 和 potentialCandidates 各自的名单数",
      "resultLimit 为 1 时，两份名单可以各返回 1 名球员",
      "不得从名单长度或 afterIdentityExclusion 推断上限",
    ].every((promptRule) => modelInput.includes(promptRule));

    expect({
      allCurrentCandidates: modelInput.includes(
        "逐条列出 currentCandidates 中的每一个候选"
      ),
      allPotentialCandidates: modelInput.includes(
        "高潜名单的每一行也必须包括姓名、FM ID、年龄、位置评分、CA、PA 和 currentDistance"
      ),
      filterStagesFullyDefined:
        filterStagesFullyDefined &&
        !modelInput.includes("球队推荐中的队内球员"),
      filteredCounts: modelInput.includes(
        "filterCounts.eligiblePositionProfiles"
      ),
      missingPa: modelInput.includes("potentialAbility 为 null"),
      paContextOnly: modelInput.includes("PA 仅作为资料展示"),
      positionRatingScaleBounded: modelInput.includes(
        "位置评分只报告工具返回的数值"
      ),
      potentialCandidateDataPassed:
        modelInput.includes("Synthetic High Potential Candidate") &&
        modelInput.includes("199") &&
        modelInput.includes("3.42"),
      zeroPositionProfilesOnlyWhenCountIsZero: modelInput.includes(
        "只有 filterCounts.eligiblePositionProfiles 为 0，才能说没有位置合格画像"
      ),
    }).toStrictEqual({
      allCurrentCandidates: true,
      allPotentialCandidates: true,
      filterStagesFullyDefined: true,
      filteredCounts: true,
      missingPa: true,
      paContextOnly: true,
      positionRatingScaleBounded: true,
      potentialCandidateDataPassed: true,
      zeroPositionProfilesOnlyWhenCountIsZero: true,
    });
  });

  it("uses structured candidates when an answer claims a nonempty current list is empty", async () => {
    const candidate = {
      age: 23,
      attributes: [],
      currentAbility: 135,
      currentDistance: 13.2916,
      fmId: "fm-ansu-fati",
      name: "Ansu Fati",
      positionRating: 17,
      potentialAbility: 175,
      rank: 1,
      sourceRecordId: "fm-ansu-fati-record",
    };

    const recommendation = recommendationResultData("ready", "stc", {
      currentCandidates: [candidate],
      filters: {
        includePotential: true,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: 175,
        resultLimit: 5,
      },
      potentialCandidates: [candidate],
    });

    const state = AgentState.parse({
      messages: [
        new HumanMessage(
          "根据 Synthetic Reference 推荐 PA 至少 175 的 STC 高潜球员。"
        ),
      ],
      outcome: {
        kind: "player_recommendation",
        resultJson: JSON.stringify(recommendation),
        source: "executed",
        status: "ready",
      },
    });

    const graph = new StateGraph(AgentState)
      .addNode(
        "answer",
        createAnswerNode(
          fakeModel().respond(
            new AIMessage(
              "当前能力相似名单为空，因此没有可列出的 currentDistance 排名候选。高潜名单包含 Ansu Fati。"
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

    expect(answer).toContain("Ansu Fati");
    expect(answer).toContain("PA 下限 175");
    expect(answer).toContain("currentDistance 13.2916");
    expect(answer).not.toContain("当前能力相似名单为空");
  });

  it("uses structured filters when an answer claims unset filters were applied", async () => {
    const candidate = {
      age: 24,
      attributes: [],
      currentAbility: 140,
      currentDistance: 0.5,
      fmId: "fm-filter-candidate",
      name: "Filter Candidate",
      positionRating: 20,
      potentialAbility: 160,
      rank: 1,
      sourceRecordId: "fm-filter-candidate-record",
    };

    const recommendation = recommendationResultData("ready", "stc", {
      currentCandidates: [candidate],
      filterCounts: {
        afterAge: 5,
        afterCurrentAbility: 5,
        afterIdentityExclusion: 5,
        afterPotentialAbility: 5,
        currentAttributeComplete: 5,
        eligiblePositionProfiles: 5,
        excludedMissingAttribute: 0,
        excludedMissingFmIdCandidates: 0,
        excludedMissingPotentialForPotentialList: 0,
      },
      filters: {
        includePotential: false,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        resultLimit: 5,
      },
    });

    const state = AgentState.parse({
      messages: [
        new HumanMessage("根据 Synthetic Reference 推荐 STC 位置相似球员。"),
      ],
      outcome: {
        kind: "player_recommendation",
        resultJson: JSON.stringify(recommendation),
        source: "executed",
        status: "ready",
      },
    });

    const graph = new StateGraph(AgentState)
      .addNode(
        "answer",
        createAnswerNode(
          fakeModel().respond(
            new AIMessage(
              "应用年龄、CA 和 PA 条件后各阶段均为 5 人；应用身份排除规则后为 3 人。"
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
      ageAsOfDate: answer.includes("年龄按 2026-11-04 计算"),
      caAppliedClaim: answer.includes("应用 CA 条件后"),
      noAgeFilter: answer.includes("年龄限制未设置"),
      noCaFilter: answer.includes("CA 下限未设置"),
      noPaFilter: answer.includes("PA 下限未设置"),
      paAppliedClaim: answer.includes("应用 PA 条件后"),
    }).toStrictEqual({
      ageAppliedClaim: false,
      ageAsOfDate: true,
      caAppliedClaim: false,
      noAgeFilter: true,
      noCaFilter: true,
      noPaFilter: true,
      paAppliedClaim: false,
    });
  });

  it("applies recommendation corrections to content-block model answers", async () => {
    const resultJson = recommendationResult("ready", "stc");

    const state = AgentState.parse({
      messages: [new HumanMessage("Recommend STC players.")],
      outcome: {
        kind: "player_recommendation",
        resultJson,
        source: "executed",
        status: "ready",
      },
    });

    const graph = new StateGraph(AgentState)
      .addNode(
        "answer",
        createAnswerNode(
          fakeModel().respond(
            new AIMessage([{ text: "年龄范围已用于筛选候选。", type: "text" }])
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
      ageAsOfDate: answer.includes("年龄按 2026-11-04 计算"),
      repeatsUnsetFilterClaim: answer.includes("应用年龄、CA 和 PA 条件后"),
      saysNoAgeFilter: answer.includes("年龄限制未设置"),
    }).toStrictEqual({
      ageAsOfDate: true,
      repeatsUnsetFilterClaim: false,
      saysNoAgeFilter: true,
    });
  });

  it("restores reference CA and PA when a recommendation answer omits the reference", async () => {
    const resultJson = JSON.stringify(
      recommendationResultData("ready", "stc", {
        referenceFmIds: ["2000180850"],
        references: [
          {
            currentAbility: 127,
            fmId: "2000180850",
            name: "Mert Kömür",
            positionRating: 16,
            potentialAbility: 150,
            sourceRecordId: "fm-row-mert-komur",
          },
        ],
      })
    );

    const state = AgentState.parse({
      messages: [
        new HumanMessage("Based on Mert Kömür, recommend STC prospects."),
      ],
      outcome: {
        kind: "player_recommendation",
        resultJson,
        source: "executed",
        status: "ready",
      },
    });

    const graph = new StateGraph(AgentState)
      .addNode(
        "answer",
        createAnswerNode(
          fakeModel().respond(
            new AIMessage(
              "## Current ability similarity candidates\n\nTest Candidate, CA 140, PA 160."
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

    expect(answer).toContain("- Mert Kömür (FM ID 2000180850; CA 127; PA 150)");
  });
});
