import { setTimeout as delay } from "node:timers/promises";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReferenceIdentityLookup } from "../src/player-data/resolve-reference.js";
import { createLocalDataError } from "../src/player-data/shared.js";
import type { RequestUnderstandingExtractor } from "../src/request-extraction.js";
import type { ReferenceCandidate } from "../src/state.js";
import type {
  ApiFootballClient,
  ApiFootballRosterPlayer,
} from "../src/team-data/api-football.js";
import { createApiFootballClient } from "../src/team-data/api-football.js";
import type { TeamIdentity } from "../src/team-data/contracts.js";
import type { TeamRosterIdentityLookup } from "../src/team-data/roster-identity.js";
import type { RecommendTeamPlayerCandidates } from "../src/tools/recommend-team-player-candidates.js";
import { createRecommendTeamPlayerCandidatesTool } from "../src/tools/recommend-team-player-candidates.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../src/agent.js");

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

const arsenal: TeamIdentity = {
  country: "England",
  id: 42,
  name: "Arsenal",
};

const teamRequest = (
  teamName: string | null,
  position: string | null,
  recommendation?: ExtractedRequest["recommendation"],
  teamSearchName: string | null = null
): ExtractedRequest => {
  const request: ExtractedRequest = {
    constraints: [],
    kind: "team_recommendation",
    players: [],
    teamSearchName,
    teams: teamName === null ? [] : [teamName],
  };

  if (recommendation !== undefined || position !== null) {
    const patch = { ...recommendation };

    if (position !== null) {
      patch.position = position;
    }

    request.recommendation = patch;
  }

  return request;
};

const createExtractor =
  (requests: Record<string, ExtractedRequest>): RequestUnderstandingExtractor =>
  async (message) => {
    const request = requests[message];

    if (request === undefined) {
      throw new Error(`Unexpected test message: ${message}`);
    }

    return await Promise.resolve(request);
  };

const createDirectory = (
  teams: TeamIdentity[],
  players: ApiFootballRosterPlayer[]
) => {
  const searchTeams = vi
    .fn<ApiFootballClient["searchTeams"]>()
    .mockResolvedValue({ data: teams, status: "ok" });

  const getSquad = vi.fn<ApiFootballClient["getSquad"]>(async (teamId) => {
    const team = teams.find((candidate) => candidate.id === teamId);

    return await Promise.resolve({
      data: {
        players,
        retrievedAt: "2026-10-26T10:00:00.000Z",
        team: team ?? arsenal,
      },
      status: "ok",
    });
  });

  return { getSquad, searchTeams };
};

const bridgeIdentityLookup: TeamRosterIdentityLookup = (
  apiFootballPlayerId,
  playerName
) => ({
  candidate: { fmId: `fm-${apiFootballPlayerId}`, name: playerName },
  method: "reep_bridge",
  status: "resolved",
});

const kaneCandidate: ReferenceCandidate = {
  candidateId: "source:fm:kane-fm",
  canonicalIdentityId: null,
  exactNameMatch: true,
  identityVerified: false,
  name: "Harry Kane",
  records: [
    {
      canonicalIdentityId: null,
      competition: null,
      identityVerified: false,
      name: "Harry Kane",
      provider: "fm",
      season: null,
      sourceId: "kane-fm",
      team: null,
    },
  ],
};

const resolvedKane: ReferenceIdentityLookup = (mention) => ({
  candidateCount: 1,
  candidates: [kaneCandidate],
  candidatesTruncated: false,
  canonicalIdentityId: null,
  clarificationMessage: null,
  mention,
  selectedCandidateId: kaneCandidate.candidateId,
  selectedName: kaneCandidate.name,
  status: "resolved",
});

const createTeamAgent = (options: {
  directory: Pick<ApiFootballClient, "getSquad" | "searchTeams">;
  extractor: RequestUnderstandingExtractor;
  identityLookup?: TeamRosterIdentityLookup;
  model?: ReturnType<typeof fakeModel>;
  playerIdentityLookup?: ReferenceIdentityLookup;
  recommend: RecommendTeamPlayerCandidates;
}) =>
  createAgent({
    checkpointer: new MemorySaver(),
    model:
      options.model ??
      fakeModel().respond(new AIMessage("Team results are ready.")),
    playerIdentityLookup: options.playerIdentityLookup,
    requestUnderstandingExtractor: options.extractor,
    teamDirectory: options.directory,
    teamRosterIdentityLookup: options.identityLookup ?? bridgeIdentityLookup,
    tools: [createRecommendTeamPlayerCandidatesTool(options.recommend)],
  });

const readRosterMember = (
  result: Awaited<ReturnType<ReturnType<typeof createTeamAgent>["invoke"]>>
) => {
  const { request } = result;

  if (request.kind !== "team_recommendation") {
    throw new Error("Expected a team recommendation request.");
  }

  return request.teamRecommendation.roster?.members ?? [];
};

const shortRateLimitResponse = () =>
  Response.json(
    { errors: [], response: [] },
    {
      headers: {
        "retry-after": "0",
        "x-ratelimit-requests-remaining": "4",
      },
      status: 429,
    }
  );

describe("team recommendation graph", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves a unique team, maps its roster, and commits the ranked result", async () => {
    const message = "Recommend a striker for Arsenal.";

    const directory = createDirectory(
      [arsenal],
      [{ id: 1001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() =>
      JSON.stringify({
        recommendation: { currentCandidates: [{ fmId: "candidate-1" }] },
        status: "ready",
      })
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
      }),
      recommend,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-recommendation-unique" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      getSquadCalls: directory.getSquad.mock.calls.map(([teamId]) => [teamId]),
      input: recommend.mock.calls[0]?.[0],
      searchCalls: directory.searchTeams.mock.calls.map(([query]) => [query]),
      storedTeam: result.conversationContext.activeTeamRecommendation?.team,
    }).toMatchObject({
      answer: "Team results are ready.",
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
        team: arsenal,
      },
      searchCalls: [["Arsenal"]],
      storedTeam: arsenal,
    });
  });

  it("instructs team recommendation answers to list every candidate with CA and PA", async () => {
    const message = "Recommend young high-potential strikers for Arsenal.";

    const directory = createDirectory(
      [arsenal],
      [{ id: 1001, name: "Squad Player", position: "Attacker" }]
    );

    const recommendation = JSON.stringify({
      fmSnapshotDate: "2025-11-23",
      position: "stc",
      recommendation: {
        currentCandidates: [
          {
            age: 18,
            currentAbility: 124,
            currentDistance: 2.7,
            fmId: "fm-future-01",
            name: "Synthetic Future Prospect",
            positionRating: 19,
            potentialAbility: 195,
            rank: 1,
          },
        ],
        filterCounts: { excludedMissingPotentialForPotentialList: 1 },
        potentialCandidates: [
          {
            age: 19,
            currentAbility: 121,
            currentDistance: 3.42,
            fmId: "fm-high-pa-01",
            name: "Synthetic High Potential Candidate",
            positionRating: 18,
            potentialAbility: 199,
            rank: 1,
          },
        ],
        references: [],
        status: "ready",
      },
      roster: {
        mappedMembers: 1,
        noLocalProfileMembers: 0,
        pendingMembers: 0,
        reepBridgeMappings: 1,
        retrievedAt: "2025-11-20T12:00:00.000Z",
        source: "API-Football",
        totalMembers: 1,
        userConfirmedMappings: 0,
      },
      status: "ready",
      team: arsenal,
    });

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(
      () => recommendation
    );

    const model = fakeModel().respond(
      new AIMessage("The recommendation is ready.")
    );

    const modelInvoke = vi.spyOn(model, "invoke");

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { includePotential: true }),
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
      missingPa: modelInput.includes("potentialAbility 为 null"),
      noPositionEligibleOnlyWhenZero: modelInput.includes(
        "只有 recommendation.filterCounts.eligiblePositionProfiles 为 0，才能说没有位置合格画像"
      ),
      paContextOnly: modelInput.includes("PA 仅作为资料展示"),
      potentialCandidateDataPassed:
        modelInput.includes("Synthetic High Potential Candidate") &&
        modelInput.includes("199") &&
        modelInput.includes("3.42"),
      referenceMethodGrounded:
        modelInput.includes(
          "不要推断团队参考画像的成员筛选标准或计算方法，除非 recommendation 结果明确提供"
        ) &&
        !modelInput.includes(
          "团队参考画像是位置评分至少 15 且特征完整的队内球员属性等权平均"
        ),
      tacticalFitCaveat: modelInput.includes(
        "必须说明这些结果只反映 FM 属性画像相似，不代表战术适配或转会可行性"
      ),
    }).toStrictEqual({
      allCurrentCandidates: true,
      allPotentialCandidates: true,
      missingPa: true,
      noPositionEligibleOnlyWhenZero: true,
      paContextOnly: true,
      potentialCandidateDataPassed: true,
      referenceMethodGrounded: true,
      tacticalFitCaveat: true,
    });
  });

  it("asks for a position before acquiring a team roster", async () => {
    const message = "Recommend a player for Arsenal.";

    const directory = createDirectory(
      [arsenal],
      [{ id: 1001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() =>
      JSON.stringify({ status: "ready" })
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", null),
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
      completedTeam: arsenal,
      getSquadCalls: [[42]],
      recommendationCalls: 1,
      resumedWithPosition: "stc",
      wasInterrupted: true,
    });
  });

  it("stops safely when the provider returns an empty squad", async () => {
    const message = "Recommend a striker for Arsenal.";
    const directory = createDirectory([arsenal], []);

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() =>
      JSON.stringify({ status: "ready" })
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
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

  it("uses the native graph retry for an API-Football server error", async () => {
    const message = "Recommend a striker for Arsenal.";

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [{ team: arsenal, venue: { name: "Emirates" } }],
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
              team: arsenal,
            },
          ],
        })
      );

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() =>
      JSON.stringify({
        recommendation: { currentCandidates: [] },
        status: "ready",
      })
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
      }),
      recommend,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-api-server-retry" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      fetchCalls: fetcher.mock.calls.length,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      answer: "Team results are ready.",
      fetchCalls: 3,
      recommendationCalls: 1,
    });
  });

  it("retries roster acquisition before mapping and ranking the roster", async () => {
    const message = "Recommend a striker for Arsenal.";

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [{ team: arsenal, venue: { name: "Emirates" } }],
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
              team: arsenal,
            },
          ],
        })
      );

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() =>
      JSON.stringify({
        recommendation: { currentCandidates: [] },
        status: "ready",
      })
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
      }),
      recommend,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-roster-server-retry" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      fetchCalls: fetcher.mock.calls.length,
      mappedRoster: readRosterMember(result).map((member) => member.fmId),
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      answer: "Team results are ready.",
      fetchCalls: 3,
      mappedRoster: ["fm-1001"],
      recommendationCalls: 1,
    });
  });

  it("recovers one short 429 while acquiring a team roster", async () => {
    const message = "Recommend a striker for Arsenal.";

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [{ team: arsenal, venue: { name: "Emirates" } }],
        })
      )
      .mockResolvedValueOnce(shortRateLimitResponse())
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              players: [
                { id: 1001, name: "Squad Player", position: "Attacker" },
              ],
              team: arsenal,
            },
          ],
        })
      );

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() =>
      JSON.stringify({
        recommendation: { currentCandidates: [] },
        status: "ready",
      })
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
      }),
      recommend,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-roster-rate-limit-retry" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      fetchCalls: fetcher.mock.calls.length,
      mappedRoster: readRosterMember(result).map((member) => member.fmId),
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      answer: "Team results are ready.",
      fetchCalls: 3,
      mappedRoster: ["fm-1001"],
      recommendationCalls: 1,
    });
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
      .mockResolvedValueOnce(shortRateLimitResponse())
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            { team: arsenal, venue: { name: "Emirates" } },
            { team: anotherArsenal, venue: { name: "" } },
          ],
        })
      )
      .mockResolvedValueOnce(shortRateLimitResponse())
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              players: [
                { id: 1001, name: "Squad Player", position: "Attacker" },
              ],
              team: arsenal,
            },
          ],
        })
      );

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() =>
      JSON.stringify({
        recommendation: { currentCandidates: [] },
        status: "ready",
      })
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
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
      mapping: readRosterMember(completed).map((member) => member.fmId),
      wasInterrupted: Object.hasOwn(interrupted, "__interrupt__"),
    }).toStrictEqual({
      completedTeam: arsenal,
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
          response: [{ team: arsenal, venue: { name: "Emirates" } }],
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
              team: arsenal,
            },
          ],
        })
      );

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() =>
      JSON.stringify({
        recommendation: { currentCandidates: [] },
        status: "ready",
      })
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
      }),
      recommend,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-api-rate-limit-retry" } }
    );

    expect({
      answer: result.messages.at(-1)?.content,
      fetchCalls: fetcher.mock.calls.length,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      answer: "Team results are ready.",
      fetchCalls: 3,
      recommendationCalls: 1,
    });
  });

  it("does not retry a second short 429 in the same team lookup", async () => {
    const message = "Recommend a striker for Arsenal.";

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(shortRateLimitResponse())
      .mockResolvedValueOnce(shortRateLimitResponse());

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });
    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() => "{}");

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
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
      .mockResolvedValueOnce(shortRateLimitResponse())
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    const directory = createApiFootballClient({ apiKey: "test-key", fetcher });
    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() => "{}");

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
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

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
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

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
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
  });

  it("confirms a translated provider search before accepting the team identity", async () => {
    const message = "为阿森纳找一个中锋";

    const directory = createDirectory(
      [arsenal],
      [{ id: 1101, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() =>
      JSON.stringify({ status: "ready" })
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("阿森纳", "stc", { position: "stc" }, "Arsenal"),
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
      completedTeam: arsenal,
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

    const directory = createDirectory(teams, [
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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() =>
      JSON.stringify({ status: "no_candidates" })
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Paris FC", "stc", { position: "stc" }),
      }),
      identityLookup,
      recommend,
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

    expect({
      completed: completed.conversationContext.activeTeamRecommendation,
      getSquadCalls: directory.getSquad.mock.calls.map(([teamId]) => [teamId]),
      identityLookups: identityLookup.mock.calls,
      mappedRoster: readRosterMember(completed).map((member) => ({
        fmId: member.fmId,
        mappingMethod: member.mappingMethod,
      })),
      recommendCalls: recommend.mock.calls.length,
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
      searchCalls: [["Paris FC"]],
      wasInterrupted: [true, true, true],
    });
  });

  it("reports local identity-data failure without retrying the roster fetch", async () => {
    const message = "Recommend a striker for Arsenal.";

    const directory = createDirectory(
      [arsenal],
      [{ id: 1001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() => "{}");

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
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

    const directory = createDirectory(
      [arsenal],
      [{ id: 3001, name: "Unmapped Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() =>
      JSON.stringify({ status: "ready" })
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
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

  it("inherits filters, preserves the last success on failure, and clears explicit nulls", async () => {
    const firstMessage = "Recommend a striker for Arsenal under 25.";
    const failedRefinement = "Make the age limit 22.";
    const successfulRefinement = "Require CA of at least 130.";
    const clearAge = "Remove the age limit.";

    const directory = createDirectory(
      [arsenal],
      [{ id: 4001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi
      .fn<RecommendTeamPlayerCandidates>()
      .mockReturnValueOnce(JSON.stringify({ result: 1, status: "ready" }))
      .mockReturnValueOnce(JSON.stringify({ status: "data_unavailable" }))
      .mockReturnValueOnce(JSON.stringify({ result: 3, status: "ready" }))
      .mockReturnValueOnce(JSON.stringify({ result: 4, status: "ready" }));

    const model = fakeModel()
      .respond(new AIMessage("First team list."))
      .respond(new AIMessage("Updated team list."))
      .respond(new AIMessage("Age filter cleared."));

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [clearAge]: teamRequest(null, null, { maxAge: null }),
        [failedRefinement]: teamRequest(null, null, { maxAge: 22 }),
        [firstMessage]: teamRequest("Arsenal", "stc", { maxAge: 25 }),
        [successfulRefinement]: teamRequest(null, null, {
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
    ).toContain('"result":1');
    expect(failed.messages.at(-1)?.content).toContain("本地球员数据源无法读取");
  });

  it("resets filters and roster when the scout names another team", async () => {
    const firstMessage = "Recommend a striker for Arsenal under 25.";
    const replacementMessage = "Switch the team to Chelsea and find a striker.";

    const chelsea: TeamIdentity = {
      country: "England",
      id: 50,
      name: "Chelsea",
    };

    const directory = createDirectory(
      [arsenal],
      [{ id: 5001, name: "Arsenal Player", position: "Attacker" }]
    );

    const recommend = vi
      .fn<RecommendTeamPlayerCandidates>()
      .mockReturnValue(JSON.stringify({ status: "ready" }));

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [firstMessage]: teamRequest("Arsenal", "stc", { maxAge: 25 }),
        [replacementMessage]: teamRequest("Chelsea", "stc"),
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

    const directory = createDirectory(
      [arsenal],
      [{ id: 6001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi
      .fn<RecommendTeamPlayerCandidates>()
      .mockReturnValueOnce(
        JSON.stringify({ status: "team_position_unavailable" })
      )
      .mockReturnValueOnce(JSON.stringify({ status: "ready" }));

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc"),
      }),
      model: fakeModel().respond(new AIMessage("Named reference list.")),
      playerIdentityLookup: resolvedKane,
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

    const directory = createDirectory(
      [arsenal],
      [{ id: 7001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(() =>
      JSON.stringify({ status: "ready" })
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [firstMessage]: teamRequest("Arsenal", "stc"),
        [secondMessage]: teamRequest(null, null, { resultLimit: 3 }),
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
      firstTeam: arsenal,
      searchCalls: [["Arsenal"]],
      secondActiveTeam: null,
      secondAnswer: "请告诉我球队名称和目标位置，再开始球队推荐。",
      toolCalls: 1,
    });
  });

  it("retains a completed team recommendation when its final explanation fails", async () => {
    const message = "Recommend a striker for Arsenal.";

    const directory = createDirectory(
      [arsenal],
      [{ id: 1001, name: "Squad Player", position: "Attacker" }]
    );

    const recommendation = JSON.stringify({
      recommendation: { currentCandidates: [] },
      status: "ready",
    });

    const recommend = vi.fn<RecommendTeamPlayerCandidates>(
      () => recommendation
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

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest("Arsenal", "stc", { position: "stc" }),
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
        result.conversationContext.activeTeamRecommendation?.resultJson,
      answer: result.messages.at(-1)?.content,
      outcome: result.outcome?.status,
      recommendationCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      activeRecommendation: recommendation,
      answer:
        "数据查询或计算已经完成，但模型暂时无法生成解释。已完成的结构化结果仍保留，可以继续追问。",
      outcome: "ready",
      recommendationCalls: 1,
    });
  });
});
