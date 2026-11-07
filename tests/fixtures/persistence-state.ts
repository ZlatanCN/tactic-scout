import { comparisonResultSchema } from "../../src/player-data/compare-records.js";
import type { AgentStateType } from "../../src/state.js";
import { teamRecommendationResultSchema } from "../../src/team-data/recommendation-result.js";
import type { ThreadState } from "./langgraph-dev-server.js";
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

const clarificationDetails = (state: ThreadState) => ({
  hasInterrupt: state.tasks.some((task) => (task.interrupts?.length ?? 0) > 0),
  question: state.values.pendingClarification?.question ?? null,
});

const workflowSnapshots = (state: ThreadState) => ({
  activeComparison: state.values.conversationContext.activeComparison,
  activeLookup: state.values.conversationContext.activeLookup,
  activeRecommendation: state.values.conversationContext.activeRecommendation,
  activeTeamRecommendation:
    state.values.conversationContext.activeTeamRecommendation,
});

const teamRecommendationConditions = (state: ThreadState) => ({
  constraints: state.values.request.constraints,
  filters: {
    includePotential: state.values.request.teamRecommendation?.includePotential,
    maxAge: state.values.request.teamRecommendation?.maxAge,
    minimumCurrentAbility:
      state.values.request.teamRecommendation?.minimumCurrentAbility,
    minimumPotentialAbility:
      state.values.request.teamRecommendation?.minimumPotentialAbility,
    position: state.values.request.teamRecommendation?.position,
    resultLimit: state.values.request.teamRecommendation?.resultLimit,
  },
});

const resumedIdentityFacts = (state: ThreadState) => {
  const comparisonJson =
    state.values.conversationContext.activeComparison?.resultJson ?? "{}";

  const comparison = comparisonResultSchema.parse(JSON.parse(comparisonJson));

  return {
    comparisonPlayers: comparison.players.map((player) => player.playerName),
    outcome: {
      kind: state.values.outcome?.kind,
      resultMatchesComparison:
        state.values.outcome?.resultJson === comparisonJson,
      source: state.values.outcome?.source,
      status: state.values.outcome?.status,
    },
    pending: state.values.pendingClarification,
    resolutionStatus: state.values.request.players?.[0]?.resolution?.status,
  };
};

const resumedRosterFacts = (state: ThreadState) => {
  const result = teamRecommendationResultSchema.parse(
    JSON.parse(state.values.outcome?.resultJson ?? "{}")
  );

  return {
    conditions: teamRecommendationConditions(state),
    fmId: state.values.request.teamRecommendation?.roster?.members[0]?.fmId,
    mappingMethod:
      state.values.request.teamRecommendation?.roster?.members[0]
        ?.mappingMethod,
    outcome: {
      kind: state.values.outcome?.kind,
      source: state.values.outcome?.source,
      status: state.values.outcome?.status,
    },
    pending: state.values.pendingClarification,
    result: {
      fmSnapshotDate: result.fmSnapshotDate,
      retrievedAt: result.roster.retrievedAt,
      status: result.status,
      team: result.team.name,
    },
  };
};

const identityPriorSnapshotsPreserved = (
  before: ThreadState,
  after: ThreadState
) =>
  before.values.conversationContext.activeLookup?.resultJson ===
    after.values.conversationContext.activeLookup?.resultJson &&
  before.values.conversationContext.activeRecommendation?.resultJson ===
    after.values.conversationContext.activeRecommendation?.resultJson &&
  before.values.conversationContext.activeTeamRecommendation?.resultJson ===
    after.values.conversationContext.activeTeamRecommendation?.resultJson;

const rosterPriorSnapshotsPreserved = (
  before: ThreadState,
  after: ThreadState
) =>
  before.values.conversationContext.activeLookup?.resultJson ===
    after.values.conversationContext.activeLookup?.resultJson &&
  before.values.conversationContext.activeComparison?.resultJson ===
    after.values.conversationContext.activeComparison?.resultJson &&
  before.values.conversationContext.activeRecommendation?.resultJson ===
    after.values.conversationContext.activeRecommendation?.resultJson;

const resumedInterruptFacts = (
  identityBefore: ThreadState,
  identityAfter: ThreadState,
  rosterBefore: ThreadState,
  rosterAfter: ThreadState
) => ({
  identity: {
    ...resumedIdentityFacts(identityAfter),
    priorSnapshotsPreserved: identityPriorSnapshotsPreserved(
      identityBefore,
      identityAfter
    ),
  },
  roster: {
    ...resumedRosterFacts(rosterAfter),
    priorSnapshotsPreserved: rosterPriorSnapshotsPreserved(
      rosterBefore,
      rosterAfter
    ),
  },
});

const savedTeamSnapshotOutcome = (
  originalSnapshotJson: string | undefined,
  state: ThreadState
) => {
  const originalSnapshot = teamRecommendationResultSchema.parse(
    JSON.parse(originalSnapshotJson ?? "{}")
  );

  const { outcome } = state.values;

  const reusedSnapshot = teamRecommendationResultSchema.parse(
    JSON.parse(outcome?.resultJson ?? "{}")
  );

  return {
    fmSnapshotDate: reusedSnapshot.fmSnapshotDate,
    kind: outcome?.kind,
    matchesOriginalSnapshot:
      JSON.stringify(reusedSnapshot) === JSON.stringify(originalSnapshot),
    rosterRetrievedAt: reusedSnapshot.roster.retrievedAt,
    source: outcome?.source,
    status: outcome?.status,
  };
};

const activeRecommendationFromState = (state: ThreadState) => {
  const { activeRecommendation } = state.values.conversationContext;

  if (activeRecommendation === null) {
    throw new Error(
      JSON.stringify({
        outcome: state.values.outcome,
        pendingClarification: state.values.pendingClarification,
        request: state.values.request,
      })
    );
  }

  return activeRecommendation;
};

const persistedThreadFacts = (state: AgentStateType) => ({
  conversationContext: {
    activeComparison: state.conversationContext.activeComparison,
    activeLookup: state.conversationContext.activeLookup,
    activeRecommendation: state.conversationContext.activeRecommendation,
    activeTeamRecommendation:
      state.conversationContext.activeTeamRecommendation,
    focusPlayers: state.conversationContext.focusPlayers,
    playerAliases: state.conversationContext.playerAliases,
  },
  faultTolerance: state.faultTolerance,
  messages: state.messages.map((message) => ({
    content: message.content,
    id: message.id,
    type: message.type,
  })),
  outcome: state.outcome,
  pendingClarification: state.pendingClarification,
  request: state.request,
});

export {
  clarificationDetails,
  activeRecommendationFromState,
  persistedThreadFacts,
  playerReference,
  savedConversationContext,
  resumedInterruptFacts,
  savedTeamSnapshotOutcome,
  teamRecommendationConditions,
  workflowSnapshots,
};

export type { ConversationContext, PlayerReference };
