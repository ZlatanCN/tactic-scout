import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import type { BaseStore, InMemoryStore } from "@langchain/langgraph";
import { vi } from "vitest";

import type { CreateAgentOptions } from "../../src/agent.js";
import type { ReferenceIdentityLookup } from "../../src/player-data/resolve-reference.js";
import type { RequestUnderstandingExtractor } from "../../src/request-extraction.js";
import type { ReferenceCandidate } from "../../src/state.js";
import type {
  ApiFootballClient,
  ApiFootballRosterPlayer,
} from "../../src/team-data/api-football.js";
import type { TeamIdentity } from "../../src/team-data/contracts.js";
import type { TeamRosterIdentityLookup } from "../../src/team-data/roster-identity.js";
import type { RecommendTeamPlayerCandidates } from "../../src/tools/recommend-team-player-candidates.js";
import { createRecommendTeamPlayerCandidatesTool } from "../../src/tools/recommend-team-player-candidates.js";
import {
  testModelContextProfile,
  testModelOutputLimitAdapter,
  testModelWithDeterministicTokenCount,
} from "./model-context.js";
import { createPlayerMemorySources } from "./player-memory-sources.js";
import {
  recommendationResult,
  teamPositionUnavailableResult,
  teamRecommendationFailureResult,
  teamRecommendationResult,
} from "./workflow-results.js";

const missingPlayerSourceDatabase = path.join(
  tmpdir(),
  `tactiscout-team-no-source-${randomUUID()}.sqlite`
);

const playerMemoryTestDirectories: string[] = [];
const harryKaneName = "Harry Kane";

const stubTeamTestEnvironment = () => {
  vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");
  vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");
  vi.stubEnv("OPENAI_BASE_URL", "");
  vi.stubEnv("TACTISCOUT_FM_PROFILES_PATH", missingPlayerSourceDatabase);
  vi.stubEnv("TACTISCOUT_REEP_IDENTITY_DB_PATH", missingPlayerSourceDatabase);
  vi.stubEnv("TACTISCOUT_UNDERSTAT_DB_PATH", missingPlayerSourceDatabase);
};

stubTeamTestEnvironment();

const { createAgent: createAgentWithRuntime } =
  await import("../../src/agent.js");

const createAgent = (options: CreateAgentOptions = {}) => {
  const { model, ...remainingOptions } = options;

  return createAgentWithRuntime({
    model:
      model === undefined
        ? undefined
        : testModelWithDeterministicTokenCount(model),
    modelContextProfile: testModelContextProfile,
    modelOutputLimitAdapter: testModelOutputLimitAdapter,
    playerReferenceValidator: () => ({ status: "current" }),
    ...remainingOptions,
  });
};

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
  name: harryKaneName,
  records: [
    {
      canonicalIdentityId: null,
      competition: null,
      identityVerified: false,
      name: harryKaneName,
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
  store?: BaseStore;
}) =>
  createAgent({
    checkpointer: new MemorySaver(),
    model:
      options.model ??
      fakeModel().respond(new AIMessage("Team results are ready.")),
    playerIdentityLookup: options.playerIdentityLookup,
    requestUnderstandingExtractor: options.extractor,
    store: options.store,
    teamDirectory: options.directory,
    teamRosterIdentityLookup: options.identityLookup ?? bridgeIdentityLookup,
    tools: [createRecommendTeamPlayerCandidatesTool(options.recommend)],
  });

const withPlayerMemorySources = async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "tactiscout-team-memory-")
  );

  playerMemoryTestDirectories.push(directory);
  const sources = await createPlayerMemorySources(directory);

  vi.stubEnv("TACTISCOUT_FM_PROFILES_PATH", sources.fmDatabasePath);
  vi.stubEnv("TACTISCOUT_REEP_IDENTITY_DB_PATH", sources.reepDatabasePath);
  vi.stubEnv("TACTISCOUT_UNDERSTAT_DB_PATH", sources.understatDatabasePath);
  vi.stubEnv("TACTISCOUT_UNDERSTAT_AI_PROCESSING_ALLOWED", "true");

  return sources;
};

const rosterMemoryRecord = (
  apiFootballPlayerId: number,
  fmId: string,
  fmPlayerName: string
) => {
  const stableIdentityKey = createHash("sha256")
    .update(JSON.stringify([apiFootballPlayerId, fmId]))
    .digest("hex");

  return {
    apiFootballPlayerId,
    confirmationId: `confirmation-${fmId}`,
    confirmedAt: "2026-11-07T00:00:00.000Z",
    fmId,
    fmPlayerName,
    kind: "roster_identity" as const,
    originThreadId: "seeded-roster-confirmation",
    rosterPlayerName: harryKaneName,
    rosterRetrievedAt: "2026-11-06T00:00:00.000Z",
    schemaVersion: 1 as const,
    sourceVersions: {
      fmManifestSha256: "player-memory-test-snapshot",
      fmSnapshotDate: "2025-11-23",
    },
    stableIdentityKey,
  };
};

const putRosterMemoryRecord = async (
  store: InMemoryStore,
  record: ReturnType<typeof rosterMemoryRecord>
) => {
  await store.put(
    ["tactiscout", "local-user", "player-memory"],
    `v1:roster-identity:${record.stableIdentityKey}`,
    record,
    false
  );
};

const addApiFootballBridge = (
  reepDatabasePath: string,
  apiFootballPlayerId: number,
  canonicalIdentityId: string
) => {
  const database = new DatabaseSync(reepDatabasePath);

  try {
    database
      .prepare(
        "INSERT INTO bridges (provider, namespace, external_id, canonical_reep_id, redirect_status) VALUES ('api_football', 'player', ?, ?, 'resolved')"
      )
      .run(String(apiFootballPlayerId), canonicalIdentityId);
  } finally {
    database.close();
  }
};

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

const cleanup = async () => {
  vi.unstubAllEnvs();
  stubTeamTestEnvironment();
  await Promise.all(
    playerMemoryTestDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    })
  );
};

const teamRecommendationTest = {
  addApiFootballBridge,
  arsenal,
  bridgeIdentityLookup,
  cleanup,
  createAgent,
  createDirectory,
  createExtractor,
  createTeamAgent,
  kaneCandidate,
  playerMemoryTestDirectories,
  putRosterMemoryRecord,
  readRosterMember,
  recommendationResult,
  resolvedKane,
  rosterMemoryRecord,
  shortRateLimitResponse,
  stubTeamTestEnvironment,
  teamPositionUnavailableResult,
  teamRecommendationFailureResult,
  teamRecommendationResult,
  teamRequest,
  withPlayerMemorySources,
};

export { teamRecommendationTest };

export type { ExtractedRequest };
