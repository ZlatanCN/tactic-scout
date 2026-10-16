import { createHash } from "node:crypto";
import type { KnowledgeRepository } from "./index.js";
import {
  KnowledgeSearchResultSchema,
  type KnowledgePlayerContext,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
} from "./schemas.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import { throwIfAborted } from "../domain/abort.js";

const tavilyEndpoint = "https://api.tavily.com/search";
const maxSnippetLength = 900;
const maxSearchResults = 4;

const capabilityTerms: Readonly<Record<string, readonly RegExp[]>> = {
  "整体防守": [/defensive (?:work|positioning|contribution)/i, /defend(?:s|ing)?/i, /tackl(?:e|es|ing)/i, /intercept(?:s|ion)/i],
  "后场出球": [/build[ -]?up/i, /play(?:s|ing)? out(?: from the back)?/i, /line[ -]?breaking pass/i, /progressive pass/i],
  "进攻一对一对抗": [/one[ -]?v[ -]?one/i, /take[ -]?on/i, /beat(?:s|ing)? (?:his|her|a|an )?defender/i, /dribbl(?:e|es|ing)/i],
  "压迫": [/press(?:ing|ure)?/i, /counter[ -]?press/i, /clos(?:e|es|ed|ing) down/i],
  "进球产出": [/goal(?:s|scoring)?/i, /scor(?:e|es|ing)/i, /finish(?:ing|es|ed)?/i],
  "成功盘带": [/successful dribbl/i, /take[ -]?on/i, /beat(?:s|ing)? (?:his|her|a|an )?defender/i, /dribbl(?:e|es|ing)/i],
  "向前传球": [/forward pass/i, /vertical pass/i, /line[ -]?breaking pass/i],
  "防守事件参与": [/tackl(?:e|es|ing)/i, /intercept(?:s|ion)/i, /defensive duel/i, /block(?:s|ing)?/i],
  "高强度跑动": [/high[ -]?intensity run/i, /sprint(?:s|ing)?/i, /recovery run/i],
  "防守站位": [/defensive positioning/i, /cover(?:ing)? space/i, /block(?:ing)? (?:the )?lane/i, /mark(?:ing)?/i],
  "空中对抗": [/aerial duel/i, /win(?:s|ning)? headers?/i, /heading ability/i],
  "速度与加速": [/acceleration/i, /top speed/i, /sprint speed/i],
  "进攻链条参与": [/xg[ -]?chain/i, /xg[ -]?buildup/i, /build[ -]?up involvement/i, /attacking chain/i],
  "进攻接应": [/link[ -]?up/i, /link(?:s|ing)? play/i, /hold[ -]?up/i, /lay(?:s|ing)?[- ]off/i, /lay(?:s|ing) the ball off/i, /receiv(?:e|es|ing) with (?:his|her|their) back to goal/i, /support(?:ing)? run/i],
  "创造机会": [/chance creation/i, /(?:to )?creates? (?:a )?chance/i, /key pass/i, /final ball/i, /through ball/i, /assist(?:ed|s|ing)?/i],
  "射门终结": [/finish(?:ing|es|ed)?/i, /shot conversion/i, /composure in front of goal/i, /finishing technique/i],
  "射门机会质量": [/quality of (?:his|her|their) chances/i, /shot quality/i, /expected goals/i, /xg per shot/i],
  "无球跑动": [/off[ -]?ball run/i, /run(?:s|ning)? in behind/i, /movement off the ball/i],
  "压力下控球": [/under pressure/i, /press[ -]?resistant/i, /retain(?:s|ing)? possession/i, /protect(?:s|ing)? the ball/i],
  "带球推进": [/progressive carr(?:y|ies|ying)/i, /driv(?:e|es|ing) forward/i, /carry(?:ing)? the ball forward/i],
  "推进": [/progressive pass/i, /break(?:s|ing)? the line/i, /progressive carr(?:y|ies|ying)/i],
};

const capabilityQueryTerms: Readonly<Record<string, readonly string[]>> = {
  "整体防守": ["defensive work", "defensive positioning", "tackling"],
  "后场出球": ["build-up from the back", "playing out", "line-breaking passes"],
  "进攻一对一对抗": ["attacking one-on-one", "take-ons", "beating defenders"],
  "压迫": ["pressing", "counter-press", "closing down"],
  "进球产出": ["goal scoring", "scoring record", "finishing"],
  "成功盘带": ["successful dribbles", "take-ons", "beating defenders"],
  "向前传球": ["forward passes", "vertical passes", "line-breaking passes"],
  "防守事件参与": ["tackles", "interceptions", "defensive duels"],
  "高强度跑动": ["high-intensity runs", "sprints", "recovery runs"],
  "防守站位": ["defensive positioning", "covering space", "blocking passing lanes"],
  "空中对抗": ["aerial duels", "winning headers", "heading ability"],
  "速度与加速": ["acceleration", "top speed", "sprint speed"],
  "进攻链条参与": ["attacking chain involvement", "xG chain", "xG buildup"],
  "进攻接应": ["link-up play", "hold-up play", "lay-off"],
  "创造机会": ["chance creation", "key pass", "final ball"],
  "射门终结": ["finishing", "shot conversion"],
  "射门机会质量": ["shot quality", "expected goals"],
  "无球跑动": ["off-ball runs", "movement off the ball"],
  "压力下控球": ["ball retention under pressure", "press resistance"],
  "带球推进": ["progressive carries", "driving forward"],
  "推进": ["progressive passes", "breaking lines"],
};

interface TavilySearchResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  published_date?: unknown;
}

export interface WebSearchKnowledgeOptions {
  apiKey?: string;
  allowedDomains?: readonly string[];
  aiProcessingAllowed?: boolean;
  reportDisplayAllowed?: boolean;
  localRetentionAllowed?: boolean;
  fetcher?: typeof fetch;
}

function configuredOptionsFromEnvironment(): WebSearchKnowledgeOptions {
  return {
    apiKey: process.env.TAVILY_API_KEY,
    allowedDomains: (process.env.TACTISCOUT_WEB_SEARCH_ALLOWED_DOMAINS ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    aiProcessingAllowed: process.env.TACTISCOUT_WEB_SEARCH_AI_PROCESSING_ALLOWED === "true",
    reportDisplayAllowed: process.env.TACTISCOUT_WEB_SEARCH_REPORT_DISPLAY_ALLOWED === "true",
    localRetentionAllowed: process.env.TACTISCOUT_WEB_SEARCH_LOCAL_RETENTION_ALLOWED === "true",
  };
}

function normalizeDomain(value: string): string | undefined {
  const candidate = value.includes("://") ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) return undefined;
    return url.hostname.toLocaleLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function isAllowedDomain(urlValue: string, allowedDomains: readonly string[]): boolean {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const hostname = url.hostname.toLocaleLowerCase().replace(/^www\./, "");
    return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function hasExactEntityMention(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
}

function anchoredContext(text: string, context: KnowledgePlayerContext): boolean {
  const normalizedText = normalizeSearchText(text);
  const team = normalizeSearchText(context.team);
  return team.length >= 3 && normalizedText.includes(team);
}

function matchingGaps(content: string, gaps: readonly string[]): string[] {
  return gaps.filter((gap) => capabilityTerms[gap]?.some((pattern) => pattern.test(content)));
}

function queryFor(request: KnowledgeSearchRequest): string {
  const contexts = request.playerContexts ?? [];
  const candidates = contexts.map(({ playerName, team, competition, season }) => (
    `"${playerName}" "${team}" "${competition}" "${season}"`
  ));
  const gaps = request.capabilityGaps ?? [];
  const terms = gaps.flatMap((gap) => capabilityQueryTerms[gap] ?? []);
  return [
    candidates.join(" OR "),
    gaps.join(" "),
    terms.slice(0, 12).join(" "),
    "football scouting match analysis",
  ].filter(Boolean).join(" ").slice(0, 1000);
}

function mapResults(input: {
  response: unknown;
  request: KnowledgeSearchRequest;
  allowedDomains: readonly string[];
}): KnowledgeSearchResult[] {
  if (!input.response || typeof input.response !== "object") return [];
  const rawResults = (input.response as { results?: unknown }).results;
  if (!Array.isArray(rawResults)) return [];
  const contexts = input.request.playerContexts ?? [];
  const gaps = input.request.capabilityGaps ?? [];
  const rows: KnowledgeSearchResult[] = [];
  for (const raw of rawResults as TavilySearchResult[]) {
    if (typeof raw.title !== "string" || typeof raw.url !== "string" || typeof raw.content !== "string") continue;
    if (!isAllowedDomain(raw.url, input.allowedDomains)) continue;
    const content = raw.content.trim().slice(0, maxSnippetLength);
    const searchableText = `${raw.title}\n${content}`;
    const matchingContexts = contexts.filter((context) => (
      hasExactEntityMention(searchableText, context.playerName)
      && anchoredContext(searchableText, context)
    ));
    if (matchingContexts.length !== 1 || gaps.length === 0) continue;
    const context = matchingContexts[0]!;
    const matchedGaps = matchingGaps(content, gaps);
    if (matchedGaps.length === 0) continue;
    const url = new URL(raw.url);
    const sourceId = `web-search:${url.hostname.toLocaleLowerCase()}`;
    const documentId = createHash("sha256").update(url.href).digest("hex");
    const publishedAt = typeof raw.published_date === "string" && raw.published_date.trim()
      ? raw.published_date.trim()
      : null;
    const normalizedText = normalizeSearchText(searchableText);
    rows.push(KnowledgeSearchResultSchema.parse({
      id: `web:${documentId}`,
      documentId: `web:${documentId}`,
      corpus: "player_report",
      text: content,
      title: raw.title.trim().slice(0, 300),
      url: url.href,
      sourceId,
      sourceName: `Tavily Web Search · ${url.hostname}`,
      publisher: url.hostname,
      author: "原页面未注明（请打开来源核实）",
      publishedAt,
      license: "搜索摘要；原页面许可与时间范围需人工核实",
      attribution: `Tavily Web Search 摘要 · ${url.hostname} · 本轮即时检索，未抓取或入库原页面正文。`,
      entityIds: [],
      entityNames: [context.playerName],
      competition: normalizedText.includes(normalizeSearchText(context.competition)) ? context.competition : null,
      season: normalizedText.includes(normalizeSearchText(context.season)) ? context.season : null,
      matchedCapabilityGaps: matchedGaps,
      displayAllowed: true,
    }));
  }
  return rows;
}

export function createWebSearchKnowledgeRepository(
  localRepository: KnowledgeRepository,
  options: WebSearchKnowledgeOptions = configuredOptionsFromEnvironment(),
): KnowledgeRepository {
  const apiKey = options.apiKey?.trim();
  const allowedDomains = [...new Set((options.allowedDomains ?? []).map(normalizeDomain).filter((value): value is string => Boolean(value)))];
  const fetcher = options.fetcher ?? fetch;
  const enabled = Boolean(apiKey && allowedDomains.length > 0
    && options.aiProcessingAllowed && options.reportDisplayAllowed && options.localRetentionAllowed);

  return {
    async search(unparsedRequest, searchOptions) {
      const localResults = await localRepository.search(unparsedRequest, searchOptions);
      throwIfAborted(searchOptions?.signal);
      if (!enabled || unparsedRequest.corpus !== "player_report"
        || !unparsedRequest.capabilityGaps?.length || !unparsedRequest.playerContexts?.length) {
        return localResults.slice(0, unparsedRequest.limit);
      }

      const timeoutSignal = AbortSignal.timeout(12_000);
      const signal = searchOptions?.signal ? AbortSignal.any([searchOptions.signal, timeoutSignal]) : timeoutSignal;
      throwIfAborted(signal);
      const response = await fetcher(tavilyEndpoint, {
        method: "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: queryFor(unparsedRequest),
          search_depth: "basic",
          topic: "general",
          max_results: Math.min(unparsedRequest.limit, maxSearchResults),
          include_answer: false,
          include_raw_content: false,
          include_domains: allowedDomains,
        }),
        signal,
      });
      if (!response.ok) throw new Error(`Web Search 请求失败（HTTP ${response.status}）。`);
      const webResults = mapResults({
        response: await response.json() as unknown,
        request: unparsedRequest,
        allowedDomains,
      });
      throwIfAborted(searchOptions?.signal);
      const seenUrls = new Set<string>();
      return [...localResults, ...webResults]
        .filter((result) => {
          if (seenUrls.has(result.url)) return false;
          seenUrls.add(result.url);
          return true;
        })
        .slice(0, unparsedRequest.limit);
    },
  };
}
