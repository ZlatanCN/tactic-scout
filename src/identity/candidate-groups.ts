import type { CandidateIdentityCoverage, CandidateIdentityResolutionStatus, PlayerProfile } from "../domain/schemas.js";
import { sourcePlayerKey } from "./source-player-key.js";
import type { ReepIdentityResolution, ReepResolutionStatus } from "./reep-registry.js";

export interface CandidateIdentityResolver {
  resolveSourceProvider(provider: string, externalId: string): Pick<ReepIdentityResolution, "status" | "releaseStamp" | "reepId">;
}

export type CandidateIdentityGroupStatus = ReepResolutionStatus | "registry_unavailable" | "missing_source_identity";

export interface CandidateIdentityGroup {
  identityKey: string;
  status: CandidateIdentityGroupStatus;
  registryAvailable: boolean;
  reepId: string | null;
  releaseStamp: string | null;
  records: PlayerProfile[];
}

export interface CandidateIdentityGroupReference {
  identityKey: string;
  status: CandidateIdentityResolutionStatus;
  registryAvailable: boolean;
  reepId: string | null;
  releaseStamp: string | null;
  recordPlayerIds: string[];
}

function exactSourcePlayerId(sourceIdentity: NonNullable<PlayerProfile["sourceIdentity"]>): string | null {
  // Some providers expose a scoped record key and the exact player ID separately.
  const identifiers = [...new Set((sourceIdentity.providerIdentifiers ?? [])
    .filter(({ provider, namespace }) => provider === sourceIdentity.provider && namespace === "player")
    .map(({ externalId }) => externalId))];
  if (identifiers.length > 1) return null;
  return identifiers[0] ?? sourceIdentity.playerId;
}

export function toCandidateIdentityGroupReferences(groups: readonly CandidateIdentityGroup[]): CandidateIdentityGroupReference[] {
  return groups.map((group) => ({
    identityKey: group.identityKey,
    status: group.status,
    registryAvailable: group.registryAvailable,
    reepId: group.reepId,
    releaseStamp: group.releaseStamp,
    recordPlayerIds: group.records.map(({ playerId }) => playerId),
  }));
}

export function summarizeCandidateIdentityGroupReferences(
  groups: readonly CandidateIdentityGroupReference[],
): CandidateIdentityCoverage {
  const resolutionStatusCounts = new Map<CandidateIdentityResolutionStatus, number>();
  for (const group of groups) resolutionStatusCounts.set(group.status, (resolutionStatusCounts.get(group.status) ?? 0) + 1);
  const resolvedGroups = groups.filter(({ status, reepId }) => status === "resolved" && reepId !== null);
  const resolvedSourceRecordCount = resolvedGroups.reduce((count, { recordPlayerIds }) => count + recordPlayerIds.length, 0);
  const sourceRecordCount = groups.reduce((count, { recordPlayerIds }) => count + recordPlayerIds.length, 0);
  const releaseStamps = [...new Set(groups.flatMap(({ registryAvailable, releaseStamp }) => registryAvailable && releaseStamp ? [releaseStamp] : []))];
  return {
    registryAvailable: groups.length > 0 && groups.every(({ registryAvailable }) => registryAvailable),
    releaseStamp: releaseStamps.length === 1 ? releaseStamps[0]! : null,
    sourceRecordCount,
    resolvedIdentityCount: resolvedGroups.length,
    resolvedSourceRecordCount,
    unresolvedSourceRecordCount: sourceRecordCount - resolvedSourceRecordCount,
    resolutionStatusCounts: [...resolutionStatusCounts.entries()].map(([status, count]) => ({ status, count })),
  };
}

/**
 * Groups source records only when the configured resolver confirms one exact,
 * usable canonical Reep ID. Every input profile remains attached to its group;
 * unresolved profiles stay keyed by their own provider record identity.
 */
export function groupCandidatesByExactIdentity(
  records: readonly PlayerProfile[],
  resolver?: CandidateIdentityResolver,
): CandidateIdentityGroup[] {
  const groups = new Map<string, CandidateIdentityGroup>();

  for (const record of records) {
    const sourceIdentity = record.sourceIdentity;
    const exactPlayerId = sourceIdentity ? exactSourcePlayerId(sourceIdentity) : undefined;
    const resolution = sourceIdentity && typeof exactPlayerId === "string"
      ? resolver?.resolveSourceProvider(sourceIdentity.provider, exactPlayerId)
      : undefined;
    const resolvedReepId = resolution?.status === "resolved" ? resolution.reepId : undefined;
    const isResolved = typeof resolvedReepId === "string" && resolvedReepId.length > 0;
    const identityKey = isResolved ? `reep:${resolvedReepId}` : `source:${sourcePlayerKey(record)}`;
    const status: CandidateIdentityGroupStatus = !sourceIdentity
      ? "missing_source_identity"
      : !resolver
        ? "registry_unavailable"
        : exactPlayerId === null
          ? "ambiguous"
        : resolution?.status ?? "not_found";
    const group = groups.get(identityKey);

    if (group) {
      if (!group.records.some(({ playerId }) => playerId === record.playerId)) group.records.push(record);
      continue;
    }

    groups.set(identityKey, {
      identityKey,
      status: isResolved ? "resolved" : status,
      registryAvailable: Boolean(resolver),
      reepId: isResolved ? resolvedReepId! : null,
      releaseStamp: resolution?.releaseStamp ?? null,
      records: [record],
    });
  }

  return [...groups.values()];
}
