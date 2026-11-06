import { comparisonResult } from "./workflow-results.js";

type PlayerReference = {
  candidate: {
    candidateId: string;
    canonicalIdentityId: string | null;
    exactNameMatch: boolean;
    identityBasis: "source_record";
    identityVerified: boolean;
    name: string;
    records: {
      canonicalIdentityId: string | null;
      competition: string | null;
      identityVerified: boolean;
      name: string;
      provider: "fm";
      season: string | null;
      sourceId: string;
      team: string | null;
    }[];
  };
  referenceId: string;
};

type ConversationContext = {
  activeComparison: {
    constraints: never[];
    players: PlayerReference[];
    resultJson: string;
  };
  activeLookup: { player: PlayerReference; resultJson: string };
  activeRecommendation: {
    excludePlayers: PlayerReference[];
    includePotential: boolean;
    maxAge: number | null;
    minimumCurrentAbility: number | null;
    minimumPotentialAbility: number | null;
    position: string;
    referencePlayers: PlayerReference[];
    resultJson: string;
    resultLimit: number;
    status: "ready";
  };
  activeTeamRecommendation: {
    includePotential: boolean;
    maxAge: number | null;
    minimumCurrentAbility: number | null;
    minimumPotentialAbility: number | null;
    position: string;
    referenceMode: "squad";
    referencePlayers: PlayerReference[];
    resultJson: string;
    resultLimit: number;
    roster: {
      members: {
        apiFootballPlayerId: number;
        fmCandidates: { fmId: string; name: string }[];
        fmId: string;
        mappingMethod: "user_confirmation";
        mappingStatus: "resolved";
        name: string;
        position: string;
      }[];
      retrievedAt: string;
      team: { country: string; id: number; name: string };
    };
    status: "ready";
    team: { country: string; id: number; name: string };
  };
  focusPlayers: PlayerReference[];
  playerAliases: { mention: string; reference: PlayerReference }[];
};

const playerReference = (
  candidateId: string,
  name: string
): PlayerReference => ({
  candidate: {
    candidateId,
    canonicalIdentityId: null,
    exactNameMatch: true,
    identityBasis: "source_record",
    identityVerified: false,
    name,
    records: [
      {
        canonicalIdentityId: null,
        competition: null,
        identityVerified: false,
        name,
        provider: "fm",
        season: null,
        sourceId: candidateId,
        team: null,
      },
    ],
  },
  referenceId: `thread:${candidateId}`,
});

const savedConversationContext = (
  kane: PlayerReference,
  haaland: PlayerReference
): ConversationContext => {
  const team = { country: "England", id: 541, name: "Test Club" };

  const roster = {
    members: [
      {
        apiFootballPlayerId: 10,
        fmCandidates: [],
        fmId: kane.candidate.candidateId,
        mappingMethod: "user_confirmation" as const,
        mappingStatus: "resolved" as const,
        name: kane.candidate.name,
        position: "Attacker",
      },
    ],
    retrievedAt: "2026-11-06T00:00:00.000Z",
    team,
  };

  return {
    activeComparison: {
      constraints: [],
      players: [kane, haaland],
      resultJson: comparisonResult(
        [kane.candidate.name, haaland.candidate.name],
        "ready"
      ),
    },
    activeLookup: {
      player: kane,
      resultJson: '{"player":"Harry Kane","fmSnapshotDate":"2025-11-23"}',
    },
    activeRecommendation: {
      excludePlayers: [],
      includePotential: false,
      maxAge: null,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: "stc",
      referencePlayers: [kane],
      resultJson: '{"status":"ready","snapshotDate":"2025-11-23"}',
      resultLimit: 1,
      status: "ready",
    },
    activeTeamRecommendation: {
      includePotential: false,
      maxAge: null,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: "stc",
      referenceMode: "squad",
      referencePlayers: [],
      resultJson:
        '{"status":"ready","fmSnapshotDate":"2025-11-23","retrievedAt":"2026-11-06T00:00:00.000Z"}',
      resultLimit: 1,
      roster,
      status: "ready",
      team,
    },
    focusPlayers: [kane],
    playerAliases: [{ mention: "凯恩", reference: kane }],
  };
};

export { playerReference, savedConversationContext };

export type { ConversationContext, PlayerReference };
