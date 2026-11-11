import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import type { ReferenceIdentityLookup } from "../../../src/player-data/resolve-reference.js";
import {
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialFaultToleranceState,
} from "../../../src/state.js";
import type { ReferenceCandidate } from "../../../src/state.js";
import type { RecommendTeamPlayerCandidates } from "../../../src/tools/recommend-team-player-candidates.js";
import { teamRecommendationTest } from "../../fixtures/team-recommendation.js";

describe("team recommendation failure and saved-result continuation", () => {
  it("does not apply a refinement to an old team result after a different team request fails", async () => {
    const failedRequestMessage = "为切尔西找一个中锋";
    const refinementMessage = "年龄上限改到 21 岁";

    const explicitSavedMessage =
      "Explain the previous Arsenal team recommendation.";

    const roster = {
      members: [],
      retrievedAt: "2026-10-26T10:00:00.000Z",
      team: teamRecommendationTest.arsenal,
    };

    const teamInput = {
      includePotential: false,
      maxAge: 25,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: "stc",
      referenceFmIds: [],
      referenceMode: "squad" as const,
      resultLimit: 5,
      roster,
      team: teamRecommendationTest.arsenal,
    };

    const initialContext = createInitialConversationContext();

    const conversationContext = {
      ...initialContext,
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

    const directory = teamRecommendationTest.createDirectory([], []);

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("no_candidates", input)
    );

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [explicitSavedMessage]: {
          constraints: [],
          continuationAction: "explain",
          kind: "team_recommendation",
          players: [],
          teams: ["Arsenal"],
        },
        [failedRequestMessage]: teamRecommendationTest.teamRequest(
          "切尔西",
          "stc",
          {
            position: "stc",
          }
        ),
        [refinementMessage]: {
          constraints: [],
          continuationAction: "refine",
          kind: null,
          players: [],
          recommendation: { maxAge: 21 },
          teams: [],
        },
      }),
      recommend,
    });

    const config = {
      configurable: { thread_id: "failed-team-task-does-not-fall-back" },
    };

    const failed = await graph.invoke(
      {
        conversationContext,
        messages: [new HumanMessage(failedRequestMessage)],
        stateSchemaVersion: agentStateSchemaVersion,
      },
      config
    );

    const refined = await graph.invoke(
      { messages: [new HumanMessage(refinementMessage)] },
      config
    );

    const explicitSaved = await graph.invoke(
      {
        conversationContext: failed.conversationContext,
        faultTolerance: failed.faultTolerance,
        messages: [new HumanMessage(explicitSavedMessage)],
        outcome: failed.outcome,
        request: failed.request,
        stateSchemaVersion: agentStateSchemaVersion,
      },
      { configurable: { thread_id: "explicit-saved-after-failed-team" } }
    );

    expect({
      explicitSavedSource:
        explicitSaved.outcome !== null && "source" in explicitSaved.outcome
          ? explicitSaved.outcome.source
          : null,
      explicitSavedTeam:
        explicitSaved.conversationContext.activeTeamRecommendation?.team,
      failedStatus: failed.outcome?.status,
      preservedAge:
        refined.conversationContext.activeTeamRecommendation?.maxAge,
      preservedTeam: refined.conversationContext.activeTeamRecommendation?.team,
      recommendationCalls: recommend.mock.calls.length,
      requestKind: refined.request.kind,
      searchCalls: directory.searchTeams.mock.calls.length,
    }).toStrictEqual({
      explicitSavedSource: "saved",
      explicitSavedTeam: teamRecommendationTest.arsenal,
      failedStatus: "team_not_found",
      preservedAge: 25,
      preservedTeam: teamRecommendationTest.arsenal,
      recommendationCalls: 0,
      requestKind: "other",
      searchCalls: 1,
    });
  });

  it("only continues a failed recommendation from its prior snapshot when the action was a refinement", async () => {
    const message = "年龄上限改到 21 岁";

    const roster = {
      members: [],
      retrievedAt: "2026-10-26T10:00:00.000Z",
      team: teamRecommendationTest.arsenal,
    };

    const baselineInput = {
      includePotential: false,
      maxAge: 25,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: "stc",
      referenceFmIds: [],
      referenceMode: "squad" as const,
      resultLimit: 5,
      roster,
      team: teamRecommendationTest.arsenal,
    };

    const initialContext = createInitialConversationContext();

    const conversationContext = {
      ...initialContext,
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
          baselineInput
        ),
        resultLimit: 5,
        roster,
        status: "no_candidates" as const,
        team: teamRecommendationTest.arsenal,
      },
    };

    const previousRequest = (action: "replace" | "refine") => ({
      constraints: [],
      kind: "team_recommendation" as const,
      players: [],
      processedMessageId: "previous-user-message",
      teamRecommendation: {
        ...baselineInput,
        maxAge: 23,
        teamName: "Arsenal",
        teamSearchName: "Arsenal",
      },
      teamRecommendationAction: action,
      teams: ["Arsenal"],
    });

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("no_candidates", input)
    );

    const graph = teamRecommendationTest.createTeamAgent({
      directory: teamRecommendationTest.createDirectory(
        [teamRecommendationTest.arsenal],
        []
      ),
      extractor: teamRecommendationTest.createExtractor({
        [message]: {
          constraints: [],
          continuationAction: "refine",
          kind: null,
          players: [],
          recommendation: { maxAge: 21 },
          teams: [],
        },
      }),
      recommend,
    });

    const previousOutcome = {
      kind: "team_recommendation" as const,
      resultJson: null,
      status: "data_unavailable" as const,
    };

    const replacement = await graph.invoke(
      {
        conversationContext,
        messages: [new HumanMessage(message)],
        outcome: previousOutcome,
        request: previousRequest("replace"),
        stateSchemaVersion: agentStateSchemaVersion,
      },
      { configurable: { thread_id: "failed-replacement-no-fallback" } }
    );

    const refined = await graph.invoke(
      {
        conversationContext,
        messages: [new HumanMessage(message)],
        outcome: previousOutcome,
        request: previousRequest("refine"),
        stateSchemaVersion: agentStateSchemaVersion,
      },
      { configurable: { thread_id: "failed-refinement-keeps-baseline" } }
    );

    expect({
      refinedAge: refined.conversationContext.activeTeamRecommendation?.maxAge,
      refinementKind: refined.request.kind,
      refinementToolAge: recommend.mock.calls[0]?.[0].maxAge,
      replacementKind: replacement.request.kind,
      replacementToolCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      refinedAge: 21,
      refinementKind: "team_recommendation",
      refinementToolAge: 21,
      replacementKind: "other",
      replacementToolCalls: 1,
    });
  });

  it("confirms the saved target after the previous request was not understood", async () => {
    const message = "年龄上限改到 21 岁";

    const roster = {
      members: [],
      retrievedAt: "2026-10-26T10:00:00.000Z",
      team: teamRecommendationTest.arsenal,
    };

    const teamInput = {
      includePotential: false,
      maxAge: 25,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: "stc",
      referenceFmIds: [],
      referenceMode: "squad" as const,
      resultLimit: 5,
      roster,
      team: teamRecommendationTest.arsenal,
    };

    const initialContext = createInitialConversationContext();

    const conversationContext = {
      ...initialContext,
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

    const graph = teamRecommendationTest.createTeamAgent({
      directory: teamRecommendationTest.createDirectory(
        [teamRecommendationTest.arsenal],
        []
      ),
      extractor: teamRecommendationTest.createExtractor({
        [message]: {
          constraints: [],
          continuationAction: "refine",
          kind: null,
          players: [],
          recommendation: { maxAge: 21 },
          teams: [],
        },
      }),
      recommend,
    });

    const config = {
      configurable: { thread_id: "understanding-failure-confirms-target" },
    };

    const faultTolerance = {
      ...createInitialFaultToleranceState(),
      failure: {
        category: "invalid_response" as const,
        node: "understand_request" as const,
      },
    };

    const interrupted = await graph.invoke(
      {
        conversationContext,
        faultTolerance,
        messages: [new HumanMessage(message)],
        stateSchemaVersion: agentStateSchemaVersion,
      },
      config
    );

    expect(recommend).toHaveBeenCalledTimes(0);

    const resumed = await graph.invoke(new Command({ resume: "1" }), config);

    expect({
      activeAge: resumed.conversationContext.activeTeamRecommendation?.maxAge,
      requestedAge: recommend.mock.calls[0]?.[0].maxAge,
      wasInterrupted: Object.hasOwn(interrupted, "__interrupt__"),
    }).toStrictEqual({
      activeAge: 21,
      requestedAge: 21,
      wasInterrupted: true,
    });
  });

  it("can continue a named-reference team recommendation from a player mention", async () => {
    const message = "Add Kylian Mbappé as a team reference.";

    const mbappe: ReferenceCandidate = {
      candidateId: "source:fm:mbappe-fm",
      canonicalIdentityId: null,
      exactNameMatch: true,
      identityVerified: false,
      name: "Kylian Mbappé",
      records: [
        {
          canonicalIdentityId: null,
          competition: null,
          identityVerified: false,
          name: "Kylian Mbappé",
          provider: "fm",
          season: null,
          sourceId: "mbappe-fm",
          team: null,
        },
      ],
    };

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
      maxAge: null,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: "stc",
      referenceFmIds: ["kane-fm"],
      referenceMode: "named" as const,
      resultLimit: 5,
      roster,
      team: teamRecommendationTest.arsenal,
    };

    const initialContext = createInitialConversationContext();

    const conversationContext = {
      ...initialContext,
      activeTeamRecommendation: {
        includePotential: false,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceMode: "named" as const,
        referencePlayers: [
          {
            candidate: teamRecommendationTest.kaneCandidate,
            referenceId: teamRecommendationTest.kaneCandidate.candidateId,
          },
        ],
        resultJson: teamRecommendationTest.teamRecommendationResult(
          "ready",
          teamInput
        ),
        resultLimit: 5,
        roster,
        status: "ready" as const,
        team: teamRecommendationTest.arsenal,
      },
    };

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("ready", input)
    );

    const playerIdentityLookup: ReferenceIdentityLookup = (mention) => ({
      candidateCount: 1,
      candidates: [mbappe],
      candidatesTruncated: false,
      canonicalIdentityId: null,
      clarificationMessage: null,
      mention,
      selectedCandidateId: mbappe.candidateId,
      selectedName: mbappe.name,
      status: "resolved",
    });

    const graph = teamRecommendationTest.createTeamAgent({
      directory: teamRecommendationTest.createDirectory(
        [teamRecommendationTest.arsenal],
        []
      ),
      extractor: teamRecommendationTest.createExtractor({
        [message]: {
          constraints: [],
          continuationAction: "refine",
          kind: null,
          players: [
            {
              lookupName: null,
              mention: "Kylian Mbappé",
              recommendationRole: "reference",
              referenceScope: "explicit",
              referenceTargetMention: null,
            },
          ],
          teams: [],
        },
      }),
      model: fakeModel().respond(
        new AIMessage("The team reference set was updated.")
      ),
      playerIdentityLookup,
      recommend,
    });

    const result = await graph.invoke(
      {
        conversationContext,
        messages: [new HumanMessage(message)],
        stateSchemaVersion: agentStateSchemaVersion,
      },
      { configurable: { thread_id: "team-named-reference-player-followup" } }
    );

    expect({
      references: recommend.mock.calls[0]?.[0].referenceFmIds,
      team: result.conversationContext.activeTeamRecommendation?.team,
    }).toStrictEqual({
      references: ["kane-fm", "mbappe-fm"],
      team: teamRecommendationTest.arsenal,
    });
  });

  it("retains a completed team recommendation when its final explanation fails", async () => {
    const message = "Recommend a striker for Arsenal.";

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: 1001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("ready", input)
    );

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

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [message]: teamRecommendationTest.teamRequest("Arsenal", "stc", {
          position: "stc",
        }),
      }),
      model,
      recommend,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-recommendation-explanation-outage" } }
    );

    expect({
      activeRecommendation:
        result.conversationContext.activeTeamRecommendation?.status,
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
});
