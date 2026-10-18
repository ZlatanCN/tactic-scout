import type { PlayerProfile } from "../../domain/players.js";
import type { Position } from "../../domain/position-contracts.js";
import { throwIfAborted } from "../../domain/abort.js";
import { inspectTeamPlayers, loadComparisonPlayers, loadPlayersByIds, type PlayerRepository } from "../../players/repository.js";
import { searchLoadedPlayers, type PlayerSearchPage, type PlayerSearchQuery } from "../../players/search.js";
import type { ReepIdentityRegistry } from "../../players/identity/reep-registry.js";
import { normalizeFmName, type FmPositionKey } from "./profile.js";
import { FmProfileRepository } from "./repository.js";
import { ageAtDate, FmPositionMapping, toAbilityProfile, toStandalonePlayer } from "./player-adapter.js";
import { FmRoleTemplates, type FmRoleId } from "./role-fit.js";
import { AbilityMetricDefinitions } from "../../domain/player-abilities.js";
import { playerPositionMatches, positionMatches } from "../../domain/positions.js";

export type ProfileEvidenceMode = "combined" | "performance_only" | "ability_only";

/** Scoped union of performance records and ability profiles; source IDs are joined only by verified bridges. */
export class FusedPlayerRepository implements PlayerRepository {
  readonly supportsCompetitionExclusions = true;
  readonly mode;
  readonly sourceName;
  readonly supportsAbilityProfiles;
  readonly getDatasetStatus?: PlayerRepository["getDatasetStatus"];
  readonly inspectPlayer?: PlayerRepository["inspectPlayer"];
  readonly inspectCandidateGroup?: PlayerRepository["inspectCandidateGroup"];
  readonly inspectTeamDetails?: PlayerRepository["inspectTeamDetails"];
  readonly inspectMatch?: PlayerRepository["inspectMatch"];
  private readonly enriched = new WeakMap<PlayerProfile, PlayerProfile>();
  constructor(private readonly base: PlayerRepository, private readonly profiles: FmProfileRepository,
    private readonly registry?: ReepIdentityRegistry, private readonly evidenceMode: ProfileEvidenceMode = "combined",
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10)) {
    this.mode = base.mode;
    this.supportsAbilityProfiles = evidenceMode !== "performance_only";
    this.sourceName = evidenceMode === "performance_only" ? base.sourceName : `${base.sourceName} · 球员能力画像`;
    if (base.getDatasetStatus) this.getDatasetStatus = base.getDatasetStatus.bind(base);
    if (evidenceMode !== "ability_only") {
      this.inspectPlayer = base.inspectPlayer?.bind(base);
      this.inspectCandidateGroup = base.inspectCandidateGroup?.bind(base);
      this.inspectTeamDetails = base.inspectTeamDetails?.bind(base);
      this.inspectMatch = base.inspectMatch?.bind(base);
    }
    if (profiles.manifest.genderScope !== "male_confirmed") throw new Error("FM dataset requires recorded confirmation of male-only scope.");
  }

  private enrich(player: PlayerProfile, signal?: AbortSignal): PlayerProfile {
    throwIfAborted(signal);
    if (this.evidenceMode !== "combined" || !this.registry || !player.sourceIdentity) return player;
    const cached = this.enriched.get(player);
    if (cached) return cached;
    const identity = player.sourceIdentity;
    const identifiers = [...new Set((identity.providerIdentifiers ?? []).filter((id) => id.provider === identity.provider && id.namespace === "player").map((id) => id.externalId))];
    if (identifiers.length > 1) return player;
    const source = this.registry.resolveSourceProvider(identity.provider, identifiers[0] ?? identity.playerId);
    if (source.status !== "resolved") return player;
    const ids = [...new Set(source.linkedBridges.filter((bridge) => bridge.provider === "fm" && bridge.namespace === "player").map((bridge) => bridge.externalId))];
    if (ids.length !== 1) return player;
    const reverse = this.registry.resolveExact("fm", "player", ids[0]!);
    if (reverse.status !== "resolved" || reverse.reepId !== source.reepId) return player;
    const matches = this.profiles.getByUniqueId(ids[0]!, signal);
    if (matches.length !== 1) return player;
    const profile = matches[0]!;
    if (player.birthDate && profile.birthDate && player.birthDate !== profile.birthDate) return player;
    const abilityProfile = toAbilityProfile(profile, this.profiles.manifest, {
      method: "verified_bridge", evidence: `Reep:${source.releaseStamp}:${source.reepId}:${identity.provider}:${identity.playerId}:fm:${ids[0]}`,
    });
    const result = {
      ...player, abilityProfile,
      ...(player.age === null && profile.birthDate ? { age: ageAtDate(profile.birthDate, this.today()), ageSource: "birth_date", ageVerifiedAt: this.today() } : {}),
      ...(profile.birthDate ? { birthDate: profile.birthDate } : {}),
    };
    this.enriched.set(player, result);
    return result;
  }

  private async performancePlayers(signal?: AbortSignal): Promise<PlayerProfile[]> {
    if (this.evidenceMode === "ability_only") return [];
    throwIfAborted(signal);
    if (!this.base.loadPlayers) throw new Error("Combined profile search requires the configured source's catalog loader.");
    return (await this.base.loadPlayers(false, signal)).map((player) => this.enrich(player, signal));
  }

  async searchCandidates(query: PlayerSearchQuery, signal?: AbortSignal): Promise<PlayerSearchPage> {
    const performance = await this.performancePlayers(signal);
    const basePage = searchLoadedPlayers(performance, { ...query, offset: 0, limit: performance.length || 1 });
    if (this.evidenceMode === "performance_only") return searchLoadedPlayers(performance, query);
    // A profile has no competition, season or match minutes: those explicit constraints require a performance record.
    const profileAllowed = query.minimumMinutes === 0 && !query.competition && !query.season && !query.excludedCompetitions?.length;
    const requestedPositions = query.positions?.length ? query.positions : query.position ? [query.position] : [];
    // Keep family-level leads available, but spend the first page on confirmed positions.
    if (requestedPositions.length) basePage.players.sort((left, right) =>
      Number(requestedPositions.some((position) => playerPositionMatches(right, position)))
      - Number(requestedPositions.some((position) => playerPositionMatches(left, position))));
    if (query.referenceRoles) {
      const reference = query.referenceRoles;
      const distance = (player: PlayerProfile) => {
        if (player.abilityProfile?.snapshotId !== reference.snapshotId) return Infinity;
        const targets = Object.entries(reference.values);
        if (!targets.length) return Infinity;
        return targets.reduce((sum, [role, value]) => {
          const observed = player.abilityProfile!.roles.find(item => item.role === role && item.positionCompatible && item.fit !== null);
          return sum + (observed ? Math.abs(observed.searchPriority - value) : 100);
        }, 0) / targets.length;
      };
      basePage.players.sort((left, right) => {
        const qualification = requestedPositions.length ? Number(requestedPositions.some(position => playerPositionMatches(right, position)))
          - Number(requestedPositions.some(position => playerPositionMatches(left, position))) : 0;
        return qualification || distance(left) - distance(right) || left.playerId.localeCompare(right.playerId);
      });
    }
    const fmPositions = (Object.entries(FmPositionMapping) as Array<[FmPositionKey, Position]>).filter(([, position]) => requestedPositions.some((requested) => positionMatches(position, requested))).map(([key]) => key);
    const requestedRoles = [...new Set((query.discoveryMetricGroups ?? []).flat().flatMap((key) => {
      const definition = AbilityMetricDefinitions.find((definition) => definition.key === key);
      return definition ? [definition.role as FmRoleId] : [];
    }))];
    const roles = requestedRoles.filter((role) => !fmPositions.length || FmRoleTemplates[role].positions.some((position) => fmPositions.includes(position)));
    const after = new Date(`${this.today()}T00:00:00Z`);
    if (query.maxAge !== null) after.setUTCFullYear(after.getUTCFullYear() - query.maxAge - 1);
    const fmQuery = {
      ...(fmPositions.length ? { positions: fmPositions } : {}), roles,
      ...(query.referenceRoles && query.referenceRoles.snapshotId === this.profiles.manifest.sha256 ? { referenceRoles: query.referenceRoles.values } : {}),
      playerName: query.playerName, ...(query.maxAge !== null ? { bornAfter: after.toISOString().slice(0, 10) } : {}),
      excludeRecordIds: [...new Set(performance.flatMap((player) => player.abilityProfile ? [player.abilityProfile.recordId] : []))],
      offset: 0, limit: 1,
    };
    const profileTotal = profileAllowed ? this.profiles.searchCatalog(fmQuery, signal).total : 0;
    const baseTotal = basePage.players.length;
    const total = baseTotal + profileTotal;
    // Round-robin the two recall lanes, then continue the remaining lane. Offsets address the full union.
    const indices: Array<{ lane: "performance" | "profile"; index: number }> = [];
    const shared = Math.min(baseTotal, profileTotal);
    for (let index = query.offset; index < Math.min(total, query.offset + query.limit); index++) {
      if (index < shared * 2) indices.push({ lane: index % 2 === 0 ? "performance" : "profile", index: Math.floor(index / 2) });
      else indices.push({ lane: baseTotal > profileTotal ? "performance" : "profile", index: index - shared });
    }
    const profileIndices = indices.filter((item) => item.lane === "profile").map((item) => item.index);
    const start = profileIndices[0] ?? 0;
    const profilePage = profileIndices.length ? this.profiles.searchCatalog({ ...fmQuery, offset: start, limit: profileIndices.length }, signal).players : [];
    const players = indices.map((item) => item.lane === "performance" ? basePage.players[item.index]!
      : toStandalonePlayer(profilePage[item.index - start]!, this.profiles.manifest, this.today()));
    const discoveryKeys = [...new Set([...(basePage.discovery?.metricKeys ?? []),
      ...(profileTotal > 0 ? AbilityMetricDefinitions.filter((definition) => roles.includes(definition.role)).map((definition) => definition.key) : [])])];
    throwIfAborted(signal);
    return { players, totalRecords: total, offset: query.offset, nextOffset: query.offset + players.length < total ? query.offset + players.length : null,
      appliedFilters: basePage.appliedFilters, ...(basePage.discovery ? { discovery: { ...basePage.discovery,
        strategy: discoveryKeys.length ? "metric_cohort_round_robin" : "cohort_sample", metricKeys: discoveryKeys, populationRecords: total } } : {}) };
  }

  async findLocalPlayersByNames(names: readonly string[], signal?: AbortSignal): Promise<PlayerProfile[]> {
    throwIfAborted(signal);
    if (this.evidenceMode === "performance_only") return [];
    const profiles = [...new Map(names.flatMap(name => this.profiles.lookupName(name, signal)).map(profile => [profile.recordId, profile])).values()];
    return profiles.map(profile => toStandalonePlayer(profile, this.profiles.manifest, this.today()));
  }

  async findPlayersByNames(names: readonly string[], signal?: AbortSignal): Promise<PlayerProfile[]> {
    const wanted = new Set(names.map(normalizeFmName));
    const performance = (await this.performancePlayers(signal)).filter((player) => [player.name, ...(player.abilityProfile?.aliases ?? [])]
      .some((name) => wanted.has(normalizeFmName(name))));
    if (this.evidenceMode === "performance_only") return performance;
    const profiles = [...new Map(names.flatMap((name) => this.profiles.lookupName(name, signal)).map((profile) => [profile.recordId, profile])).values()];
    const linked = new Set(performance.flatMap((player) => player.abilityProfile ? [player.abilityProfile.recordId] : []));
    return [...performance, ...profiles.filter((profile) => !linked.has(profile.recordId)).map((profile) => toStandalonePlayer(profile, this.profiles.manifest, this.today()))];
  }

  async inspectTeam(teamName: string, signal?: AbortSignal): Promise<PlayerProfile[]> {
    return this.evidenceMode === "ability_only" ? [] : (await inspectTeamPlayers(this.base, teamName, signal)).map((player) => this.enrich(player, signal));
  }

  async getPlayersByIds(ids: readonly string[], signal?: AbortSignal): Promise<PlayerProfile[]> {
    const prefix = `fm:${this.profiles.manifest.sha256.slice(0, 12)}:`;
    const own = ids.flatMap((id) => {
      if (!id.startsWith(prefix) || this.evidenceMode === "performance_only") return [];
      const profile = this.profiles.getByRecordId(id.slice(prefix.length), signal);
      return profile ? [toStandalonePlayer(profile, this.profiles.manifest, this.today())] : [];
    });
    const others = this.evidenceMode === "ability_only" ? [] : await loadPlayersByIds(this.base, ids.filter((id) => !id.startsWith(prefix)), signal);
    return [...others.map((player) => this.enrich(player, signal)), ...own];
  }

  async getComparisonPlayers(players: readonly PlayerProfile[], signal?: AbortSignal): Promise<PlayerProfile[]> {
    if (this.evidenceMode === "ability_only") return [];
    return (await loadComparisonPlayers(this.base, players.filter((player) => player.sourceIdentity?.provider !== "fm"), signal)).map((player) => this.enrich(player, signal));
  }

  close(): void { this.profiles.close(); this.registry?.close(); this.base.close?.(); }
}
