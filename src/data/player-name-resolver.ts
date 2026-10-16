import { z } from "zod/v4";
import { normalizeSearchText } from "../domain/text-matching.js";
import { signalWithTimeout, throwIfAborted } from "../domain/abort.js";

export interface ResolvedPlayerName {
  entityId: string;
  sourceUrl: string;
  names: string[];
}
export type PlayerNameResolver = (mention: string, signal?: AbortSignal) => Promise<ResolvedPlayerName | null>;

const name = z.object({ value: z.string() });
const searchResponse = z.object({ search: z.array(z.object({
  id: z.string().regex(/^Q\d+$/), match: z.object({ text: z.string() }),
})) });
const entityResponse = z.object({ entities: z.record(z.string(), z.object({
  labels: z.record(z.string(), name).optional(), aliases: z.record(z.string(), z.array(name)).optional(),
  claims: z.object({ P106: z.array(z.object({
    rank: z.string().optional(), mainsnak: z.object({ datavalue: z.object({ value: z.object({ id: z.string() }).passthrough() }).optional() }),
  })).optional() }).optional(),
})) });

/** Resolve multilingual labels only. This never supplies current clubs, ability, or cross-provider merges. */
export function createWikidataPlayerNameResolver(options: { fetchImpl?: typeof fetch } = {}): PlayerNameResolver {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = new Map<string, ResolvedPlayerName | null>();
  async function request(parameters: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.search = new URLSearchParams({ format: "json", ...parameters }).toString();
    const response = await fetchImpl(url, { redirect: "error", headers: { "User-Agent": "TactiScout/0.1 (local football research)", Accept: "application/json" }, signal: signalWithTimeout(signal, 5000) });
    if (!response.ok) throw new Error("Name lookup unavailable");
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("Name lookup response too large");
    return JSON.parse(text);
  }
  return async (mention, signal) => {
    throwIfAborted(signal);
    const key = normalizeSearchText(mention);
    if (!key || mention.length > 100) return null;
    if (cache.has(key)) return cache.get(key)!;
    try {
      const search = searchResponse.parse(await request({ action: "wbsearchentities", search: mention,
        language: /\p{Script=Han}/u.test(mention) ? "zh" : "en", uselang: "en", type: "item", limit: "8" }, signal));
      const ids = [...new Set(search.search.filter(hit => normalizeSearchText(hit.match.text) === key).map(hit => hit.id))];
      if (!ids.length) return null;
      const response = entityResponse.parse(await request({ action: "wbgetentities", ids: ids.join("|"),
        props: "labels|aliases|claims", languages: "en|zh|zh-cn|zh-hans|zh-hant" }, signal));
      const players = ids.flatMap(id => {
        const entity = response.entities[id];
        const isFootballer = entity?.claims?.P106?.some(claim => claim.rank !== "deprecated" && claim.mainsnak.datavalue?.value.id === "Q937857");
        if (!isFootballer) return [];
        const names = [...new Set([...Object.values(entity.labels ?? {}).map(item => item.value),
          ...Object.values(entity.aliases ?? {}).flatMap(values => values.map(item => item.value))])];
        if (!names.some(value => normalizeSearchText(value) === key)) return [];
        return [{ entityId: id, sourceUrl: `https://www.wikidata.org/wiki/${id}`, names }];
      });
      // Multiple returned footballers sharing a label must not be resolved by result order.
      const result = players.length === 1 ? players[0]! : null;
      throwIfAborted(signal);
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(key, result);
      return result;
    } catch {
      throwIfAborted(signal);
      return null;
    }
  };
}
