import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import {
  agentStateSchemaVersion,
  createInitialConversationContext,
} from "../../../src/state.js";
import type { TeamIdentity } from "../../../src/team-data/contracts.js";
import type { RecommendTeamPlayerCandidates } from "../../../src/tools/recommend-team-player-candidates.js";
import { teamRecommendationTest } from "../../fixtures/team-recommendation.js";

describe("team recommendation context refinements", () => {
  it("inherits filters, preserves the last success on failure, and clears explicit nulls", async () => {
    const firstMessage = "Recommend a striker for Arsenal under 25.";
    const failedRefinement = "Make the age limit 22.";
    const successfulRefinement = "Require CA of at least 130.";
    const clearAge = "Remove the age limit.";

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: 4001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi
      .fn<RecommendTeamPlayerCandidates>()
      .mockImplementationOnce((input) =>
        teamRecommendationTest.teamRecommendationResult("ready", input, {
          currentCandidates: [
            {
              age: 24,
              attributes: [],
              currentAbility: 140,
              currentDistance: 1,
              fmId: "fixture-result-1",
              name: "First result marker",
              positionRating: 20,
              potentialAbility: 150,
              rank: 1,
              sourceRecordId: "fixture-result-record-1",
            },
          ],
        })
      )
      .mockImplementationOnce((input) =>
        teamRecommendationTest.teamRecommendationFailureResult(input)
      )
      .mockImplementationOnce((input) =>
        teamRecommendationTest.teamRecommendationResult("ready", input)
      )
      .mockImplementationOnce((input) =>
        teamRecommendationTest.teamRecommendationResult("ready", input)
      );

    const model = fakeModel()
      .respond(new AIMessage("First team list."))
      .respond(new AIMessage("Updated team list."))
      .respond(new AIMessage("Age filter cleared."));

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [clearAge]: teamRecommendationTest.teamRequest(null, null, {
          maxAge: null,
        }),
        [failedRefinement]: teamRecommendationTest.teamRequest(null, null, {
          maxAge: 22,
        }),
        [firstMessage]: teamRecommendationTest.teamRequest("Arsenal", "stc", {
          maxAge: 25,
        }),
        [successfulRefinement]: teamRecommendationTest.teamRequest(null, null, {
          minimumCurrentAbility: 130,
        }),
      }),
      model,
      recommend,
    });

    const config = {
      configurable: { thread_id: "team-recommendation-refinement" },
    };

    const first = await graph.invoke(
      { messages: [new HumanMessage(firstMessage)] },
      config
    );

    const failed = await graph.invoke(
      { messages: [new HumanMessage(failedRefinement)] },
      config
    );

    const refined = await graph.invoke(
      { messages: [new HumanMessage(successfulRefinement)] },
      config
    );

    const cleared = await graph.invoke(
      { messages: [new HumanMessage(clearAge)] },
      config
    );

    expect({
      activeAfterClear: cleared.conversationContext.activeTeamRecommendation,
      activeAfterFailure: failed.conversationContext.activeTeamRecommendation,
      activeAfterRefinement:
        refined.conversationContext.activeTeamRecommendation,
      filterInputs: recommend.mock.calls.map(([input]) => ({
        maxAge: input.maxAge,
        minimumCurrentAbility: input.minimumCurrentAbility,
      })),
      providerCalls: [
        directory.searchTeams.mock.calls.length,
        directory.getSquad.mock.calls.length,
      ],
    }).toMatchObject({
      activeAfterClear: {
        maxAge: null,
        minimumCurrentAbility: 130,
        status: "ready",
      },
      activeAfterFailure: { maxAge: 25, status: "ready" },
      activeAfterRefinement: {
        maxAge: 25,
        minimumCurrentAbility: 130,
        status: "ready",
      },
      filterInputs: [
        { maxAge: 25, minimumCurrentAbility: null },
        { maxAge: 22, minimumCurrentAbility: null },
        { maxAge: 25, minimumCurrentAbility: 130 },
        { maxAge: null, minimumCurrentAbility: 130 },
      ],
      providerCalls: [1, 1],
    });
    expect(
      first.conversationContext.activeTeamRecommendation?.resultJson
    ).toContain('"name":"First result marker"');
    expect(failed.messages.at(-1)?.content).toContain(
      "目前无法从本地数据中取得完成这次请求所需的信息"
    );
  });

  it("inherits saved filters when the same team is explicitly named during refinement", async () => {
    const firstMessage = "Recommend a striker for Arsenal under 25.";
    const refinementMessage = "为 Arsenal 继续推荐 stc 球员，CA 下限 130。";

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: 4101, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("ready", input)
    );

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [firstMessage]: teamRecommendationTest.teamRequest(
          "Arsenal",
          "stc",
          { maxAge: 25 },
          "Arsenal"
        ),
        [refinementMessage]: {
          ...teamRecommendationTest.teamRequest(
            "Arsenal",
            "stc",
            { minimumCurrentAbility: 130 },
            "Arsenal"
          ),
          continuationAction: "refine",
        },
      }),
      model: fakeModel()
        .respond(new AIMessage("First team list."))
        .respond(new AIMessage("Refined team list.")),
      recommend,
    });

    const config = {
      configurable: { thread_id: "team-explicit-same-team-refinement" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const refined = await graph.invoke(
      { messages: [new HumanMessage(refinementMessage)] },
      config
    );

    if (refined.request.kind !== "team_recommendation") {
      throw new Error("Expected a team refinement request.");
    }

    expect({
      action: refined.request.teamRecommendationAction,
      filters: recommend.mock.calls.map(([input]) => ({
        maxAge: input.maxAge,
        minimumCurrentAbility: input.minimumCurrentAbility,
      })),
      getSquadCalls: directory.getSquad.mock.calls.length,
      searchCalls: directory.searchTeams.mock.calls.length,
    }).toStrictEqual({
      action: "refine",
      filters: [
        { maxAge: 25, minimumCurrentAbility: null },
        { maxAge: 25, minimumCurrentAbility: 130 },
      ],
      getSquadCalls: 1,
      searchCalls: 1,
    });
  });

  it("resets filters and roster when the scout names another team", async () => {
    const firstMessage = "Recommend a striker for Arsenal under 25.";
    const replacementMessage = "Switch the team to Chelsea and find a striker.";

    const chelsea: TeamIdentity = {
      country: "England",
      id: 50,
      name: "Chelsea",
    };

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: 5001, name: "Arsenal Player", position: "Attacker" }]
    );

    const recommend = vi
      .fn<RecommendTeamPlayerCandidates>()
      .mockImplementation((input) =>
        teamRecommendationTest.teamRecommendationResult("ready", input)
      );

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [firstMessage]: teamRecommendationTest.teamRequest("Arsenal", "stc", {
          maxAge: 25,
        }),
        [replacementMessage]: teamRecommendationTest.teamRequest(
          "Chelsea",
          "stc"
        ),
      }),
      model: fakeModel()
        .respond(new AIMessage("Arsenal list."))
        .respond(new AIMessage("Chelsea list.")),
      recommend,
    });

    const config = {
      configurable: { thread_id: "team-replacement" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);
    directory.searchTeams.mockResolvedValueOnce({
      data: [chelsea],
      status: "ok",
    });
    directory.getSquad.mockResolvedValueOnce({
      data: {
        players: [{ id: 5002, name: "Chelsea Player", position: "Attacker" }],
        retrievedAt: "2026-10-26T11:00:00.000Z",
        team: chelsea,
      },
      status: "ok",
    });

    const replaced = await graph.invoke(
      { messages: [new HumanMessage(replacementMessage)] },
      config
    );

    expect({
      input: recommend.mock.calls[1]?.[0],
      searchCalls: directory.searchTeams.mock.calls.map(([query]) => [query]),
      squadCalls: directory.getSquad.mock.calls.map(([teamId]) => [teamId]),
      team: replaced.conversationContext.activeTeamRecommendation?.team,
    }).toMatchObject({
      input: {
        maxAge: null,
        roster: {
          members: [{ apiFootballPlayerId: 5002, fmId: "fm-5002" }],
        },
        team: chelsea,
      },
      searchCalls: [["Arsenal"], ["Chelsea"]],
      squadCalls: [[42], [50]],
      team: chelsea,
    });
  });

  it("uses a named FM profile when the team has no usable profile at that position", async () => {
    const message = "Recommend a striker for Arsenal.";

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: 6001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi
      .fn<RecommendTeamPlayerCandidates>()
      .mockImplementationOnce((input) =>
        teamRecommendationTest.teamPositionUnavailableResult(input)
      )
      .mockImplementationOnce((input) =>
        teamRecommendationTest.teamRecommendationResult("ready", input)
      );

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [message]: teamRecommendationTest.teamRequest("Arsenal", "stc"),
      }),
      model: fakeModel().respond(new AIMessage("Named reference list.")),
      playerIdentityLookup: teamRecommendationTest.resolvedKane,
      recommend,
    });

    const config = {
      configurable: { thread_id: "team-named-reference" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      config
    );

    const completed = await graph.invoke(
      new Command({ resume: "Harry Kane" }),
      config
    );

    expect({
      completed: completed.conversationContext.activeTeamRecommendation,
      inputs: recommend.mock.calls.map(([input]) => ({
        referenceFmIds: input.referenceFmIds,
        referenceMode: input.referenceMode,
      })),
      wasInterrupted: Object.hasOwn(interrupted, "__interrupt__"),
    }).toMatchObject({
      completed: {
        referenceMode: "named",
        referencePlayers: [{ referenceId: "source:fm:kane-fm" }],
      },
      inputs: [
        { referenceFmIds: [], referenceMode: "squad" },
        { referenceFmIds: ["kane-fm"], referenceMode: "named" },
      ],
      wasInterrupted: true,
    });
  });

  it("does not carry team context into another thread", async () => {
    const firstMessage = "Recommend a striker for Arsenal.";
    const secondMessage = "Show only three players.";

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: 7001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("ready", input)
    );

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [firstMessage]: teamRecommendationTest.teamRequest("Arsenal", "stc"),
        [secondMessage]: teamRecommendationTest.teamRequest(null, null, {
          resultLimit: 3,
        }),
      }),
      model: fakeModel().respond(new AIMessage("Arsenal candidates.")),
      recommend,
    });

    const firstThread = await graph.invoke(
      { messages: [new HumanMessage(firstMessage)] },
      { configurable: { thread_id: "team-context-first-thread" } }
    );

    const secondThread = await graph.invoke(
      { messages: [new HumanMessage(secondMessage)] },
      { configurable: { thread_id: "team-context-second-thread" } }
    );

    expect({
      firstTeam: firstThread.conversationContext.activeTeamRecommendation?.team,
      searchCalls: directory.searchTeams.mock.calls.map(([query]) => [query]),
      secondActiveTeam:
        secondThread.conversationContext.activeTeamRecommendation,
      secondAnswer: secondThread.messages.at(-1)?.content,
      toolCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      firstTeam: teamRecommendationTest.arsenal,
      searchCalls: [["Arsenal"]],
      secondActiveTeam: null,
      secondAnswer: "请告诉我球队名称和目标位置，再开始球队推荐。",
      toolCalls: 1,
    });
  });

  it("preserves a filter patch while asking which of two saved recommendations to refine", async () => {
    const message = "把年龄上限改成 21 岁";
    const otherMessage = "谢谢";
    const explainMessage = "解释上次结果";
    const refineAgainMessage = "年龄上限改到 20 岁";

    const wrongFilterExplainMessage =
      "Explain the previous team recommendation with a 19-year limit.";

    const wrongTeamExplainMessage =
      "Explain the previous team recommendation for Chelsea.";

    const roster = {
      members: [
        {
          apiFootballPlayerId: 1001,
          fmCandidates: [],
          fmId: "fm-1001",
          mappingMethod: "reep_bridge" as const,
          mappingStatus: "resolved" as const,
          name: "Squad Player",
          position: "Attacker",
        },
      ],
      retrievedAt: "2026-10-26T10:00:00.000Z",
      team: teamRecommendationTest.arsenal,
    };

    const teamInput = {
      includePotential: false,
      maxAge: 25,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: "stc",
      referenceFmIds: ["fm-1001"],
      referenceMode: "squad" as const,
      resultLimit: 5,
      roster,
      team: teamRecommendationTest.arsenal,
    };

    const initialContext = createInitialConversationContext();

    const conversationContext = {
      ...initialContext,
      activeRecommendation: {
        excludePlayers: [],
        includePotential: false,
        maxAge: 25,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referencePlayers: [],
        resultJson:
          teamRecommendationTest.recommendationResult("no_candidates"),
        resultLimit: 5,
        status: "no_candidates" as const,
      },
      activeTeamRecommendation: {
        includePotential: false,
        maxAge: 25,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceMode: "squad" as const,
        referencePlayers: [],
        resultJson: teamRecommendationTest.teamRecommendationResult(
          "no_candidates",
          teamInput
        ),
        resultLimit: 5,
        roster,
        status: "no_candidates" as const,
        team: teamRecommendationTest.arsenal,
      },
    };

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("no_candidates", input)
    );

    const model = fakeModel()
      .respond(new AIMessage("Team filters updated."))
      .respond(new AIMessage("This is the saved team recommendation."))
      .respond(new AIMessage("The team filter was updated again."));

    const graph = teamRecommendationTest.createTeamAgent({
      directory: teamRecommendationTest.createDirectory(
        [teamRecommendationTest.arsenal],
        []
      ),
      extractor: teamRecommendationTest.createExtractor({
        [explainMessage]: {
          constraints: [],
          continuationAction: "explain",
          kind: null,
          players: [],
          teams: [],
        },
        [message]: {
          constraints: [],
          continuationAction: "refine",
          kind: null,
          players: [],
          recommendation: { maxAge: 21 },
          teams: [],
        },
        [otherMessage]: {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        },
        [refineAgainMessage]: {
          constraints: [],
          continuationAction: "refine",
          kind: null,
          players: [],
          recommendation: { maxAge: 20 },
          teams: [],
        },
        [wrongFilterExplainMessage]: {
          constraints: [],
          continuationAction: "explain",
          kind: "team_recommendation",
          players: [],
          recommendation: { maxAge: 19 },
          teams: [],
        },
        [wrongTeamExplainMessage]: {
          constraints: [],
          continuationAction: "explain",
          kind: "team_recommendation",
          players: [],
          teamSearchName: "Chelsea",
          teams: ["Chelsea"],
        },
      }),
      model,
      recommend,
    });

    const config = {
      configurable: { thread_id: "workflow-clarification-retains-patch" },
    };

    const interrupted = await graph.invoke(
      {
        conversationContext,
        messages: [new HumanMessage(message)],
        stateSchemaVersion: agentStateSchemaVersion,
      },
      config
    );

    const resumed = await graph.invoke(new Command({ resume: "2" }), config);
    await graph.invoke({ messages: [new HumanMessage(otherMessage)] }, config);

    const explanationInterrupted = await graph.invoke(
      { messages: [new HumanMessage(explainMessage)] },
      config
    );

    const explained = await graph.invoke(new Command({ resume: "2" }), config);

    const refinedAgain = await graph.invoke(
      { messages: [new HumanMessage(refineAgainMessage)] },
      config
    );

    const wrongFilterExplanation = await graph.invoke(
      { messages: [new HumanMessage(wrongFilterExplainMessage)] },
      config
    );

    const wrongTeamExplanation = await graph.invoke(
      { messages: [new HumanMessage(wrongTeamExplainMessage)] },
      config
    );

    expect({
      activePlayerRecommendation:
        resumed.conversationContext.activeRecommendation?.maxAge,
      activeTeamRecommendation:
        resumed.conversationContext.activeTeamRecommendation?.maxAge,
      explanationRequestKind: explained.request.kind,
      explanationSource:
        explained.outcome !== null && "source" in explained.outcome
          ? explained.outcome.source
          : null,
      explanationWasInterrupted: Object.hasOwn(
        explanationInterrupted,
        "__interrupt__"
      ),
      nextRefinementAge:
        refinedAgain.conversationContext.activeTeamRecommendation?.maxAge,
      nextRefinementRequestKind: refinedAgain.request.kind,
      recommendationCalls: recommend.mock.calls.length,
      selectedTeam: resumed.conversationContext.activeTeamRecommendation?.team,
      teamInputAge: recommend.mock.calls[0]?.[0].maxAge,
      wasInterrupted: Object.hasOwn(interrupted, "__interrupt__"),
      wrongFilterAnswer: wrongFilterExplanation.messages.at(-1)?.content,
      wrongFilterOutcome: wrongFilterExplanation.outcome?.status,
      wrongTeamAnswer: wrongTeamExplanation.messages.at(-1)?.content,
      wrongTeamOutcome: wrongTeamExplanation.outcome?.status,
    }).toStrictEqual({
      activePlayerRecommendation: 25,
      activeTeamRecommendation: 21,
      explanationRequestKind: "team_recommendation",
      explanationSource: "saved",
      explanationWasInterrupted: true,
      nextRefinementAge: 20,
      nextRefinementRequestKind: "team_recommendation",
      recommendationCalls: 2,
      selectedTeam: teamRecommendationTest.arsenal,
      teamInputAge: 21,
      wasInterrupted: true,
      wrongFilterAnswer:
        "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。",
      wrongFilterOutcome: "saved_result_unavailable",
      wrongTeamAnswer:
        "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。",
      wrongTeamOutcome: "saved_result_unavailable",
    });
    expect(explained.messages.at(-1)?.content).toContain(
      "Roster source: API-Football, retrieved 2026-10-26T10:00:00.000Z"
    );
  });
});
