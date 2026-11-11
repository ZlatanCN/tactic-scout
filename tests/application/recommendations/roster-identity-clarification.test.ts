import { HumanMessage } from "@langchain/core/messages";
import { Command, InMemoryStore } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { createLocalDataError } from "../../../src/player-data/shared.js";
import type { TeamIdentity } from "../../../src/team-data/contracts.js";
import type { TeamRosterIdentityLookup } from "../../../src/team-data/roster-identity.js";
import type { RecommendTeamPlayerCandidates } from "../../../src/tools/recommend-team-player-candidates.js";
import { teamRecommendationTest } from "../../fixtures/team-recommendation.js";

describe("roster identity clarification and coverage", () => {
  it("falls back to roster clarification and reports a Store read failure", async () => {
    await teamRecommendationTest.withPlayerMemorySources();
    const message = "Recommend a striker for Arsenal.";
    const apiFootballPlayerId = 7006;

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: apiFootballPlayerId, name: "Harry Kane", position: "Attacker" }]
    );

    const store = new InMemoryStore();
    vi.spyOn(store, "search").mockRejectedValue(new Error("Store unavailable"));

    const identityLookup = vi.fn<TeamRosterIdentityLookup>(() => ({
      candidates: [{ fmId: "fm-kane", name: "Harry Kane" }],
      status: "needs_confirmation",
    }));

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("no_candidates", input)
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

    const config = {
      configurable: { thread_id: "roster-memory-read-failure" },
    };

    const pending = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      config
    );

    const completed = await graph.invoke(new Command({ resume: "1" }), config);
    const [member] = teamRecommendationTest.readRosterMember(completed);

    expect(completed.messages.at(-1)?.content).toContain(
      "无法读取跨对话的球员身份记忆"
    );

    expect({
      identityLookupCalls: identityLookup.mock.calls.length,
      mappingMethod: member?.mappingMethod,
      memoryReadFailed: completed.playerMemoryStatus.readFailed,
      recommendationCalls: recommend.mock.calls.length,
      wasInterrupted: Object.hasOwn(pending, "__interrupt__"),
    }).toStrictEqual({
      identityLookupCalls: 1,
      mappingMethod: "user_confirmation",
      memoryReadFailed: true,
      recommendationCalls: 1,
      wasInterrupted: true,
    });
  });

  it("confirms a translated provider search before accepting the team identity", async () => {
    const message = "为阿森纳找一个中锋";

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: 1101, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationTest.teamRecommendationResult("ready", input)
    );

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [message]: teamRecommendationTest.teamRequest(
          "阿森纳",
          "stc",
          { position: "stc" },
          "Arsenal"
        ),
      }),
      recommend,
    });

    const config = {
      configurable: { thread_id: "team-translated-name" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      config
    );

    const completed = await graph.invoke(new Command({ resume: "1" }), config);

    expect({
      completedTeam:
        completed.conversationContext.activeTeamRecommendation?.team,
      searchCalls: directory.searchTeams.mock.calls.map(([query]) => [query]),
      wasInterrupted: Object.hasOwn(interrupted, "__interrupt__"),
    }).toStrictEqual({
      completedTeam: teamRecommendationTest.arsenal,
      searchCalls: [["Arsenal"]],
      wasInterrupted: true,
    });
  });

  it("resumes ambiguous team selection and maps each unmatched FM profile once", async () => {
    const message = "Recommend a striker for Paris FC.";

    const teams: TeamIdentity[] = [
      { country: "France", id: 51, name: "Paris FC" },
      { country: "United States", id: 52, name: "Paris FC" },
    ];

    const directory = teamRecommendationTest.createDirectory(teams, [
      { id: 2001, name: "First Squad Player", position: "Attacker" },
      { id: 2002, name: "Second Squad Player", position: "Attacker" },
    ]);

    const identityLookup = vi.fn<TeamRosterIdentityLookup>((id, name) => ({
      candidates: [
        { fmId: `first-${id}`, name: `${name} First FM Match` },
        { fmId: `second-${id}`, name: `${name} Second FM Match` },
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
        [message]: teamRecommendationTest.teamRequest("Paris FC", "stc", {
          position: "stc",
        }),
      }),
      identityLookup,
      recommend,
      store,
    });

    const config = {
      configurable: { thread_id: "team-roster-resolution" },
    };

    const teamInterrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      config
    );

    const profileInterrupted = await graph.invoke(
      new Command({ resume: "2" }),
      config
    );

    const nextProfileInterrupted = await graph.invoke(
      new Command({ resume: "1" }),
      config
    );

    const completed = await graph.invoke(new Command({ resume: "2" }), config);

    const rememberedRosterMappings = await store.search(
      ["tactiscout", "local-user", "player-memory"],
      { filter: { kind: "roster_identity" } }
    );

    const rosterMemorySchema = z.object({
      apiFootballPlayerId: z.number().int().positive(),
      confirmationId: z.string().min(1),
      confirmedAt: z.iso.datetime(),
      fmId: z.string().min(1),
      fmPlayerName: z.string().min(1),
      kind: z.literal("roster_identity"),
      originThreadId: z.string().min(1),
      rosterPlayerName: z.string().min(1),
      rosterRetrievedAt: z.iso.datetime().nullable(),
      schemaVersion: z.literal(1),
      sourceVersions: z.object({
        fmManifestSha256: z.string().nullable(),
        fmSnapshotDate: z.string().nullable(),
      }),
      stableIdentityKey: z.string().min(1),
    });

    const memoryRecords = rememberedRosterMappings
      .map((item) => rosterMemorySchema.parse(item.value))
      .toSorted(
        (left, right) => left.apiFootballPlayerId - right.apiFootballPlayerId
      );

    expect(
      memoryRecords.map(({ apiFootballPlayerId, fmId }) => ({
        apiFootballPlayerId,
        fmId,
      }))
    ).toStrictEqual([
      { apiFootballPlayerId: 2001, fmId: "first-2001" },
      { apiFootballPlayerId: 2002, fmId: "second-2002" },
    ]);

    expect({
      completed: completed.conversationContext.activeTeamRecommendation,
      getSquadCalls: directory.getSquad.mock.calls.map(([teamId]) => [teamId]),
      identityLookups: identityLookup.mock.calls,
      mappedRoster: teamRecommendationTest
        .readRosterMember(completed)
        .map((member) => ({
          fmId: member.fmId,
          mappingMethod: member.mappingMethod,
        })),
      recommendCalls: recommend.mock.calls.length,
      rememberedRosterKeys: rememberedRosterMappings.map((item) =>
        Object.keys(item.value).toSorted()
      ),
      rememberedRosterMappings: memoryRecords.map((record) => ({
        apiFootballPlayerId: record.apiFootballPlayerId,
        confirmationIdPresent: record.confirmationId.length > 0,
        confirmedAtPresent: record.confirmedAt.length > 0,
        fmId: record.fmId,
        fmPlayerName: record.fmPlayerName,
        kind: record.kind,
        originThreadId: record.originThreadId,
        rosterPlayerName: record.rosterPlayerName,
        rosterRetrievedAt: record.rosterRetrievedAt,
        schemaVersion: record.schemaVersion,
        sourceVersions: record.sourceVersions,
        stableIdentityKeyPresent: record.stableIdentityKey.length > 0,
      })),
      searchCalls: directory.searchTeams.mock.calls.map(([query]) => [query]),
      wasInterrupted: [
        teamInterrupted,
        profileInterrupted,
        nextProfileInterrupted,
      ].map((result) => Object.hasOwn(result, "__interrupt__")),
    }).toMatchObject({
      completed: { status: "no_candidates", team: teams[1] },
      getSquadCalls: [[52]],
      identityLookups: [
        [2001, "First Squad Player"],
        [2002, "Second Squad Player"],
      ],
      mappedRoster: [
        { fmId: "first-2001", mappingMethod: "user_confirmation" },
        { fmId: "second-2002", mappingMethod: "user_confirmation" },
      ],
      recommendCalls: 1,
      rememberedRosterKeys: [
        [
          "apiFootballPlayerId",
          "confirmationId",
          "confirmedAt",
          "fmId",
          "fmPlayerName",
          "kind",
          "originThreadId",
          "rosterPlayerName",
          "rosterRetrievedAt",
          "schemaVersion",
          "sourceVersions",
          "stableIdentityKey",
        ],
        [
          "apiFootballPlayerId",
          "confirmationId",
          "confirmedAt",
          "fmId",
          "fmPlayerName",
          "kind",
          "originThreadId",
          "rosterPlayerName",
          "rosterRetrievedAt",
          "schemaVersion",
          "sourceVersions",
          "stableIdentityKey",
        ],
      ],
      rememberedRosterMappings: [
        {
          apiFootballPlayerId: 2001,
          confirmationIdPresent: true,
          confirmedAtPresent: true,
          fmId: "first-2001",
          fmPlayerName: "First Squad Player First FM Match",
          kind: "roster_identity",
          originThreadId: "team-roster-resolution",
          rosterPlayerName: "First Squad Player",
          rosterRetrievedAt: "2026-10-26T10:00:00.000Z",
          schemaVersion: 1,
          sourceVersions: {
            fmManifestSha256: "player-memory-test-snapshot",
            fmSnapshotDate: "2025-11-23",
          },
          stableIdentityKeyPresent: true,
        },
        {
          apiFootballPlayerId: 2002,
          confirmationIdPresent: true,
          confirmedAtPresent: true,
          fmId: "second-2002",
          fmPlayerName: "Second Squad Player Second FM Match",
          kind: "roster_identity",
          originThreadId: "team-roster-resolution",
          rosterPlayerName: "Second Squad Player",
          rosterRetrievedAt: "2026-10-26T10:00:00.000Z",
          schemaVersion: 1,
          sourceVersions: {
            fmManifestSha256: "player-memory-test-snapshot",
            fmSnapshotDate: "2025-11-23",
          },
          stableIdentityKeyPresent: true,
        },
      ],
      searchCalls: [["Paris FC"]],
      wasInterrupted: [true, true, true],
    });
  });

  it("reports local identity-data failure without retrying the roster fetch", async () => {
    const message = "Recommend a striker for Arsenal.";

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: 1001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() => "{}");

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [message]: teamRecommendationTest.teamRequest("Arsenal", "stc", {
          position: "stc",
        }),
      }),
      identityLookup: () => {
        throw createLocalDataError("fixture identity data unavailable");
      },
      recommend,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-local-identity-failure" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      fetchCalls: directory.getSquad.mock.calls.length,
      outcome: result.outcome?.status,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      answer: "读取本地 Reep 或 FM 身份资料失败，本次没有生成团队推荐。",
      fetchCalls: 1,
      outcome: "team_identity_error",
      recommendationCalls: 0,
    });
  });

  it("stops when a roster member has no local FM profile", async () => {
    const message = "Recommend a striker for Arsenal.";

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: 3001, name: "Unmapped Player", position: "Attacker" }]
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
      identityLookup: () => ({ status: "no_profile" }),
      recommend,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-no-fm-profile" } }
    );

    expect({
      activeTeamRecommendation:
        result.conversationContext.activeTeamRecommendation,
      answer: result.messages.at(-1)?.content,
      recommendCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      activeTeamRecommendation: null,
      answer:
        "阵容成员“Unmapped Player”（API-Football ID 3001）没有可确认的本地 FM 画像，因此已暂停推荐。映射到可用本地 FM 画像 0/1 人（Reep 桥接 0，人工确认 0），无本地画像 1 人，待确认 0 人。",
      recommendCalls: 0,
    });
  });
});
