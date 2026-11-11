import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import type { TeamIdentity } from "../../../src/team-data/contracts.js";
import type { RecommendTeamPlayerCandidates } from "../../../src/tools/recommend-team-player-candidates.js";
import { teamRecommendationTest } from "../../fixtures/team-recommendation.js";

describe("team selection and roster acquisition", () => {
  it("resolves a unique team, maps its roster, and commits the ranked result", async () => {
    const message = "Recommend a striker for Arsenal.";

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: 1001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("ready", input, {
        currentCandidates: [
          {
            age: 24,
            attributes: [],
            currentAbility: 140,
            currentDistance: 0.5,
            fmId: "candidate-1",
            name: "Candidate One",
            positionRating: 18,
            potentialAbility: 160,
            rank: 1,
            sourceRecordId: "candidate-record-1",
          },
        ],
      })
    );

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [message]: teamRecommendationTest.teamRequest("Arsenal", "stc", {
          position: "stc",
        }),
      }),
      recommend,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-recommendation-unique" } }
    );

    expect({
      getSquadCalls: directory.getSquad.mock.calls.map(([teamId]) => [teamId]),
      input: recommend.mock.calls[0]?.[0],
      searchCalls: directory.searchTeams.mock.calls.map(([query]) => [query]),
      storedTeam: result.conversationContext.activeTeamRecommendation?.team,
    }).toMatchObject({
      getSquadCalls: [[42]],
      input: {
        position: "stc",
        referenceFmIds: [],
        referenceMode: "squad",
        roster: {
          members: [
            {
              fmId: "fm-1001",
              mappingMethod: "reep_bridge",
              mappingStatus: "resolved",
            },
          ],
        },
        team: teamRecommendationTest.arsenal,
      },
      searchCalls: [["Arsenal"]],
      storedTeam: teamRecommendationTest.arsenal,
    });
    expect(result.messages.at(-1)?.content).toContain(
      "Roster source: API-Football, retrieved "
    );
  });

  it("instructs team recommendation answers to list every candidate with CA and PA", async () => {
    const message = "Recommend young high-potential strikers for Arsenal.";

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: 1001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("ready", input, {
        currentCandidates: [
          {
            age: 18,
            attributes: [],
            currentAbility: 124,
            currentDistance: 2.7,
            fmId: "fm-future-01",
            name: "Synthetic Future Prospect",
            positionRating: 19,
            potentialAbility: 195,
            rank: 1,
            sourceRecordId: "fm-future-record-01",
          },
        ],
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
      })
    );

    const model = fakeModel().respond(
      new AIMessage("The recommendation is ready.")
    );

    const modelInvoke = vi.spyOn(model, "invoke");

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [message]: teamRecommendationTest.teamRequest("Arsenal", "stc", {
          includePotential: true,
        }),
      }),
      model,
      recommend,
    });

    await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-recommendation-answer-completeness" } }
    );

    const modelInput = JSON.stringify(modelInvoke.mock.calls.at(-1)?.[0]);

    expect({
      allCurrentCandidates: modelInput.includes(
        "逐条列出 recommendation.currentCandidates 中的每一名候选"
      ),
      allPotentialCandidates: modelInput.includes(
        "高潜名单的每一行也必须包括姓名、FM ID、年龄、位置评分、CA、PA 和 currentDistance"
      ),
      explicitRankingBasisInstruction: modelInput.includes(
        "必须读取顶层 rankingBasis 并说明对应计算方式"
      ),
      includesOverlySpecificExample: modelInput.includes(
        "团队参考画像是位置评分至少 15 且特征完整的队内球员属性等权平均"
      ),
      missingPa: modelInput.includes("potentialAbility 为 null"),
      noPositionEligibleOnlyWhenZero: modelInput.includes(
        "只有 recommendation.filterCounts.eligiblePositionProfiles 为 0，才能说没有位置合格画像"
      ),
      paContextOnly: modelInput.includes("PA 仅作为资料展示"),
      positionRatingScaleBounded: modelInput.includes(
        "位置评分只报告工具返回的数值"
      ),
      potentialCandidateDataPassed:
        modelInput.includes("Synthetic High Potential Candidate") &&
        modelInput.includes("199") &&
        modelInput.includes("3.42"),
      rankingBasisDefinition: modelInput.includes(
        "选取目标位置评分至少 15 且该位置所需属性完整的队内 FM 画像，对该位置所需属性取等权平均"
      ),
      referenceMethodGrounded:
        modelInput.includes(
          "不要推断团队参考画像的成员筛选标准或计算方法，除非 recommendation 结果明确提供"
        ) &&
        modelInput.includes("必须读取顶层 rankingBasis 并说明对应计算方式") &&
        !modelInput.includes(
          "团队参考画像是位置评分至少 15 且特征完整的队内球员属性等权平均"
        ),
      tacticalFitCaveat: modelInput.includes(
        "必须说明这些结果只反映 FM 属性画像相似，不代表战术适配或转会可行性"
      ),
    }).toStrictEqual({
      allCurrentCandidates: true,
      allPotentialCandidates: true,
      explicitRankingBasisInstruction: true,
      includesOverlySpecificExample: false,
      missingPa: true,
      noPositionEligibleOnlyWhenZero: true,
      paContextOnly: true,
      positionRatingScaleBounded: true,
      potentialCandidateDataPassed: true,
      rankingBasisDefinition: true,
      referenceMethodGrounded: true,
      tacticalFitCaveat: true,
    });
  });

  it("asks for a position before acquiring a team roster", async () => {
    const message = "Recommend a player for Arsenal.";

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: 1001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("ready", input)
    );

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [message]: teamRecommendationTest.teamRequest("Arsenal", null),
      }),
      recommend,
    });

    const config = { configurable: { thread_id: "team-position-required" } };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      config
    );

    const completed = await graph.invoke(
      new Command({ resume: "stc" }),
      config
    );

    expect({
      completedTeam:
        completed.conversationContext.activeTeamRecommendation?.team,
      getSquadCalls: directory.getSquad.mock.calls.map(([teamId]) => [teamId]),
      recommendationCalls: recommend.mock.calls.length,
      resumedWithPosition:
        completed.conversationContext.activeTeamRecommendation?.position,
      wasInterrupted: Object.hasOwn(interrupted, "__interrupt__"),
    }).toStrictEqual({
      completedTeam: teamRecommendationTest.arsenal,
      getSquadCalls: [[42]],
      recommendationCalls: 1,
      resumedWithPosition: "stc",
      wasInterrupted: true,
    });
  });

  it("fails safely when structured extraction omits the explicit team", async () => {
    const message = "为 Real Madrid 继续推荐 stc 球员，CA 下限 150。";

    const realMadrid: TeamIdentity = {
      country: "Spain",
      id: 541,
      name: "Real Madrid",
    };

    const directory = teamRecommendationTest.createDirectory(
      [realMadrid],
      [{ id: 730, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("ready", input)
    );

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [message]: teamRecommendationTest.teamRequest(null, "stc", {
          minimumCurrentAbility: 150,
        }),
      }),
      recommend,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-explicit-mention-not-extracted" } }
    );

    expect({
      outcomeStatus: result.outcome?.status,
      searchedTeams: directory.searchTeams.mock.calls.map(([query]) => query),
    }).toStrictEqual({
      outcomeStatus: "team_required",
      searchedTeams: [],
    });
  });

  it("searches the team when structured extraction includes the explicit mention", async () => {
    const message = "为 Real Madrid 继续推荐 stc 球员，CA 下限 150。";

    const realMadrid: TeamIdentity = {
      country: "Spain",
      id: 541,
      name: "Real Madrid",
    };

    const directory = teamRecommendationTest.createDirectory(
      [realMadrid],
      [{ id: 730, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("ready", input)
    );

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [message]: teamRecommendationTest.teamRequest(
          "Real Madrid",
          "stc",
          { minimumCurrentAbility: 150 },
          "Real Madrid"
        ),
      }),
      recommend,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-explicit-mention-extracted" } }
    );

    expect({
      outcomeStatus: result.outcome?.status ?? null,
      searchedTeams: directory.searchTeams.mock.calls.map(([query]) => query),
    }).toStrictEqual({
      outcomeStatus: "ready",
      searchedTeams: ["Real Madrid"],
    });
  });

  it("stops safely when the provider returns an empty squad", async () => {
    const message = "Recommend a striker for Arsenal.";

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      []
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("ready", input)
    );

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [message]: teamRecommendationTest.teamRequest("Arsenal", "stc", {
          position: "stc",
        }),
      }),
      recommend,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-empty-roster" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      outcomeStatus: result.outcome?.status,
      recommendationCalls: recommend.mock.calls.length,
      squadCalls: directory.getSquad.mock.calls.map(([teamId]) => [teamId]),
    }).toStrictEqual({
      answer: "API-Football 没有返回这支球队的当前阵容，本次无法生成推荐。",
      outcomeStatus: "team_roster_empty",
      recommendationCalls: 0,
      squadCalls: [[42]],
    });
  });
});
