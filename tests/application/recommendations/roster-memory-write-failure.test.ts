import { HumanMessage } from "@langchain/core/messages";
import { Command, InMemoryStore } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import type { TeamRosterIdentityLookup } from "../../../src/team-data/roster-identity.js";
import type { RecommendTeamPlayerCandidates } from "../../../src/tools/recommend-team-player-candidates.js";
import { teamRecommendationTest } from "../../fixtures/team-recommendation.js";

describe("recommendation survives roster-memory write failure", () => {
  it("completes the team request when saving a confirmed roster mapping fails", async () => {
    await teamRecommendationTest.withPlayerMemorySources();
    const message = "Recommend a striker for Arsenal.";
    const apiFootballPlayerId = 7008;

    const directory = teamRecommendationTest.createDirectory(
      [teamRecommendationTest.arsenal],
      [{ id: apiFootballPlayerId, name: "Harry Kane", position: "Attacker" }]
    );

    const store = new InMemoryStore();
    vi.spyOn(store, "get").mockRejectedValue(new Error("Store unavailable"));

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
      configurable: { thread_id: "roster-memory-write-failure" },
    };

    await graph.invoke({ messages: [new HumanMessage(message)] }, config);
    const completed = await graph.invoke(new Command({ resume: "1" }), config);
    const [member] = teamRecommendationTest.readRosterMember(completed);

    expect(completed.messages.at(-1)?.content).toContain(
      "未能保存到跨对话记忆"
    );
    expect({
      mappingMethod: member?.mappingMethod,
      mappingStatus: member?.mappingStatus,
      memoryWriteFailed: completed.playerMemoryStatus.writeFailed,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      mappingMethod: "user_confirmation",
      mappingStatus: "resolved",
      memoryWriteFailed: true,
      recommendationCalls: 1,
    });
  });
});
