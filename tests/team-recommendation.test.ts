import { setTimeout as delay } from "node:timers/promises";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReferenceIdentityLookup } from "../src/player-data/resolve-reference.js";
import { createLocalDataError } from "../src/player-data/shared.js";
import type { RequestUnderstandingExtractor } from "../src/request-extraction.js";
import type { ReferenceCandidate } from "../src/state.js";
import {
  createInitialConversationContext,
  createInitialFaultToleranceState,
} from "../src/state.js";
import type {
  ApiFootballClient,
  ApiFootballRosterPlayer,
} from "../src/team-data/api-football.js";
import { createApiFootballClient } from "../src/team-data/api-football.js";
import type { TeamIdentity } from "../src/team-data/contracts.js";
import type { TeamRosterIdentityLookup } from "../src/team-data/roster-identity.js";
import type { RecommendTeamPlayerCandidates } from "../src/tools/recommend-team-player-candidates.js";
import { createRecommendTeamPlayerCandidatesTool } from "../src/tools/recommend-team-player-candidates.js";
import {
  recommendationResult,
  teamPositionUnavailableResult,
  teamRecommendationFailureResult,
  teamRecommendationResult,
} from "./fixtures/workflow-results.js";

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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input, {
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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input, {
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
      positionRatingScaleBounded: modelInput.includes(
        "位置评分只报告工具返回的数值"
      ),
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
      positionRatingScaleBounded: true,
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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
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

  it("fails safely when structured extraction omits the explicit team", async () => {
    const message = "为 Real Madrid 继续推荐 stc 球员，CA 下限 150。";

    const realMadrid: TeamIdentity = {
      country: "Spain",
      id: 541,
      name: "Real Madrid",
    };

    const directory = createDirectory(
      [realMadrid],
      [{ id: 730, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest(null, "stc", { minimumCurrentAbility: 150 }),
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

    const directory = createDirectory(
      [realMadrid],
      [{ id: 730, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [message]: teamRequest(
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
    const directory = createDirectory([arsenal], []);

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("no_candidates", input)
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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
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
      .mockImplementationOnce((input) =>
        teamRecommendationResult("ready", input, {
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
      .mockImplementationOnce((input) => teamRecommendationFailureResult(input))
      .mockImplementationOnce((input) =>
        teamRecommendationResult("ready", input)
      )
      .mockImplementationOnce((input) =>
        teamRecommendationResult("ready", input)
      );

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
    ).toContain('"name":"First result marker"');
    expect(failed.messages.at(-1)?.content).toContain(
      "目前无法从本地数据中取得完成这次请求所需的信息"
    );
  });

  it("inherits saved filters when the same team is explicitly named during refinement", async () => {
    const firstMessage = "Recommend a striker for Arsenal under 25.";
    const refinementMessage = "为 Arsenal 继续推荐 stc 球员，CA 下限 130。";

    const directory = createDirectory(
      [arsenal],
      [{ id: 4101, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [firstMessage]: teamRequest(
          "Arsenal",
          "stc",
          { maxAge: 25 },
          "Arsenal"
        ),
        [refinementMessage]: {
          ...teamRequest(
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

    const directory = createDirectory(
      [arsenal],
      [{ id: 5001, name: "Arsenal Player", position: "Attacker" }]
    );

    const recommend = vi
      .fn<RecommendTeamPlayerCandidates>()
      .mockImplementation((input) => teamRecommendationResult("ready", input));

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
      .mockImplementationOnce((input) => teamPositionUnavailableResult(input))
      .mockImplementationOnce((input) =>
        teamRecommendationResult("ready", input)
      );

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

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
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
      team: arsenal,
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
      team: arsenal,
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
        resultJson: recommendationResult("no_candidates"),
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
        resultJson: teamRecommendationResult("no_candidates", teamInput),
        resultLimit: 5,
        roster,
        status: "no_candidates" as const,
        team: arsenal,
      },
    };

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("no_candidates", input)
    );

    const model = fakeModel()
      .respond(new AIMessage("Team filters updated."))
      .respond(new AIMessage("This is the saved team recommendation."))
      .respond(new AIMessage("The team filter was updated again."));

    const graph = createTeamAgent({
      directory: createDirectory([arsenal], []),
      extractor: createExtractor({
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
      { conversationContext, messages: [new HumanMessage(message)] },
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
      explanationAnswer: explained.messages.at(-1)?.content,
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
      explanationAnswer: "This is the saved team recommendation.",
      explanationRequestKind: "team_recommendation",
      explanationSource: "saved",
      explanationWasInterrupted: true,
      nextRefinementAge: 20,
      nextRefinementRequestKind: "team_recommendation",
      recommendationCalls: 2,
      selectedTeam: arsenal,
      teamInputAge: 21,
      wasInterrupted: true,
      wrongFilterAnswer:
        "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。",
      wrongFilterOutcome: "saved_result_unavailable",
      wrongTeamAnswer:
        "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。",
      wrongTeamOutcome: "saved_result_unavailable",
    });
  });

  it("does not apply a refinement to an old team result after a different team request fails", async () => {
    const failedRequestMessage = "为切尔西找一个中锋";
    const refinementMessage = "年龄上限改到 21 岁";

    const explicitSavedMessage =
      "Explain the previous Arsenal team recommendation.";

    const roster = {
      members: [],
      retrievedAt: "2026-10-26T10:00:00.000Z",
      team: arsenal,
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
      team: arsenal,
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
        resultJson: teamRecommendationResult("no_candidates", teamInput),
        resultLimit: 5,
        roster,
        status: "no_candidates" as const,
        team: arsenal,
      },
    };

    const directory = createDirectory([], []);

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("no_candidates", input)
    );

    const graph = createTeamAgent({
      directory,
      extractor: createExtractor({
        [explicitSavedMessage]: {
          constraints: [],
          continuationAction: "explain",
          kind: "team_recommendation",
          players: [],
          teams: ["Arsenal"],
        },
        [failedRequestMessage]: teamRequest("切尔西", "stc", {
          position: "stc",
        }),
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
      explicitSavedTeam: arsenal,
      failedStatus: "team_not_found",
      preservedAge: 25,
      preservedTeam: arsenal,
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
      team: arsenal,
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
      team: arsenal,
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
        resultJson: teamRecommendationResult("no_candidates", baselineInput),
        resultLimit: 5,
        roster,
        status: "no_candidates" as const,
        team: arsenal,
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
      teamRecommendationResult("no_candidates", input)
    );

    const graph = createTeamAgent({
      directory: createDirectory([arsenal], []),
      extractor: createExtractor({
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
      },
      { configurable: { thread_id: "failed-replacement-no-fallback" } }
    );

    const refined = await graph.invoke(
      {
        conversationContext,
        messages: [new HumanMessage(message)],
        outcome: previousOutcome,
        request: previousRequest("refine"),
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
      team: arsenal,
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
      team: arsenal,
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
        resultJson: teamRecommendationResult("no_candidates", teamInput),
        resultLimit: 5,
        roster,
        status: "no_candidates" as const,
        team: arsenal,
      },
    };

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("no_candidates", input)
    );

    const graph = createTeamAgent({
      directory: createDirectory([arsenal], []),
      extractor: createExtractor({
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
      team: arsenal,
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
      team: arsenal,
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
          { candidate: kaneCandidate, referenceId: kaneCandidate.candidateId },
        ],
        resultJson: teamRecommendationResult("ready", teamInput),
        resultLimit: 5,
        roster,
        status: "ready" as const,
        team: arsenal,
      },
    };

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
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

    const graph = createTeamAgent({
      directory: createDirectory([arsenal], []),
      extractor: createExtractor({
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
      { conversationContext, messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "team-named-reference-player-followup" } }
    );

    expect({
      references: recommend.mock.calls[0]?.[0].referenceFmIds,
      team: result.conversationContext.activeTeamRecommendation?.team,
    }).toStrictEqual({
      references: ["kane-fm", "mbappe-fm"],
      team: arsenal,
    });
  });

  it("retains a completed team recommendation when its final explanation fails", async () => {
    const message = "Recommend a striker for Arsenal.";

    const directory = createDirectory(
      [arsenal],
      [{ id: 1001, name: "Squad Player", position: "Attacker" }]
    );

    const recommend = vi.fn<RecommendTeamPlayerCandidates>((input) =>
      teamRecommendationResult("ready", input)
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
