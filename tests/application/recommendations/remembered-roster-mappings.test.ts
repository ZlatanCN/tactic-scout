import { HumanMessage } from "@langchain/core/messages";
import { Command, InMemoryStore } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import { resolveTeamRosterIdentity } from "../../../src/team-data/roster-identity.js";
import type { TeamRosterIdentityLookup } from "../../../src/team-data/roster-identity.js";
import type { RecommendTeamPlayerCandidates } from "../../../src/tools/recommend-team-player-candidates.js";
import { teamRecommendationTest } from "../../fixtures/team-recommendation.js";

describe("remembered roster mapping validation", () => {
  it("reuses a confirmed roster mapping in another team request", async () => {
    await teamRecommendationTest.withPlayerMemorySources();

    const message = "Recommend a striker for Arsenal.";
    const apiFootballPlayerId = 7001;

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: apiFootballPlayerId, name: "Harry Kane", position: "Attacker" }]
    );

    const identityLookup = vi.fn<TeamRosterIdentityLookup>(() => ({
      candidates: [
        { fmId: "fm-kane", name: "Harry Kane" },
        { fmId: "fm-haaland", name: "Erling Haaland" },
      ],
      status: "needs_confirmation",
    }));

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("no_candidates", input)
    );

    const store = new InMemoryStore();

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [message]: teamRecommendationTest.teamRequest("Arsenal", "stc", {
          position: "stc",
        }),
      }),
      identityLookup,
      recommend,
      store,
    });

    const threadA = {
      configurable: { thread_id: "confirmed-roster-thread-a" },
    };

    const threadB = {
      configurable: { thread_id: "confirmed-roster-thread-b" },
    };

    const pendingA = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      threadA
    );

    const completedA = await graph.invoke(
      new Command({ resume: "1" }),
      threadA
    );

    const completedB = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      threadB
    );

    const [memberA] = teamRecommendationTest.readRosterMember(completedA);
    const [memberB] = teamRecommendationTest.readRosterMember(completedB);

    expect({
      completedBWasInterrupted: Object.hasOwn(completedB, "__interrupt__"),
      identityLookupCalls: identityLookup.mock.calls.length,
      mappedPlayers: [memberA, memberB].map((member) => ({
        apiFootballPlayerId: member?.apiFootballPlayerId,
        fmId: member?.fmId,
        mappingMethod: member?.mappingMethod,
        mappingStatus: member?.mappingStatus,
      })),
      rosterFetchTeamIds: directory.getSquad.mock.calls.map(
        ([teamId]) => teamId
      ),
      threadAWasInterrupted: Object.hasOwn(pendingA, "__interrupt__"),
    }).toStrictEqual({
      completedBWasInterrupted: false,
      identityLookupCalls: 1,
      mappedPlayers: [
        {
          apiFootballPlayerId,
          fmId: "fm-kane",
          mappingMethod: "user_confirmation",
          mappingStatus: "resolved",
        },
        {
          apiFootballPlayerId,
          fmId: "fm-kane",
          mappingMethod: "user_confirmation",
          mappingStatus: "resolved",
        },
      ],
      rosterFetchTeamIds: [
        teamRecommendationTest.arsenal.id,
        teamRecommendationTest.arsenal.id,
      ],
      threadAWasInterrupted: true,
    });
  }, 30_000);

  it("asks before using competing confirmed roster mappings", async () => {
    await teamRecommendationTest.withPlayerMemorySources();

    const message = "Recommend a striker for Arsenal.";
    const apiFootballPlayerId = 7002;

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: apiFootballPlayerId, name: "Harry Kane", position: "Attacker" }]
    );

    const store = new InMemoryStore();

    await Promise.all([
      teamRecommendationTest.putRosterMemoryRecord(
        store,
        teamRecommendationTest.rosterMemoryRecord(
          apiFootballPlayerId,
          "fm-kane",
          "Harry Kane"
        )
      ),
      teamRecommendationTest.putRosterMemoryRecord(
        store,
        teamRecommendationTest.rosterMemoryRecord(
          apiFootballPlayerId,
          "fm-haaland",
          "Erling Haaland"
        )
      ),
    ]);

    const identityLookup = vi.fn<TeamRosterIdentityLookup>(() => ({
      candidate: { fmId: "fm-haaland", name: "Erling Haaland" },
      method: "reep_bridge",
      status: "resolved",
    }));

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
      identityLookup,
      recommend,
      store,
    });

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "competing-roster-memory" } }
    );

    const [member] = teamRecommendationTest.readRosterMember(interrupted);

    expect({
      candidates: member?.fmCandidates.map(({ fmId }) => fmId).toSorted(),
      identityLookupCalls: identityLookup.mock.calls.length,
      mappingMethod: member?.mappingMethod,
      mappingStatus: member?.mappingStatus,
      pendingKind: interrupted.pendingClarification?.kind,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      candidates: ["fm-haaland", "fm-kane"],
      identityLookupCalls: 1,
      mappingMethod: null,
      mappingStatus: "pending",
      pendingKind: "team_roster_profile",
      recommendationCalls: 0,
    });
  });

  it("asks when a remembered mapping conflicts with the current Reep bridge", async () => {
    const sources = await teamRecommendationTest.withPlayerMemorySources();
    const message = "Recommend a striker for Arsenal.";
    const apiFootballPlayerId = 7004;
    teamRecommendationTest.addApiFootballBridge(
      sources.reepDatabasePath,
      apiFootballPlayerId,
      "canonical:haaland"
    );

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: apiFootballPlayerId, name: "Harry Kane", position: "Attacker" }]
    );

    const store = new InMemoryStore();
    await teamRecommendationTest.putRosterMemoryRecord(
      store,
      teamRecommendationTest.rosterMemoryRecord(
        apiFootballPlayerId,
        "fm-kane",
        "Harry Kane"
      )
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
      identityLookup: resolveTeamRosterIdentity,
      recommend,
      store,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "roster-memory-reep-conflict" } }
    );

    const [member] = teamRecommendationTest.readRosterMember(result);

    expect({
      candidateFmIds: member?.fmCandidates.map(({ fmId }) => fmId).toSorted(),
      mappingMethod: member?.mappingMethod,
      mappingStatus: member?.mappingStatus,
      pendingKind: result.pendingClarification?.kind,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      candidateFmIds: ["fm-haaland", "fm-kane"],
      mappingMethod: null,
      mappingStatus: "pending",
      pendingKind: "team_roster_profile",
      recommendationCalls: 0,
    });
  });

  it("requires current confirmation when a remembered FM source ID is missing", async () => {
    await teamRecommendationTest.withPlayerMemorySources();
    const message = "Recommend a striker for Arsenal.";
    const apiFootballPlayerId = 7005;

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: apiFootballPlayerId, name: "Harry Kane", position: "Attacker" }]
    );

    const store = new InMemoryStore();
    await teamRecommendationTest.putRosterMemoryRecord(
      store,
      teamRecommendationTest.rosterMemoryRecord(
        apiFootballPlayerId,
        "fm-removed",
        "Harry Kane"
      )
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
      identityLookup: resolveTeamRosterIdentity,
      recommend,
      store,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "stale-roster-memory" } }
    );

    const [member] = teamRecommendationTest.readRosterMember(result);

    expect({
      candidateFmIds: member?.fmCandidates.map(({ fmId }) => fmId).toSorted(),
      fmId: member?.fmId,
      mappingStatus: member?.mappingStatus,
      pendingKind: result.pendingClarification?.kind,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      candidateFmIds: ["fm-kane"],
      fmId: null,
      mappingStatus: "pending",
      pendingKind: "team_roster_profile",
      recommendationCalls: 0,
    });
  });

  it("pauses to refresh FM data when a remembered profile and current alternatives are absent", async () => {
    await teamRecommendationTest.withPlayerMemorySources();
    const message = "Recommend a striker for Arsenal.";
    const apiFootballPlayerId = 7009;

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: apiFootballPlayerId, name: "Harry Kane", position: "Attacker" }]
    );

    const store = new InMemoryStore();
    await teamRecommendationTest.putRosterMemoryRecord(
      store,
      teamRecommendationTest.rosterMemoryRecord(
        apiFootballPlayerId,
        "fm-removed",
        "Harry Kane"
      )
    );

    const identityLookup = vi
      .fn<TeamRosterIdentityLookup>()
      .mockReturnValueOnce({ status: "no_profile" })
      .mockReturnValue({
        candidates: [{ fmId: "fm-kane", name: "Harry Kane" }],
        status: "needs_confirmation",
      });

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
      identityLookup,
      recommend,
      store,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "missing-roster-profile-refresh" } }
    );

    const [member] = teamRecommendationTest.readRosterMember(result);

    const refreshed = await graph.invoke(new Command({ resume: "重试" }), {
      configurable: { thread_id: "missing-roster-profile-refresh" },
    });

    const [refreshedMember] =
      teamRecommendationTest.readRosterMember(refreshed);

    expect(result.pendingClarification?.question).toContain(
      "更新或补齐当前 FM 资料"
    );

    expect({
      candidates: member?.fmCandidates,
      mappingStatus: member?.mappingStatus,
      outcome: result.outcome?.status ?? null,
      pendingKind: result.pendingClarification?.kind,
      recommendationCalls: recommend.mock.calls.length,
      refreshedCandidates: refreshedMember?.fmCandidates.map(
        ({ fmId }) => fmId
      ),
      refreshedPendingKind: refreshed.pendingClarification?.kind,
    }).toMatchObject({
      candidates: [],
      mappingStatus: "pending",
      outcome: null,
      pendingKind: "team_roster_profile",
      recommendationCalls: 0,
      refreshedCandidates: ["fm-kane"],
      refreshedPendingKind: "team_roster_profile",
    });
  });

  it("does not remember a roster mapping selected only by a Reep bridge", async () => {
    const sources = await teamRecommendationTest.withPlayerMemorySources();
    const apiFootballPlayerId = 7007;
    teamRecommendationTest.addApiFootballBridge(
      sources.reepDatabasePath,
      apiFootballPlayerId,
      "canonical:kane"
    );

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [
        {
          id: apiFootballPlayerId,
          name: "Bridged Player",
          position: "Attacker",
        },
      ]
    );

    const store = new InMemoryStore();

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("no_candidates", input)
    );

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        "Recommend a striker for Arsenal.": teamRecommendationTest.teamRequest(
          "Arsenal",
          "stc",
          {
            position: "stc",
          }
        ),
      }),
      identityLookup: resolveTeamRosterIdentity,
      recommend,
      store,
    });

    const result = await graph.invoke(
      {
        messages: [new HumanMessage("Recommend a striker for Arsenal.")],
      },
      { configurable: { thread_id: "reeped-roster-not-remembered" } }
    );

    const items = await store.search(
      ["tactiscout", "local-user", "player-memory"],
      { filter: { kind: "roster_identity" } }
    );

    const [member] = teamRecommendationTest.readRosterMember(result);

    expect({
      mappingMethod: member?.mappingMethod,
      mappingStatus: member?.mappingStatus,
      rememberedItems: items.length,
      wasInterrupted: Object.hasOwn(result, "__interrupt__"),
    }).toStrictEqual({
      mappingMethod: "reep_bridge",
      mappingStatus: "resolved",
      rememberedItems: 0,
      wasInterrupted: false,
    });
  });
});
