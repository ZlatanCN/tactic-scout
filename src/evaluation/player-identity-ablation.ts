import { createPlayerIdentityResolver } from "../players/identity/player-identity-resolver.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import type { PlayerProfile } from "../domain/players.js";
import type { PlayerIdentityCandidate, PlayerIdentityContext } from "../domain/player-identity.js";
import type { PlayerNameResolver } from "../players/identity/name-resolver.js";

const profile = (playerId: string, name: string, position: PlayerProfile["position"] = "AM"): PlayerProfile => ({
  playerId, name, position, team: "", competition: "", season: "", age: null, birthDate: "2003-08-17", minutes: 0, source: "Synthetic identity study",
  stats: { goals: 0, assists: 0, passesAttempted: 0, passesCompleted: 0, longPasses: 0, carries: 0, pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0, keyPasses: 0 },
});
const entity = (entityId: string, preferredName: string, names: string[], description?: string, birthDate?: string): PlayerIdentityCandidate => ({
  entityId, preferredName, names, sourceUrl: `https://www.wikidata.org/wiki/${entityId}`, match: "exact_alias", description, birthDate,
});
const cherki = profile("cherki", "Rayan Cherki");
const old = entity("Q90001", "Alex Silva", ["Alex Silva"], "1990年代的球员", "1960-01-01");
const outside = entity("Q90002", "Outside Player", ["Outside Player", "库外球星"]);
const wrong = entity("Q90003", "Wrong Player", ["Wrong Player"]);

export const identityAblationScenarios = [
  { id: "local-english-offline", mention: "Rayan Cherki", catalog: [cherki], expectedRecord: "cherki", expectedEntity: "Q64736321" },
  { id: "chinese-name", mention: "切尔基", catalog: [cherki], expectedRecord: "cherki", expectedEntity: "Q64736321" },
  { id: "typo", mention: "切耳基", catalog: [cherki], expectedRecord: "cherki", expectedEntity: "Q64736321" },
  { id: "nickname", mention: "魔笛", catalog: [profile("modric", "Luka Modrić")], expectedRecord: "modric" },
  { id: "namesake-position", mention: "Alex Silva", catalog: [profile("keeper", "Alex Silva", "GK"), profile("midfielder", "Alex Silva", "CM")],
    clues: [{ kind: "position", value: "CM", quote: "踢中前卫的" }], expectedRecord: "midfielder" },
  { id: "historical-namesake", mention: "Alex Silva", catalog: [profile("young", "Alex Silva")],
    clues: [{ kind: "era", value: "1990年代", quote: "1990年代的" }], expectedEntity: old.entityId },
  { id: "outside-catalog", mention: "库外球星", catalog: [], expectedEntity: outside.entityId },
  { id: "popular-wrong-web-lead", mention: "陌生昵称", catalog: [], expectedEntity: "Q99999" },
] satisfies Array<{ id: string; mention: string; catalog: PlayerProfile[]; clues?: NonNullable<PlayerIdentityContext["clues"]>; expectedRecord?: string; expectedEntity?: string }>;

export const identityAblationArms = ["full", "local-off", "model-off", "context-off", "web-off"] as const;

/** Scripted frozen evidence verifies interventions, not live model or web accuracy. */
export async function runPlayerIdentityAblation() {
  const rows = [];
  for (const scenario of identityAblationScenarios) for (const arm of identityAblationArms) {
    let localLookups = 0, modelCalls = 0, externalLookups = 0;
    const fixtureExternal: PlayerNameResolver = async (mention, _signal, context) => {
      if (arm === "web-off") return { status: "unresolved", mention };
      externalLookups++;
      const selected = mention === "库外球星" ? outside : mention === "Alex Silva" && context?.clues?.some(clue => clue.value === "1990年代") ? old
        : mention === "Rayan Cherki" ? entity("Q64736321", "Rayan Cherki", ["Rayan Cherki", "切尔基"]) : null;
      if (selected) return { status: "resolved", mention, player: selected, resolutionMethod: "wikidata_exact" };
      return mention === "陌生昵称" ? { status: "needs_confirmation", mention, candidates: [wrong] } : { status: "unresolved", mention };
    };
    const resolver = createPlayerIdentityResolver({ repository: { async findLocalPlayersByNames(names) {
      if (arm === "local-off") return [];
      localLookups++;
      return scenario.catalog.filter(player => names.some(name => normalizeSearchText(name) === normalizeSearchText(player.name)));
    } }, external: fixtureExternal, ...(arm === "model-off" ? {} : { variants: async (mention: string) => {
      modelCalls++;
      return /切[尔耳]基/.test(mention) ? ["Rayan Cherki"] : mention === "魔笛" ? ["Luka Modrić"] : [];
    } }) });
    const started = performance.now();
    const result = await resolver(scenario.mention, undefined, { scopeId: `${scenario.id}:${arm}`, clues: arm === "context-off" ? [] : "clues" in scenario ? scenario.clues : [] });
    const correct = (candidate: PlayerIdentityCandidate) => ("expectedRecord" in scenario && candidate.recordIds?.includes(scenario.expectedRecord!))
      || ("expectedEntity" in scenario && candidate.entityId === scenario.expectedEntity);
    const candidates = result.status === "resolved" ? [result.player] : result.status === "needs_confirmation" || result.status === "ambiguous" ? result.candidates : [];
    const selected = candidates.find(correct);
    rows.push({ scenario: scenario.id, arm, status: result.status, correctRecall: Boolean(selected), correctFirstChoice: Boolean(candidates[0] && correct(candidates[0])),
      wrongAutomaticIdentity: result.status === "resolved" && !correct(result.player), confirmationRequired: result.status === "needs_confirmation" || result.status === "ambiguous",
      resolvableAfterOneSelection: Boolean(selected), expectedRecordAssociated: "expectedRecord" in scenario ? Boolean(selected?.recordIds?.includes(scenario.expectedRecord!)) : null,
      localLookups, modelCalls, externalLookups, totalTokens: null, elapsedMs: performance.now() - started });
  }
  return { protocol: "player-identity-frozen-v1", evidence: "Scripted frozen identity facts and model leads; synthetic cases; no live model-quality, real-world precision or latency claim.", rows };
}
