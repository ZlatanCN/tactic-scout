import { z } from "zod/v4";
import { normalizeSearchText } from "../../domain/text-matching.js";
import { signalWithTimeout, throwIfAborted } from "../../domain/abort.js";
import type { PlayerIdentityCandidate, PlayerIdentityContext } from "../../domain/player-identity.js";
import { createPlayerIdentityResolver, type PlayerNameVariantGenerator } from "./player-identity-resolver.js";
import { NameEvidenceStore } from "./name-evidence-store.js";
import type { PlayerRepository } from "../repository.js";
export type { PlayerIdentityCandidate } from "../../domain/player-identity.js";

export type PlayerIdentityMatch = PlayerIdentityCandidate["match"];

export type PlayerNameResolution = (
  | {
      status: "resolved";
      mention: string;
      player: PlayerIdentityCandidate;
      resolutionMethod: "wikidata_exact" | "tavily_wikidata" | "user_confirmed" | "local_exact" | "verified_alias";
    }
  | { status: "ambiguous" | "needs_confirmation"; mention: string; candidates: PlayerIdentityCandidate[] }
  | { status: "unresolved"; mention: string }
  | { status: "unavailable"; mention: string; source: "wikidata" | "tavily" | "model"; retryable: true }
) & { nameLeads?: Array<{ name: string; sourceUrls: string[] }> };

export type PlayerNameResolver = ((mention: string, signal?: AbortSignal, context?: PlayerIdentityContext) => Promise<PlayerNameResolution>) & {
  rememberConfirmation?(mention: string, player: PlayerIdentityCandidate, context: PlayerIdentityContext): void;
};

const label = z.object({ value: z.string() });
const description = z.object({ value: z.string() });
const searchResponse = z.object({
  search: z.array(z.object({
    id: z.string().regex(/^Q\d+$/),
    match: z.object({ text: z.string() }).optional(),
  })),
});
const entityResponse = z.object({
  entities: z.record(z.string(), z.object({
    labels: z.record(z.string(), label).optional(),
    aliases: z.record(z.string(), z.array(label)).optional(),
    descriptions: z.record(z.string(), description).optional(),
    claims: z.object({
      P106: z.array(z.object({
        rank: z.string().optional(),
        mainsnak: z.object({
          datavalue: z.object({ value: z.object({ id: z.string() }).passthrough() }).optional(),
        }),
      })).optional(),
      P569: z.array(z.object({ mainsnak: z.object({ datavalue: z.object({ value: z.object({ time: z.string(), precision: z.number().optional() }).passthrough() }).optional() }) })).optional(),
    }).optional(),
  })),
});

interface ScoredCandidate {
  player: Omit<PlayerIdentityCandidate, "match">;
  score: number;
  match: PlayerIdentityMatch;
}

function levenshtein(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

function nameSimilarity(left: string, right: string): number {
  const a = normalizeSearchText(left);
  const b = normalizeSearchText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const distance = levenshtein(a, b);
  const maximum = Math.max([...a].length, [...b].length);
  if (/\p{Script=Han}/u.test(a + b) && Math.min([...a].length, [...b].length) >= 3 && distance === 1) return 0.84;
  return 1 - distance / maximum;
}

function candidateFromEntity(entityId: string, entity: z.infer<typeof entityResponse>["entities"][string]): Omit<PlayerIdentityCandidate, "match"> | null {
  const isFootballer = entity.claims?.P106?.some(claim =>
    claim.rank !== "deprecated" && claim.mainsnak.datavalue?.value.id === "Q937857",
  );
  if (!isFootballer) return null;

  const labels = Object.values(entity.labels ?? {}).map(item => item.value);
  const names = [...new Set([
    ...labels,
    ...Object.values(entity.aliases ?? {}).flatMap(items => items.map(item => item.value)),
  ])].filter(name => name.length <= 160).slice(0, 99);
  const preferredName = entity.labels?.en?.value ?? entity.labels?.zh?.value ?? labels[0];
  if (!preferredName || !names.length) return null;
  const birth = entity.claims?.P569?.find(claim => claim.mainsnak.datavalue?.value.time.match(/^\+\d{4}-\d{2}-\d{2}T/)
    && (claim.mainsnak.datavalue?.value.precision ?? 11) >= 11)?.mainsnak.datavalue?.value.time.slice(1, 11);
  const candidate = { entityId, sourceUrl: "https://www.wikidata.org/wiki/" + entityId, names, preferredName, ...(birth ? { birthDate: birth } : {}) };
  const summary = [...new Set([entity.descriptions?.["zh-hans"]?.value, entity.descriptions?.["zh-cn"]?.value,
    entity.descriptions?.zh?.value, entity.descriptions?.["zh-hant"]?.value, entity.descriptions?.en?.value].filter(Boolean))].join(" · ");
  return summary ? { ...candidate, description: summary } : candidate;
}

function resolveExactOrSuggest(mention: string, candidates: ScoredCandidate[]): PlayerNameResolution {
  const exact = candidates.filter(candidate => candidate.score === 1);
  if (exact.length === 1) {
    return {
      status: "resolved",
      mention,
      player: { ...exact[0]!.player, names: [...new Set([mention, ...exact[0]!.player.names])].slice(0, 100), match: exact[0]!.match },
      resolutionMethod: "wikidata_exact",
    };
  }
  if (exact.length > 1) {
    return { status: "ambiguous", mention, candidates: exact.slice(0, 5).map(({ player, match }) => ({ ...player, match })) };
  }

  const similar = candidates.filter(candidate => candidate.score >= 0.78).sort((a, b) => b.score - a.score);
  if (!similar.length) return { status: "unresolved", mention };
  const possibleTie = similar.length > 1 && similar[0]!.score - similar[1]!.score < 0.14;
  const selected = similar.slice(0, 5).map(({ player }) => ({ ...player, match: "similar_name" as const }));
  return { status: possibleTie ? "ambiguous" : "needs_confirmation", mention, candidates: selected };
}

/** Multilingual names identify a person only; they do not supply current club, ability, or provider IDs. */
export function createWikidataPlayerNameResolver(options: {
  fetchImpl?: typeof fetch;
  enableTypoSuggestions?: boolean;
  now?: () => number;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
} = {}): PlayerNameResolver {
  const fetchImpl = options.fetchImpl ?? fetch;
  const enableTypoSuggestions = options.enableTypoSuggestions ?? true;
  const cache = new Map<string, { result: PlayerNameResolution; expiresAt: number }>();
  const now = options.now ?? Date.now;
  function remember(key: string, result: PlayerNameResolution) {
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    cache.set(key, { result, expiresAt: now() + (result.status === "unresolved" ? options.negativeTtlMs ?? 30_000 : options.positiveTtlMs ?? 86_400_000) });
  }

  async function request(parameters: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.search = new URLSearchParams({ format: "json", ...parameters }).toString();
    const response = await fetchImpl(url, {
      redirect: "error",
      headers: { "User-Agent": "TactiScout/0.1 (local football research)", Accept: "application/json" },
      signal: signalWithTimeout(signal, 5000),
    });
    if (!response.ok) throw new Error("Wikidata unavailable");
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("Wikidata response too large");
    return JSON.parse(text);
  }

  return async (mention, signal, context) => {
    throwIfAborted(signal);
    const key = normalizeSearchText(mention);
    if (!key || mention.length > 100) return { status: "unresolved", mention };
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now() && !context?.forceRecheck
      && !(cached.result.status === "unresolved" && (context?.queryHint || context?.clues?.length))) return { ...cached.result, mention };
    cache.delete(key);

    try {
      const languages = /\p{Script=Han}/u.test(mention) ? ["zh", "en", "de"] : ["en", "zh", "de"];
      const searchResponses = await Promise.allSettled(languages.map(language => request({
        action: "wbsearchentities",
        search: mention,
        language,
        uselang: language,
        type: "item",
        limit: "10",
      }, signal)));
      throwIfAborted(signal);
      const searchResults = searchResponses.flatMap(result => {
        if (result.status !== "fulfilled") return [];
        const parsed = searchResponse.safeParse(result.value);
        return parsed.success ? [parsed.data] : [];
      });
      if (!searchResults.length) throw new Error("Name lookup unavailable");
      const ids = [...new Set(searchResults.flatMap(result => result.search.map(hit => hit.id)))].slice(0, 20);

      if (!ids.length) {
        if (searchResults.length < languages.length) throw new Error("Name lookup incomplete");
        const empty: PlayerNameResolution = { status: "unresolved", mention };
        remember(key, empty);
        return empty;
      }

      const response = entityResponse.parse(await request({
        action: "wbgetentities",
        ids: ids.join("|"),
        props: "labels|aliases|descriptions|claims",
        languages: "en|zh|zh-cn|zh-hans|zh-hant|de|es|fr|it|pt|ja|ko|ar",
      }, signal));
      const normalizedMention = normalizeSearchText(mention);
      const candidates = ids.flatMap(id => {
        const entity = response.entities[id];
        const player = entity && candidateFromEntity(id, entity);
        if (!player) return [];
        const labelMatch = Object.values(entity.labels ?? {}).some(item => normalizeSearchText(item.value) === normalizedMention);
        const aliasMatch = Object.values(entity.aliases ?? {}).flat().some(item => normalizeSearchText(item.value) === normalizedMention);
        const exact = labelMatch || aliasMatch;
        const score = exact ? 1 : enableTypoSuggestions
          ? Math.max(0, ...player.names.map(value => nameSimilarity(mention, value)))
          : 0;
        return [{
          player,
          score,
          match: labelMatch ? "exact_label" as const : aliasMatch ? "exact_alias" as const : "similar_name" as const,
        }];
      });
      const result = resolveExactOrSuggest(mention, candidates);
      throwIfAborted(signal);
      remember(key, result);
      return result;
    } catch {
      throwIfAborted(signal);
      return { status: "unavailable", mention, source: "wikidata", retryable: true };
    }
  };
}

interface TavilyPlayerNameHit {
  title?: unknown;
  url?: unknown;
  content?: unknown;
}

/** Lexical bilingual leads only; every proposed name is still entity-verified. */
function snippetNameLeads(text: unknown): string[] {
  if (typeof text !== "string") return [];
  const pattern = /(?<!\p{L})(\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){1,3})(?!\p{L})/gu;
  return [...text.slice(0, 2000).matchAll(pattern)].map(match => match[1]!.trim()).filter(name => name.length <= 80).slice(0, 6);
}

function playerNameFromSearchTitle(title: string): string | null {
  const beforePublisher = title.split("|")[0]!.trim();
  const leadingName = beforePublisher.split(/\s+[–—-]\s+/)[0]!.split(/:\s+/)[0]!.trim();
  if (leadingName.length < 3 || leadingName.length > 80 || /\d/.test(leadingName)) return null;
  const latinName = leadingName.match(/[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*)+/u);
  if (latinName) return latinName[0].trim();
  return leadingName.match(/[\p{Script=Han}]{2,8}/u)?.[0] ?? null;
}

function resultHost(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url.hostname.toLocaleLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A web result is only a lead; a cross-host name continues only after Wikidata verifies a footballer. */
export function createTavilyBackedPlayerNameResolver(options: {
  apiKey: string;
  primaryResolver?: PlayerNameResolver;
  fetcher?: typeof fetch;
}): PlayerNameResolver {
  const apiKey = options.apiKey.trim();
  const primaryResolver = options.primaryResolver ?? createWikidataPlayerNameResolver();
  const fetcher = options.fetcher ?? fetch;

  return async (mention, signal, context) => {
    throwIfAborted(signal);
    const exact = await primaryResolver(mention, signal, context);
    if (!context?.forceRecheck && (exact.status === "ambiguous" || exact.status === "resolved"
      && (context?.clues ?? []).every(clue => normalizeSearchText(exact.player.description ?? "").includes(normalizeSearchText(clue.value))))) return exact;
    if (!apiKey || !mention.trim() || mention.length > 100) return exact;

    let tavilyUnavailable = false;
    let nameLeads: Array<{ name: string; sourceUrls: string[] }> = [];
    try {
      const response = await fetcher("https://api.tavily.com/search", {
        method: "POST",
        redirect: "error",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: [mention.trim(), ...(context?.clues ?? []).map(clue => clue.value), context?.queryHint, "football player soccer"].filter(Boolean).join(" ").slice(0, 250),
          topic: "general",
          search_depth: "basic",
          max_results: 8,
          include_answer: false,
          include_raw_content: false,
        }),
        signal: signalWithTimeout(signal, 10_000),
      });
      if (!response.ok) {
        tavilyUnavailable = true;
      } else {
        const body = await response.text();
        if (body.length > 1_000_000) {
          tavilyUnavailable = true;
        } else {
          const parsed: unknown = JSON.parse(body);
          const results = parsed && typeof parsed === "object" ? (parsed as { results?: unknown }).results : null;
          if (!Array.isArray(results)) {
            tavilyUnavailable = true;
          } else {
            const byName = new Map<string, { name: string; hosts: Set<string>; urls: Set<string> }>();
            for (const hit of results.slice(0, 8) as TavilyPlayerNameHit[]) {
              if (typeof hit.title !== "string" || typeof hit.url !== "string") continue;
              const host = resultHost(hit.url);
              if (!host) continue;
              const names = [playerNameFromSearchTitle(hit.title), ...snippetNameLeads(hit.content)].filter((name): name is string => Boolean(name));
              for (const name of names) {
                const key = normalizeSearchText(name);
                if (!key) continue;
                const entry = byName.get(key) ?? { name, hosts: new Set<string>(), urls: new Set<string>() };
                entry.hosts.add(host);
                entry.urls.add(hit.url);
                byName.set(key, entry);
              }
            }
            // Search popularity is recall evidence, not proof of the original alias.
            const corroborated = [...byName.values()].sort((a, b) => (b.hosts.size + Number(/\p{Script=Latin}/u.test(b.name)))
              - (a.hosts.size + Number(/\p{Script=Latin}/u.test(a.name)))).slice(0, 3);
            nameLeads = corroborated.map(item => ({ name: item.name, sourceUrls: [...item.urls] }));
            const verified = await Promise.all(corroborated.map(item => primaryResolver(item.name, signal)));
            const entities = new Map<string, PlayerIdentityCandidate>();
            const exactVerified = new Set<string>();
            for (const resolution of verified) {
              if (resolution.status === "resolved") {
                exactVerified.add(resolution.player.entityId);
                entities.set(resolution.player.entityId, { ...resolution.player, match: "web_corroborated" });
              } else if (resolution.status === "ambiguous" || resolution.status === "needs_confirmation") {
                for (const candidate of resolution.candidates) {
                  entities.set(candidate.entityId, { ...candidate, match: "web_corroborated" });
                }
              }
            }
            throwIfAborted(signal);
            if (entities.size === 1) {
              const player = entities.values().next().value!;
              if (!exactVerified.has(player.entityId) || !player.names.some(name => normalizeSearchText(name) === normalizeSearchText(mention))) {
                return { status: "needs_confirmation", mention, candidates: [player] };
              }
              return {
                status: "resolved",
                mention,
                player,
                resolutionMethod: "tavily_wikidata",
              };
            }
            if (entities.size > 1) return { status: "ambiguous", mention, candidates: [...entities.values()].slice(0, 5) };
          }
        }
      }
    } catch {
      throwIfAborted(signal);
      tavilyUnavailable = true;
    }

    if (exact.status === "needs_confirmation") return { ...exact, nameLeads };
    if (tavilyUnavailable) return { status: "unavailable", mention, source: "tavily", retryable: true, nameLeads };
    return { ...exact, nameLeads };
  };
}

export function createConfiguredPlayerNameResolver(environment: NodeJS.ProcessEnv = process.env, options?: {
  repository: PlayerRepository;
  variants?: PlayerNameVariantGenerator;
}): PlayerNameResolver {
  const wikidataResolver = createWikidataPlayerNameResolver();
  const apiKey = environment.TAVILY_API_KEY?.trim();
  const external = environment.TACTISCOUT_TAVILY_IDENTITY_SEARCH_ENABLED === "true" && apiKey
    ? createTavilyBackedPlayerNameResolver({ apiKey, primaryResolver: wikidataResolver }) : wikidataResolver;
  return options ? createPlayerIdentityResolver({ ...options, external,
    store: new NameEvidenceStore(environment.TACTISCOUT_NAME_EVIDENCE_PATH ?? ".data/identity/name-evidence.sqlite") }) : external;
}

export function selectPlayerIdentityCandidate(
  resolution: PlayerNameResolution,
  entityId: string,
): PlayerNameResolution & { status: "resolved" } | null {
  if (resolution.status !== "ambiguous" && resolution.status !== "needs_confirmation") return null;
  const candidate = resolution.candidates.find(item => item.entityId === entityId);
  return candidate
    ? {
        status: "resolved",
        mention: resolution.mention,
        player: { ...candidate, match: "user_confirmed" },
        resolutionMethod: "user_confirmed",
      }
    : null;
}
