import { createHash } from "node:crypto";
import type { PlayerProfile } from "../../domain/players.js";
import type { PlayerIdentityCandidate, PlayerIdentityContext } from "../../domain/player-identity.js";
import { normalizeSearchText } from "../../domain/text-matching.js";
import { throwIfAborted } from "../../domain/abort.js";
import type { PlayerRepository } from "../repository.js";
import type { PlayerNameResolver, PlayerNameResolution } from "./name-resolver.js";
import type { NameEvidenceStore } from "./name-evidence-store.js";
import { selectablePositionLabels } from "../../domain/position-selection.js";
import { PositionSchema } from "../../domain/position-contracts.js";
import { positionMatches } from "../../domain/positions.js";
import { teamNamesMatch } from "../../domain/team-names.js";

export type PlayerNameVariantGenerator = (mention: string, context: PlayerIdentityContext, signal?: AbortSignal) => Promise<string[]>;

export function identityRecordKey(player: PlayerProfile): string {
  const profile = player.abilityProfile;
  return profile ? `fm:${profile.snapshotId.slice(0, 12)}:${profile.recordId}` : player.playerId;
}

function localCandidate(player: PlayerProfile, match: PlayerIdentityCandidate["match"]): PlayerIdentityCandidate {
  const recordId = identityRecordKey(player);
  const positions = player.abilityProfile ? Object.entries(player.abilityProfile.positions).filter(([, rating]) => rating !== undefined && rating >= 15).map(([position]) => position) : [player.position];
  return {
    entityId: `local:${createHash("sha256").update(recordId).digest("hex")}`,
    recordIds: [recordId], preferredName: player.name, names: [...new Set([player.name, ...(player.abilityProfile?.aliases ?? [])])], match,
    ...(player.birthDate ? { birthDate: player.birthDate } : {}),
    description: [player.birthDate ? `${player.birthDate.slice(0, 4)} 年出生` : null, positions.map(position => `${position} ${selectablePositionLabels[position as keyof typeof selectablePositionLabels] ?? ""}`).join(" / "),
      player.team ? `${player.team}（${player.season || "来源记录"}）` : "现有效力未核实"].filter(Boolean).join(" · "),
  };
}

function candidatesOf(result: PlayerNameResolution): PlayerIdentityCandidate[] {
  return result.status === "resolved" ? [result.player] : result.status === "ambiguous" || result.status === "needs_confirmation" ? result.candidates : [];
}

/** One resolver owns recall, safe confirmation and evidence reuse. It never invents a person from a model suggestion. */
export function createPlayerIdentityResolver(options: {
  repository: Pick<PlayerRepository, "findLocalPlayersByNames" | "findPlayersByNames">;
  external: PlayerNameResolver;
  variants?: PlayerNameVariantGenerator;
  store?: NameEvidenceStore;
}): PlayerNameResolver {
  const confirmationScope = (context: PlayerIdentityContext) => context.scopeId ? `${context.scopeId}:${createHash("sha256")
    .update(JSON.stringify((context.clues ?? []).map(clue => [clue.kind, normalizeSearchText(clue.value)]).sort())).digest("hex")}` : "";
  const local = async (names: readonly string[], signal?: AbortSignal) => options.repository.findLocalPlayersByNames?.(names, signal) ?? [];
  const bind = async (candidate: PlayerIdentityCandidate, signal?: AbortSignal): Promise<PlayerIdentityCandidate> => {
    let records = await local([candidate.preferredName], signal);
    if (!records.length) records = await local(candidate.names, signal);
    if (!records.length && options.repository.findPlayersByNames) {
      try { records = await options.repository.findPlayersByNames([candidate.preferredName], signal); }
      catch { throwIfAborted(signal); }
    }
    records = records.filter(player => !candidate.birthDate || !player.birthDate || player.birthDate === candidate.birthDate);
    const known = options.repository.findLocalPlayersByNames || options.repository.findPlayersByNames;
    return { ...candidate, ...(known ? { recordIds: records.length === 1 ? records.map(identityRecordKey) : [] } : {}) };
  };
  const localCluesSupported = (player: PlayerProfile, context: PlayerIdentityContext) => (context.clues ?? []).every(clue => {
    if (clue.kind === "team") return Boolean(player.team && teamNamesMatch(player.team, clue.value));
    if (clue.kind !== "position") return false;
    const requested = PositionSchema.safeParse(clue.value);
    if (!requested.success) return false;
    const positions = player.abilityProfile ? Object.entries(player.abilityProfile.positions).filter(([, value]) => value !== undefined && value >= 15).map(([position]) => position) : [player.position];
    return positions.some(position => { const parsed = PositionSchema.safeParse(position); return parsed.success && positionMatches(parsed.data, requested.data); });
  });
  const choose = (mention: string, candidates: PlayerIdentityCandidate[], context: PlayerIdentityContext): PlayerNameResolution => {
    const unique = [...new Map(candidates.filter(candidate => !context.excludedIds?.includes(candidate.entityId)
      && !candidate.recordIds?.some(id => context.excludedRecordIds?.includes(id))).map(candidate => [candidate.entityId, candidate])).values()];
    // Explicit clues rank choices; they cannot transform a guessed name into proof.
    const clues = context.clues ?? [];
    const score = (candidate: PlayerIdentityCandidate) => clues.reduce((sum, clue) => sum + Number(normalizeSearchText(candidate.description ?? "").includes(normalizeSearchText(clue.value))), 0);
    unique.sort((a, b) => score(b) - score(a));
    return unique.length ? { status: unique.length === 1 ? "needs_confirmation" : "ambiguous", mention, candidates: unique.slice(0, 5) } : { status: "unresolved", mention };
  };
  const resolve: PlayerNameResolver = async (mention, signal, context = {}) => {
    throwIfAborted(signal);
    const exactLocal = (await local([mention], signal)).filter(player => !context.excludedRecordIds?.includes(identityRecordKey(player)));
    throwIfAborted(signal);
    const exact = exactLocal.map(player => localCandidate(player, "local_exact"));
    if (!context.forceRecheck && !context.excludedIds?.length && exact.length === 1 && normalizeSearchText(exact[0]!.preferredName) === normalizeSearchText(mention) && localCluesSupported(exactLocal[0]!, context)) {
      return { status: "resolved", mention, player: exact[0]!, resolutionMethod: "local_exact" };
    }
    if (!context.forceRecheck && exact.length === 1 && normalizeSearchText(exact[0]!.preferredName) !== normalizeSearchText(mention)) return choose(mention, exact, context);
    if (!context.forceRecheck && exact.length > 1) return choose(mention, exact, context);

    const remembered = (options.store?.lookup(mention) ?? []).filter(entry => !context.excludedIds?.includes(entry.player.entityId)
      && !entry.player.recordIds?.some(id => context.excludedRecordIds?.includes(id)));
    const verified = remembered.filter(entry => entry.kind === "verified");
    const scoped = remembered.filter(entry => entry.kind === "confirmation" && entry.scopeId === confirmationScope(context));
    if (!context.forceRecheck && !context.queryHint && verified.length > 1) return choose(mention, remembered.map(entry => entry.player), context);
    if (!context.forceRecheck && !context.queryHint && verified.length === 1 && !remembered.some(entry => entry.player.entityId !== verified[0]!.player.entityId)
      && (context.clues ?? []).every(clue => normalizeSearchText(verified[0]!.player.description ?? "").includes(normalizeSearchText(clue.value)))) {
      const cached = await bind(verified[0]!.player, signal);
      if ((context.clues ?? []).some(clue => !normalizeSearchText(cached.description ?? "").includes(normalizeSearchText(clue.value)))) return choose(mention, [cached], context);
      return { status: "resolved", mention, player: cached, resolutionMethod: "verified_alias" };
    }
    if (!context.forceRecheck && !context.queryHint && scoped.length === 1) return { status: "resolved", mention, player: scoped[0]!.player, resolutionMethod: "user_confirmed" };
    if (!context.forceRecheck && !context.queryHint && !context.clues?.length && remembered.length) {
      return choose(mention, remembered.map(entry => ({ ...entry.player, match: "previous_confirmation" })), context);
    }

    const external = await options.external(mention, signal, context);
    throwIfAborted(signal);
    if (external.status === "resolved") {
      const player = await bind(external.player, signal);
      if (!context.forceRecheck && (context.clues ?? []).some(clue => !normalizeSearchText(external.player.description ?? "").includes(normalizeSearchText(clue.value)))) {
        return choose(mention, [...exact, player], context);
      }
      if (!context.forceRecheck && !context.excludedIds?.includes(player.entityId) && !player.recordIds?.some(id => context.excludedRecordIds?.includes(id))) {
        options.store?.remember(mention, player, "verified", "");
        return { ...external, player };
      }
    }
    const candidates = [...exact, ...remembered.map(entry => ({ ...entry.player, match: "previous_confirmation" as const })),
      ...await Promise.all(candidatesOf(external).map(candidate => bind(candidate, signal)))];
    for (const lead of (external.nameLeads ?? []).slice(0, 3)) {
      for (const record of await local([lead.name], signal)) {
        if (!candidates.some(candidate => candidate.recordIds?.includes(identityRecordKey(record)))) candidates.push(localCandidate(record, "web_corroborated"));
      }
    }
    if (candidates.length && !context.forceRecheck) {
      const selected = choose(mention, candidates, context);
      if (selected.status !== "unresolved") return selected;
    }
    let unavailable = external.status === "unavailable" ? external : null;
    if (options.variants) {
      let variants: string[] = [];
      try { variants = await options.variants(mention, context, signal); }
      catch { throwIfAborted(signal); unavailable = { status: "unavailable", mention, source: "model", retryable: true }; }
      for (const name of [...new Set(variants)].filter(name => name.trim() && name.length <= 100).slice(0, 3)) {
        throwIfAborted(signal);
        const records = await local([name], signal);
        if (records.length) candidates.push(...records.map(player => localCandidate(player, "model_suggestion")));
        else {
          const lead = await options.external(name, signal, context);
          if (lead.status === "unavailable") unavailable = { ...lead, mention };
          candidates.push(...await Promise.all(candidatesOf(lead).map(candidate => bind(candidate, signal))));
        }
      }
    }
    throwIfAborted(signal);
    if (candidates.length) return choose(mention, candidates, context);
    return unavailable ?? (external.status === "resolved" ? { status: "unresolved", mention } : external);
  };
  resolve.rememberConfirmation = (mention, player, context) => {
    if (context.scopeId) options.store?.remember(mention, player, "confirmation", confirmationScope(context));
  };
  return resolve;
}
