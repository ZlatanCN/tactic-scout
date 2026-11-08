import {
  readFmProfilesBySourceIds,
  readFmRecommendationReferenceMetadata,
  readFmReferenceRecords,
} from "../player-data/football-manager.js";
import { resolveApiFootballPlayerFmIds } from "../player-data/reep-registry.js";
import { createLocalDataError } from "../player-data/shared.js";
import type { TeamFmProfileCandidate } from "./contracts.js";

type TeamRosterIdentityResolution =
  | {
      candidate: TeamFmProfileCandidate;
      method: "reep_bridge" | "user_confirmation";
      status: "resolved";
    }
  | {
      candidates: TeamFmProfileCandidate[];
      status: "needs_confirmation";
    }
  | { status: "no_profile" };

type TeamRosterIdentityLookup = (
  apiFootballPlayerId: number,
  playerName: string
) => TeamRosterIdentityResolution | Promise<TeamRosterIdentityResolution>;

const uniqueProfileCandidates = (
  candidates: TeamFmProfileCandidate[]
): TeamFmProfileCandidate[] => {
  const uniqueCandidates = new Map<string, TeamFmProfileCandidate>();

  for (const candidate of candidates) {
    uniqueCandidates.set(candidate.fmId, candidate);
  }

  return [...uniqueCandidates.values()].toSorted((left, right) =>
    left.fmId.localeCompare(right.fmId)
  );
};

const enrichProfileCandidates = (
  candidates: TeamFmProfileCandidate[]
): TeamFmProfileCandidate[] => {
  const profiles = readFmProfilesBySourceIds(
    candidates.map((candidate) => candidate.fmId)
  );

  if (profiles.status === "unavailable") {
    throw createLocalDataError("Football Manager 本地画像资料无法读取。");
  }

  const profileById = new Map(
    profiles.records.map((profile) => [profile.identitySourceId, profile])
  );

  return candidates.map((candidate) => {
    const profile = profileById.get(candidate.fmId);

    if (profile === undefined) {
      return candidate;
    }

    return {
      ...candidate,
      birthDate: profile.birthDate,
      currentAbility: profile.currentAbility,
      naturalPositions: profile.naturalPositions,
      potentialAbility: profile.potentialAbility,
    };
  });
};

const candidatesFromReepBridge = (
  fmIds: string[]
): TeamRosterIdentityResolution | null => {
  if (fmIds.length === 0) {
    return null;
  }

  const metadata = readFmRecommendationReferenceMetadata(fmIds);

  if (metadata.status === "unavailable") {
    throw createLocalDataError("Football Manager 本地身份资料无法读取。");
  }

  const candidates = enrichProfileCandidates(
    uniqueProfileCandidates(
      metadata.profiles.map(({ fmId, name }) => ({ fmId, name }))
    )
  );

  if (candidates.length === 1) {
    const [candidate] = candidates;

    if (
      candidate !== undefined &&
      metadata.missingReferenceFmIds.length === 0
    ) {
      return { candidate, method: "reep_bridge", status: "resolved" };
    }
  }

  return candidates.length > 0
    ? { candidates, status: "needs_confirmation" }
    : null;
};

const resolveTeamRosterIdentity: TeamRosterIdentityLookup = (
  apiFootballPlayerId,
  playerName
) => {
  const bridge = resolveApiFootballPlayerFmIds(String(apiFootballPlayerId));

  const bridgedProfiles =
    bridge.status === "resolved"
      ? candidatesFromReepBridge(bridge.fmIds)
      : null;

  if (bridgedProfiles !== null) {
    return bridgedProfiles;
  }

  const candidates = enrichProfileCandidates(
    uniqueProfileCandidates(
      readFmReferenceRecords(playerName).map((record) => ({
        fmId: record.sourceId,
        name: record.name,
      }))
    )
  );

  return candidates.length > 0
    ? { candidates, status: "needs_confirmation" }
    : { status: "no_profile" };
};

export { resolveTeamRosterIdentity };

export type { TeamRosterIdentityLookup, TeamRosterIdentityResolution };
