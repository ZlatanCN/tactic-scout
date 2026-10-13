import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { KnowledgeDocumentInputSchema, KnowledgeSourceSchema, type KnowledgeDocumentInput, type KnowledgeSource } from "./schemas.js";
import { canAutomaticallyIngest } from "./permissions.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pmcOaiEndpoint = "https://pmc.ncbi.nlm.nih.gov/api/oai/v1/mh/";
const expectedArticle = {
  doi: "10.3389/fpsyg.2022.813206",
  pmcid: "PMC9197445",
  oaiIdentifier: "oai:pubmedcentral.nih.gov:9197445",
  sourceId: "frontiers-positional-role-2022",
  articleUrl: "https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.813206/full",
  licenseUri: "https://creativecommons.org/licenses/by/4.0/",
} as const;
const maxResponseCharacters = 2_000_000;
const minRequestIntervalMs = 400;

function decodeXml(value: string): string {
  return value
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagText(xml: string, tag: string): string | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}\\s*>`, "i").exec(xml);
  if (!match) return null;
  return decodeXml(match[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function articleId(xml: string, kind: "doi" | "pmc"): string | null {
  for (const match of xml.matchAll(/<article-id\b([^>]*)>([\s\S]*?)<\/article-id\s*>/gi)) {
    const type = /\bpub-id-type\s*=\s*["']([^"']+)["']/i.exec(match[1]!)?.[1];
    const normalizedType = type?.toLowerCase();
    if (kind === "doi" ? normalizedType === "doi" : normalizedType === "pmc" || normalizedType === "pmcid") {
      return decodeXml(match[2]!.replace(/<[^>]+>/g, "").trim());
    }
  }
  return null;
}

function licenseUri(xml: string): string | null {
  const licenseReference = /<(?:[\w.-]+:)?license_ref\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?license_ref\s*>/i.exec(xml)?.[1];
  if (licenseReference) return decodeXml(licenseReference.replace(/<[^>]+>/g, "").trim());
  for (const match of xml.matchAll(/<license\b([^>]*)>/gi)) {
    const attributes = match[1]!;
    const href = /(?:xlink:)?href\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
    if (href) return decodeXml(href);
  }
  return null;
}

function assertExpectedArticle(xml: string, stage: string): void {
  if (/<(?:[\w.-]+:)?error\b/i.test(xml)) {
    const code = /<(?:[\w.-]+:)?error\b[^>]*\bcode\s*=\s*["']([^"']+)["']/i.exec(xml)?.[1];
    throw new Error(`PMC OAI-PMH ${stage} 请求未返回记录${code ? `（${code.slice(0, 40)}）` : ""}。`);
  }
  if (articleId(xml, "doi") !== expectedArticle.doi || articleId(xml, "pmc")?.startsWith(expectedArticle.pmcid) !== true) {
    throw new Error(`PMC OAI-PMH ${stage} 记录与登记的 DOI/PMCID 不匹配。`);
  }
  if (!/^https?:\/\/creativecommons\.org\/licenses\/by\/4\.0\/?$/i.test(licenseUri(xml) ?? "")) {
    throw new Error(`PMC OAI-PMH ${stage} 记录未确认 CC BY 4.0 许可。`);
  }
}

function stripExcludedBlocks(body: string): string {
  let text = body;
  for (const element of ["fig-group", "fig", "table-wrap-group", "table-wrap", "supplementary-material", "ref-list", "fn-group", "media", "inline-graphic", "graphic"]) {
    const pattern = new RegExp(`<((?:[\\w.-]+:)?${element})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi");
    text = text.replace(pattern, " ");
    const selfClosing = new RegExp(`<(?:(?:[\\w.-]+:)?)${element}\\b[^>]*/\\s*>`, "gi");
    text = text.replace(selfClosing, " ");
  }
  return text;
}

function removeExternalDoctype(xml: string): string {
  const declaration = /<!DOCTYPE\b/gi;
  let output = "";
  let cursor = 0;
  for (let match = declaration.exec(xml); match; match = declaration.exec(xml)) {
    output += xml.slice(cursor, match.index);
    let quote: "'" | '"' | null = null;
    let hasInternalSubset = false;
    let end = declaration.lastIndex;
    for (; end < xml.length; end += 1) {
      const character = xml[end]!;
      if (quote) {
        if (character === quote) quote = null;
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
      } else if (character === "[") {
        hasInternalSubset = true;
      } else if (character === ">") {
        break;
      }
    }
    if (end >= xml.length || quote) throw new Error("PMC 文章的 DOCTYPE 声明不完整；已拒绝解析。");
    if (hasInternalSubset) throw new Error("PMC 文章包含内部 DOCTYPE 子集；已拒绝解析。");
    output += " ";
    cursor = end + 1;
    declaration.lastIndex = cursor;
  }
  return output + xml.slice(cursor);
}

function articleBodyText(xml: string): string {
  // Never resolve external entities. PMC's JATS can contain an external DOCTYPE;
  // remove it before the deliberately non-validating text extraction.
  if (/<!\s*ENTITY\b/i.test(xml)) throw new Error("PMC 文章包含不支持的实体声明；已拒绝解析。");
  const safeXml = removeExternalDoctype(xml);
  const body = /<(?:[\w.-]+:)?body\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?body\s*>/i.exec(safeXml)?.[1];
  if (!body) throw new Error("PMC OAI-PMH 没有返回可索引的文章正文。");
  return decodeXml(stripExcludedBlocks(body)
    .replace(/<\/?(?:[\w.-]+:)?(?:title|p|sec|list-item|list|caption)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function firstAuthor(xml: string): string {
  const firstContribution = /<contrib\b[^>]*>([\s\S]*?)<\/contrib\s*>/i.exec(xml)?.[1] ?? "";
  const given = tagText(firstContribution, "given-names");
  const surname = tagText(firstContribution, "surname");
  return [given, surname].filter(Boolean).join(" ") || "Leon Forcher et al.";
}

function chineseMethodologySummary(): string {
  return [
    "TactiScout-authored Chinese methodology summary (not original article text):",
    "这项研究提醒球探区分球员的场上位置与包含阵型的 positional role（位置角色），并同时保留个人技术风格。研究观察 2018/19 德甲的传球、盘带和持球表现；位置切换者样本仅 13 人，且来源是一季、一个联赛。位置角色与个人差异都可能影响技术表现，因此这些样本适合提示比较时加入角色语境，不足以构造通用能力分数，也不能单独证明某名球员适配某支球队。原研究的 DFL/Deltatre 比赛数据不包含在 TactiScout 语料中。",
  ].join("\n");
}

export class PmcOaiDiscoveryProvider {
  private lastRequestAt = 0;

  constructor(private readonly options: { fetcher?: typeof fetch; registryPath?: string } = {}) {}

  async fetchRegisteredArticle(doi: string): Promise<KnowledgeDocumentInput> {
    if (doi.trim() !== expectedArticle.doi) throw new Error(`PMC OAI-PMH 当前只支持已核准 DOI ${expectedArticle.doi}。`);

    const sourceRecords = await this.readSources();
    const source = sourceRecords.find((candidate) => candidate.id === expectedArticle.sourceId);
    if (!source || !canAutomaticallyIngest(source, expectedArticle.articleUrl)) {
      throw new Error("Forcher et al. (2022) 未同时通过来源登记和自动抓取/留存/AI 处理权限检查；未发出 PMC 请求。");
    }

    const metadata = await this.request("pmc_fm");
    assertExpectedArticle(metadata, "元数据");

    const article = await this.request("pmc");
    assertExpectedArticle(article, "全文");
    const content = `${articleBodyText(article)}\n\n${chineseMethodologySummary()}`.trim();
    if (content.length < 40 || content.length > 200_000) throw new Error(`PMC 文章可索引文本长度 ${content.length} 超出当前范围。`);

    const title = tagText(metadata, "article-title")
      ?? "Does Technical Match Performance in Professional Soccer Depend on the Positional Role or the Individuality of the Player?";
    const author = firstAuthor(metadata);
    return KnowledgeDocumentInputSchema.parse({
      sourceId: source.id,
      corpus: "methodology",
      title,
      url: expectedArticle.articleUrl,
      author,
      publisher: source.publisher,
      publishedAt: "2022",
      license: source.license,
      attribution: `${author} et al. (2022). ${title}. Frontiers in Psychology. https://doi.org/${expectedArticle.doi}. ${source.license}. Full text retrieved via PMC OAI-PMH; TactiScout-authored summary added; figures, tables, supplements, and third-party materials excluded.`,
      entityIds: [],
      entityNames: [],
      competition: "Bundesliga",
      season: "2018/19",
      acquisition: "authorized_fetch",
      content,
    });
  }

  private async readSources(): Promise<KnowledgeSource[]> {
    const registryPath = path.resolve(this.options.registryPath
      ?? process.env.TACTISCOUT_KNOWLEDGE_SOURCES_FILE
      ?? path.join(projectRoot, "data", "knowledge", "sources.json"));
    return KnowledgeSourceSchema.array().parse(JSON.parse(await readFile(registryPath, "utf8")) as unknown);
  }

  private async request(metadataPrefix: "pmc_fm" | "pmc"): Promise<string> {
    const waitMs = Math.max(0, minRequestIntervalMs - (Date.now() - this.lastRequestAt));
    if (waitMs) await delay(waitMs);
    this.lastRequestAt = Date.now();

    const url = new URL(pmcOaiEndpoint);
    url.searchParams.set("verb", "GetRecord");
    url.searchParams.set("identifier", expectedArticle.oaiIdentifier);
    url.searchParams.set("metadataPrefix", metadataPrefix);
    const response = await (this.options.fetcher ?? fetch)(url, {
      headers: { accept: "application/xml" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`PMC OAI-PMH 请求失败（HTTP ${response.status}）。`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxResponseCharacters) {
      throw new Error("PMC OAI-PMH 响应超过 2 MB 限制；已停止读取。");
    }
    const xml = await response.text();
    if (xml.length > maxResponseCharacters) throw new Error("PMC OAI-PMH 响应超过 2 MB 限制；已拒绝解析。");
    return xml;
  }
}
