import { createAgent } from "../../src/agent.js";
import type {
  FmRecommendationProfile,
  FmRecommendationReadResult,
} from "../../src/player-data/football-manager.js";
import { getPositionFeatureDefinition } from "../../src/player-data/position-features.js";
import {
  recommendPlayers,
  recommendTeamPlayers,
} from "../../src/player-data/recommend-players.js";
import type { ReferenceIdentityLookup } from "../../src/player-data/resolve-reference.js";
import type { PlayerSearch } from "../../src/player-data/search-records.js";
import type { RequestUnderstandingExtractor } from "../../src/request-extraction.js";
import type { ReferenceCandidate } from "../../src/state.js";
import type {
  ApiFootballClient,
  ApiFootballRosterPlayer,
} from "../../src/team-data/api-football.js";
import { teamRosterCoverage } from "../../src/team-data/roster-coverage.js";
import type { TeamRosterIdentityLookup } from "../../src/team-data/roster-identity.js";
import type {
  RecommendPlayerCandidates,
  RecommendPlayerCandidatesInput,
} from "../../src/tools/recommend-player-candidates.js";
import type {
  RecommendTeamPlayerCandidates,
  RecommendTeamPlayerCandidatesInput,
} from "../../src/tools/recommend-team-player-candidates.js";
import { createTools } from "../../src/tools/search-player-records.js";
import type { PlayerSearchInput } from "../../src/tools/search-player-records.js";

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

const team = { country: "England", id: 541, name: "Test Club" };
const outageTeamName = "Outage Club";
const kaneName = "Harry Kane";
const haalandName = "Erling Haaland";

const rosterPlayer: ApiFootballRosterPlayer = {
  id: 10,
  name: kaneName,
  position: "Attacker",
};

const candidate = (name: string, slug: string): ReferenceCandidate => ({
  candidateId: `reep:${slug}`,
  canonicalIdentityId: `canonical:${slug}`,
  exactNameMatch: true,
  identityBasis: "reep_registry",
  identityVerified: true,
  name,
  records: [
    {
      canonicalIdentityId: `canonical:${slug}`,
      competition: null,
      identityVerified: true,
      name,
      provider: "fm",
      season: null,
      sourceId: `fm-${slug}`,
      team: null,
    },
  ],
});

const kane = candidate(kaneName, "kane");
const haaland = candidate(haalandName, "haaland");

const requestForPlayers = (
  kind: ExtractedRequest["kind"],
  names: string[],
  extra: Partial<ExtractedRequest> = {}
): ExtractedRequest => ({
  constraints: [],
  kind,
  players: names.map((mention) => ({
    lookupName: null,
    mention,
    recommendationRole: "reference",
  })),
  teams: [],
  ...extra,
});

const extractedRequests = new Map<string, ExtractedRequest>([
  [
    `Compare ${kaneName} and ${haalandName}`,
    requestForPlayers("player_comparison", [kaneName, haalandName], {
      comparisonAction: "replace",
    }),
  ],
  [
    "Explain the saved team recommendation",
    requestForPlayers("team_recommendation", [], {
      continuationAction: "explain",
      recommendationAction: "replace",
      teamSearchName: team.name,
      teams: [team.name],
    }),
  ],
  [
    `Find alternatives to ${kaneName}`,
    requestForPlayers("player_recommendation", [kaneName], {
      recommendation: { position: "stc", resultLimit: 2 },
      recommendationAction: "replace",
    }),
  ],
  [`Look up ${kaneName}`, requestForPlayers("player_lookup", [kaneName])],
  [
    `Recommend a striker for ${team.name}`,
    {
      constraints: [],
      kind: "team_recommendation",
      players: [],
      recommendation: { position: "stc", resultLimit: 2 },
      teamSearchName: team.name,
      teams: [team.name],
    },
  ],
  [
    `Recommend a striker for ${outageTeamName}`,
    {
      constraints: [],
      kind: "team_recommendation",
      players: [],
      recommendation: { position: "stc", resultLimit: 2 },
      teamSearchName: outageTeamName,
      teams: [outageTeamName],
    },
  ],
  [
    `Retry the ${outageTeamName} striker search`,
    {
      constraints: [],
      kind: "team_recommendation",
      players: [],
      recommendation: { position: "stc", resultLimit: 2 },
      recommendationAction: "replace",
      teamSearchName: outageTeamName,
      teams: [outageTeamName],
    },
  ],
]);

const requestUnderstandingExtractor: RequestUnderstandingExtractor = async (
  message
) => {
  const request = extractedRequests.get(message);

  if (request === undefined) {
    throw new Error(`Unexpected persistence fixture request: ${message}`);
  }

  return await Promise.resolve(request);
};

const playerIdentityLookup: ReferenceIdentityLookup = (mention) => {
  const resolvedCandidate = [kane, haaland].find(
    (item) => item.name === mention
  );

  if (resolvedCandidate === undefined) {
    throw new Error(`Unexpected persistence fixture identity: ${mention}`);
  }

  return {
    candidateCount: 1,
    candidates: [resolvedCandidate],
    candidatesTruncated: false,
    canonicalIdentityId: resolvedCandidate.canonicalIdentityId,
    clarificationMessage: null,
    mention,
    selectedCandidateId: resolvedCandidate.candidateId,
    selectedName: resolvedCandidate.name,
    status: "resolved",
  };
};

const fmRecord = (name: string, sourceRecordId: string) => ({
  attributes: {
    accelerationRaw: 14,
    decisionsRaw: 14,
    finishingRaw: 14,
    first_touchRaw: 14,
    off_the_ballRaw: 14,
    paceRaw: 14,
    passingRaw: 14,
    strengthRaw: 14,
    techniqueRaw: 14,
    visionRaw: 14,
  },
  birthDate: "1993-07-28",
  currentAbility: 165,
  heightCm: 188,
  identitySourceId: sourceRecordId,
  naturalPositions: "STC",
  player: name,
  potentialAbility: 170,
  source: "Football Manager" as const,
  sourceRecordId,
});

const recordTestEvent = async (name: string) => {
  const endpoint = process.env.PERSISTENCE_TEST_EVENTS_URL;

  if (endpoint === undefined) {
    throw new Error("Persistence fixture event endpoint is not configured.");
  }

  const response = await fetch(endpoint, {
    body: JSON.stringify({ name }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Could not record fixture event: ${name}`);
  }
};

const playerSearch: PlayerSearch = async (input: PlayerSearchInput) => {
  await recordTestEvent("player-search");

  const fmRecords = input.sourceRecords.flatMap((sourceRecord) => {
    if (sourceRecord.provider !== "fm") {
      return [];
    }

    const resolvedPlayer = [kane, haaland].find(
      (item) => item.records[0]?.sourceId === sourceRecord.sourceId
    );

    return resolvedPlayer === undefined
      ? []
      : [fmRecord(resolvedPlayer.name, sourceRecord.sourceId)];
  });

  return JSON.stringify({
    fm: {
      records: fmRecords,
      status: fmRecords.length > 0 ? "found" : "not_found",
    },
    identityGroups: {
      canonicalGroups: [],
      registryStatus: "not_needed",
      unlinkedRecords: [],
    },
    query: input.sourceRecords,
  });
};

const recommendationFeatures = getPositionFeatureDefinition("stc").features;

const recommendationProfile = (
  fmId: string,
  name: string,
  attributeValue: number
): FmRecommendationProfile => ({
  attributes: Object.fromEntries(
    recommendationFeatures.map((feature) => [feature, attributeValue])
  ),
  birthDate: "2000-01-01",
  currentAbility: attributeValue * 10,
  fmId,
  name,
  naturalPositions: "STC",
  positionRating: 20,
  potentialAbility: attributeValue * 10 + 15,
  sourceRecordId: `${fmId}-record`,
});

const fmProfiles = [
  recommendationProfile("fm-kane", kaneName, 14),
  recommendationProfile("fm-haaland", haalandName, 15),
  recommendationProfile("fm-prospect", "Fixture Prospect", 16),
];

const recommendationSource = (
  referenceFmIds: string[]
): FmRecommendationReadResult => ({
  excludedMissingFmIdCandidates: 0,
  gameBuild: "persistence-fixture-build",
  manifestSha256: "persistence-fixture-manifest",
  position: "stc",
  profiles: fmProfiles,
  references: fmProfiles.filter((profile) =>
    referenceFmIds.includes(profile.fmId)
  ),
  snapshotDate: "2025-11-23",
  status: "ready",
});

const recommendPlayersFixture: RecommendPlayerCandidates = async (
  input: RecommendPlayerCandidatesInput,
  ageAsOfDate
) => {
  await recordTestEvent("player-recommendation");
  const referenceFmIds = input.referenceGroups.flatMap((group) => group.fmIds);

  const result = recommendPlayers(
    {
      excludeFmIds: input.excludeGroups.flatMap((group) => group.fmIds),
      includePotential: input.includePotential,
      maxAge: input.maxAge,
      minimumCurrentAbility: input.minimumCurrentAbility,
      minimumPotentialAbility: input.minimumPotentialAbility,
      position: input.position ?? "stc",
      referenceFmIds,
      resultLimit: input.resultLimit ?? 5,
    },
    recommendationSource(referenceFmIds),
    ageAsOfDate
  );

  return JSON.stringify(result);
};

const recommendTeamPlayersFixture: RecommendTeamPlayerCandidates = async (
  input: RecommendTeamPlayerCandidatesInput,
  ageAsOfDate
) => {
  await recordTestEvent("team-recommendation");

  const rosterFmIds = input.roster.members.flatMap((member) =>
    member.fmId === null ? [] : [member.fmId]
  );

  const referenceFmIds =
    input.referenceMode === "squad" ? rosterFmIds : input.referenceFmIds;

  const calculation = recommendTeamPlayers(
    {
      excludeFmIds: rosterFmIds,
      includePotential: input.includePotential,
      maxAge: input.maxAge,
      minimumCurrentAbility: input.minimumCurrentAbility,
      minimumPotentialAbility: input.minimumPotentialAbility,
      position: input.position,
      referenceFmIds,
      resultLimit: input.resultLimit ?? 5,
    },
    recommendationSource(referenceFmIds),
    ageAsOfDate
  );

  if (calculation.status === "team_position_unavailable") {
    throw new Error("The persistence fixture position should be available.");
  }

  const { recommendation } = calculation;

  if (!("filters" in recommendation)) {
    throw new Error("The persistence fixture recommendation should be ranked.");
  }

  const rosterCoverage = teamRosterCoverage(input.roster);

  return JSON.stringify({
    filters: {
      includePotential: input.includePotential,
      maxAge: input.maxAge,
      minimumCurrentAbility: input.minimumCurrentAbility,
      minimumPotentialAbility: input.minimumPotentialAbility,
      resultLimit: input.resultLimit ?? 5,
    },
    fmSnapshotDate: recommendation.snapshotDate,
    position: input.position,
    rankingBasis: "equal_weight_mean_of_position_capable_squad_profiles",
    recommendation,
    referenceFmIds: calculation.referenceFmIds,
    roster: {
      ...rosterCoverage,
      retrievedAt: input.roster.retrievedAt,
      source: "API-Football",
    },
    status: recommendation.status,
    team: input.team,
  });
};

const searchTeams: ApiFootballClient["searchTeams"] = async (query) => {
  if (query === outageTeamName) {
    await recordTestEvent("team-search-failure");

    return {
      message: "The fixture provider is temporarily unavailable.",
      reason: "provider",
      status: "error",
      statusCode: 503,
    };
  }

  await recordTestEvent("team-search");

  return { data: [team], status: "ok" };
};

const getSquad: ApiFootballClient["getSquad"] = async () => {
  await recordTestEvent("team-roster");

  return {
    data: {
      players: [rosterPlayer],
      retrievedAt: "2026-11-07T00:00:00.000Z",
      team,
    },
    status: "ok",
  };
};

const teamRosterIdentityLookup: TeamRosterIdentityLookup = async () => {
  await recordTestEvent("roster-identity");

  return {
    candidate: {
      birthDate: "1993-07-28",
      currentAbility: 165,
      fmId: "fm-kane",
      name: kaneName,
      naturalPositions: "STC",
      potentialAbility: 170,
    },
    method: "reep_bridge",
    status: "resolved",
  };
};

const agent = createAgent({
  playerIdentityLookup,
  requestUnderstandingExtractor,
  teamDirectory: { getSquad, searchTeams },
  teamRosterIdentityLookup,
  tools: createTools(
    playerSearch,
    recommendPlayersFixture,
    recommendTeamPlayersFixture,
    "2026-11-07"
  ),
});

export { agent };
