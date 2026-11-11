import { setTimeout as delay } from "node:timers/promises";

import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import { createApiFootballClient } from "../../../src/team-data/api-football.js";
import type { TeamIdentity } from "../../../src/team-data/contracts.js";
import type { RecommendTeamPlayerCandidates } from "../../../src/tools/recommend-team-player-candidates.js";
import { teamRecommendationTest } from "../../fixtures/team-recommendation.js";

describe("team provider retry and timeout behavior", () => {
  it("uses the native graph retry for an API-Football server error", async () => {
    const message = "Recommend a striker for Arsenal.";

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              team: teamRecommendationTest.arsenal,
              venue: { name: "Emirates" },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              players: [
                { id: 1001, name: "Squad Player", position: "Attacker" },
              ],
              team: teamRecommendationTest.arsenal,
            },
          ],
        })
      );

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });

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
      { configurable: { thread_id: "team-api-server-retry" } }
    );

    expect({
      fetchCalls: fetcher.mock.calls.length,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      fetchCalls: 3,
      recommendationCalls: 1,
    });
    expect(result.messages.at(-1)?.content).toContain(
      "Roster source: API-Football, retrieved "
    );
  });

  it("retries roster acquisition before mapping and ranking the roster", async () => {
    const message = "Recommend a striker for Arsenal.";

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              team: teamRecommendationTest.arsenal,
              venue: { name: "Emirates" },
            },
          ],
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              players: [
                { id: 1001, name: "Squad Player", position: "Attacker" },
              ],
              team: teamRecommendationTest.arsenal,
            },
          ],
        })
      );

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });

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
      { configurable: { thread_id: "team-roster-server-retry" } }
    );

    expect({
      fetchCalls: fetcher.mock.calls.length,
      mappedRoster: teamRecommendationTest
        .readRosterMember(result)
        .map((member) => member.fmId),
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      fetchCalls: 3,
      mappedRoster: ["fm-1001"],
      recommendationCalls: 1,
    });
    expect(result.messages.at(-1)?.content).toContain(
      "Roster source: API-Football, retrieved "
    );
  });

  it("recovers one short 429 while acquiring a team roster", async () => {
    const message = "Recommend a striker for Arsenal.";

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              team: teamRecommendationTest.arsenal,
              venue: { name: "Emirates" },
            },
          ],
        })
      )
      .mockResolvedValueOnce(teamRecommendationTest.shortRateLimitResponse())
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              players: [
                { id: 1001, name: "Squad Player", position: "Attacker" },
              ],
              team: teamRecommendationTest.arsenal,
            },
          ],
        })
      );

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });

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
      { configurable: { thread_id: "team-roster-rate-limit-retry" } }
    );

    expect({
      fetchCalls: fetcher.mock.calls.length,
      mappedRoster: teamRecommendationTest
        .readRosterMember(result)
        .map((member) => member.fmId),
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      fetchCalls: 3,
      mappedRoster: ["fm-1001"],
      recommendationCalls: 1,
    });
    expect(result.messages.at(-1)?.content).toContain(
      "Roster source: API-Football, retrieved "
    );
  });

  it("gives roster acquisition its own short-429 retry after team clarification", async () => {
    const message = "Recommend a striker for Arsenal.";

    const anotherArsenal: TeamIdentity = {
      country: "Brazil",
      id: 43,
      name: "Arsenal",
    };

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(teamRecommendationTest.shortRateLimitResponse())
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              team: teamRecommendationTest.arsenal,
              venue: { name: "Emirates" },
            },
            { team: anotherArsenal, venue: { name: "" } },
          ],
        })
      )
      .mockResolvedValueOnce(teamRecommendationTest.shortRateLimitResponse())
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              players: [
                { id: 1001, name: "Squad Player", position: "Attacker" },
              ],
              team: teamRecommendationTest.arsenal,
            },
          ],
        })
      );

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });

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

    const config = {
      configurable: { thread_id: "team-roster-separate-rate-budget" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      config
    );

    const completed = await graph.invoke(new Command({ resume: "1" }), config);

    expect({
      completedTeam:
        completed.conversationContext.activeTeamRecommendation?.team,
      fetchCalls: fetcher.mock.calls.length,
      mapping: teamRecommendationTest
        .readRosterMember(completed)
        .map((member) => member.fmId),
      wasInterrupted: Object.hasOwn(interrupted, "__interrupt__"),
    }).toStrictEqual({
      completedTeam: teamRecommendationTest.arsenal,
      fetchCalls: 4,
      mapping: ["fm-1001"],
      wasInterrupted: true,
    });
  });

  it("waits and retries one short 429 without exceeding the request budget", async () => {
    const message = "Recommend a striker for Arsenal.";

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { errors: [], response: [] },
          {
            headers: {
              "retry-after": "0",
              "x-ratelimit-requests-remaining": "4",
            },
            status: 429,
          }
        )
      )
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              team: teamRecommendationTest.arsenal,
              venue: { name: "Emirates" },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              players: [
                { id: 1001, name: "Squad Player", position: "Attacker" },
              ],
              team: teamRecommendationTest.arsenal,
            },
          ],
        })
      );

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });

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
      { configurable: { thread_id: "team-api-rate-limit-retry" } }
    );

    expect({
      fetchCalls: fetcher.mock.calls.length,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      fetchCalls: 3,
      recommendationCalls: 1,
    });
    expect(result.messages.at(-1)?.content).toContain(
      "Roster source: API-Football, retrieved "
    );
  });

  it("does not retry a second short 429 in the same team lookup", async () => {
    const message = "Recommend a striker for Arsenal.";

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(teamRecommendationTest.shortRateLimitResponse())
      .mockResolvedValueOnce(teamRecommendationTest.shortRateLimitResponse());

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });
    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() => "{}");

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
      { configurable: { thread_id: "team-api-rate-limit-once" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      fetchCalls: fetcher.mock.calls.length,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      answer: "API-Football 正在短时限流。",
      fetchCalls: 2,
      recommendationCalls: 0,
    });
  });

  it("shares one request budget across network, short-429, then server failure", async () => {
    const message = "Recommend a striker for Arsenal.";

    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(
        Object.assign(new Error("temporary connection failure"), {
          code: "ECONNRESET",
        })
      )
      .mockResolvedValueOnce(teamRecommendationTest.shortRateLimitResponse())
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });
    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() => "{}");

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
      { configurable: { thread_id: "team-api-shared-request-budget" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      fetchCalls: fetcher.mock.calls.length,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      answer: "API-Football 服务暂时返回 HTTP 503。",
      fetchCalls: 3,
      recommendationCalls: 0,
    });
  });

  it("does not retry early when Retry-After exceeds the bounded wait", async () => {
    const message = "Recommend a striker for Arsenal.";

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { errors: [], response: [] },
        {
          headers: {
            "retry-after": "20",
            "x-ratelimit-requests-remaining": "4",
          },
          status: 429,
        }
      )
    );

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });
    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() => "{}");

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
      { configurable: { thread_id: "team-api-long-retry-after" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      fetchCalls: fetcher.mock.calls.length,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      answer: "API-Football 正在短时限流。",
      fetchCalls: 1,
      recommendationCalls: 0,
    });
  });

  it("retries a team-search node timeout three times and passes cancellation to fetch", async () => {
    const message = "Recommend a striker for Arsenal.";

    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      await delay(60_000, undefined, { signal: init?.signal ?? undefined });

      return Response.json({ errors: [], response: [] });
    });

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });
    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() => "{}");

    const graph = teamRecommendationTest.createTeamAgent({
      directory,
      extractor: teamRecommendationTest.createExtractor({
        [message]: teamRecommendationTest.teamRequest("Arsenal", "stc", {
          position: "stc",
        }),
      }),
      recommend,
    });

    vi.useFakeTimers();

    try {
      const pending = graph.invoke(
        { messages: [new HumanMessage(message)] },
        { configurable: { thread_id: "team-search-node-timeout" } }
      );

      await vi.advanceTimersByTimeAsync(60_000);
      const result = await pending;

      expect({
        answer: result.messages.at(-1)?.content,
        fetchCalls: fetcher.mock.calls.length,
        recommendationCalls: recommend.mock.calls.length,
      }).toStrictEqual({
        answer: "外部服务请求超时，本次任务没有完成。",
        fetchCalls: 3,
        recommendationCalls: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  }, 15_000);
});
