import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import {
  KnowledgeEvidenceDocumentInputSchema,
  type KnowledgeEvidenceDocumentInput,
} from "./evidence-schemas.js";
import {
  KnowledgeDocumentInputSchema,
  KnowledgeSourceSchema,
  type KnowledgeDocumentInput,
  type KnowledgeSource,
} from "./schemas.js";
import { canAutomaticallyIngest } from "./permissions.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PlosResponseSchema = z.object({
  response: z.object({
    docs: z.array(z.object({
      id: z.string(),
      title_display: z.string().optional(),
      author_display: z.array(z.string()).optional(),
      publication_date: z.string().optional(),
      copyright: z.union([z.string(), z.array(z.string())]).optional(),
      abstract: z.union([z.string(), z.array(z.string())]).optional(),
      body: z.union([z.string(), z.array(z.string())]).optional(),
    }).passthrough()),
  }),
});

export interface PlosArticleCandidate {
  doi: string;
  title: string;
  authors: string[];
  publishedAt: string | null;
  license: string | null;
  articleUrl: string;
  registeredForIngestion: boolean;
}

interface PlosArticleParagraph {
  heading: string | null;
  text: string;
}

function articleParagraphs(value: string): PlosArticleParagraph[] {
  const safeBody = removeExcludedArticleBlocks(value);
  return [...safeBody.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].flatMap((match) => {
    const text = cleanArticleText(match[1] ?? "");
    if (text.length < 20) return [];
    const prefix = safeBody.slice(0, match.index);
    const heading = [...prefix.matchAll(/<(?:title|h[1-6])\b[^>]*>([\s\S]*?)<\/(?:title|h[1-6])\s*>/gi)]
      .map((candidate) => cleanArticleText(candidate[1] ?? ""))
      .filter(Boolean)
      .at(-1) ?? null;
    return [{ heading, text }];
  });
}

function isNamedLaLigaPlayeRankAnalysis(text: string): boolean {
  return /\b(?:La Liga|LaLiga)\b/i.test(text)
    && /\bPlayeRank\b/i.test(text)
    && /\bCristiano\s+Ronaldo\b/i.test(text)
    && /\bLionel\s+Messi\b/i.test(text);
}

function articleUrlForDoi(doi: string): string | null {
  const match = /^10\.1371\/journal\.(\w+)\./.exec(doi);
  if (!match) return null;
  const journalPaths: Record<string, string> = {
    pone: "plosone",
    pbio: "plosbiology",
    pmed: "plosmedicine",
    pcbi: "ploscompbiol",
    ppat: "plospathogens",
    pntd: "plosntd",
    pgen: "plosgenetics",
  };
  const journalPath = journalPaths[match[1]];
  if (!journalPath) return null;
  const url = new URL(`https://journals.plos.org/${journalPath}/article`);
  url.searchParams.set("id", doi);
  return url.toString();
}

function jatsArticleUrlForDoi(doi: string): string | null {
  const articleUrl = articleUrlForDoi(doi);
  if (!articleUrl) return null;
  const url = new URL(articleUrl);
  url.pathname = url.pathname.replace(/\/article$/u, "/article/file");
  url.searchParams.set("id", doi);
  url.searchParams.set("type", "manuscript");
  return url.toString();
}

function jatsBodyForDoi(xml: string, doi: string): string {
  const doiMatch = /<article-id\b[^>]*pub-id-type=["']doi["'][^>]*>([\s\S]*?)<\/article-id\s*>/i.exec(xml);
  const xmlDoi = doiMatch ? cleanArticleText(doiMatch[1] ?? "") : null;
  if (!xmlDoi || xmlDoi.toLocaleLowerCase() !== doi.toLocaleLowerCase()) {
    throw new Error("PLOS JATS XML DOI 不匹配（请求 " + doi + "，返回 " + (xmlDoi ?? "未提供") + "）；未生成资料。");
  }
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(xml)?.[1];
  if (!body) throw new Error("PLOS JATS XML 未包含正文节点；" + doi + " 未生成资料。");
  return body;
}

function stringField(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  return value?.join("\n") ?? "";
}

function cleanArticleText(value: string): string {
  return removeExcludedArticleBlocks(value)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rsquo;/gi, "’")
    .replace(/&ldquo;/gi, "“")
    .replace(/&rdquo;/gi, "”")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function removeExcludedArticleBlocks(value: string): string {
  const excludedElements = [
    "fig", "fig-group", "figure", "figure-group",
    "table", "table-wrap", "table-wrap-group",
    "supplementary-material", "supplementary-materials",
    "ref", "ref-list", "ack", "acknowledgements", "fn-group", "boxed-text", "ext-link",
  ];
  let content = value;
  let previous: string;
  do {
    previous = content;
    for (const element of excludedElements) {
      content = content.replace(new RegExp(`<${element}\\b[^>]*>[\\s\\S]*?<\\/${element}\\s*>`, "gi"), " ");
    }
  } while (content !== previous);
  return content;
}

export class PlosDiscoveryProvider {
  private lastRequestAt = 0;

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly minimumRequestIntervalMs = 6_000,
  ) {}

  async discover(query: string, options: { limit?: number; registryPath?: string } = {}): Promise<PlosArticleCandidate[]> {
    const searchText = query.trim();
    if (searchText.length < 2 || searchText.length > 300) throw new Error("PLOS 来源发现查询须为 2–300 个字符。");
    const limit = Math.min(20, Math.max(1, Math.floor(options.limit ?? 10)));
    const registryPath = path.resolve(options.registryPath ?? process.env.TACTISCOUT_KNOWLEDGE_SOURCES_FILE ?? path.join(projectRoot, "data", "knowledge", "sources.json"));
    const sourceRecords = KnowledgeSourceSchema.array().parse(JSON.parse(await readFile(registryPath, "utf8")) as unknown) as KnowledgeSource[];
    const url = new URL("https://api.plos.org/search");
    url.searchParams.set("q", searchText);
    url.searchParams.set("fl", "id,title_display,author_display,publication_date,copyright");
    url.searchParams.set("wt", "json");
    url.searchParams.set("rows", String(limit));
    const payload = await this.requestJson(url);
    return payload.response.docs.map((document) => {
      const articleUrl = articleUrlForDoi(document.id);
      return {
        doi: document.id,
        title: document.title_display ?? document.id,
        authors: document.author_display ?? [],
        publishedAt: document.publication_date ?? null,
        license: /creative commons attribution|\bcc by\b/i.test(stringField(document.copyright)) ? "CC BY (按文章声明)" : null,
        articleUrl: articleUrl ?? `https://doi.org/${encodeURIComponent(document.id)}`,
        registeredForIngestion: articleUrl !== null && sourceRecords.some((source) => canAutomaticallyIngest(source, articleUrl)),
      };
    });
  }

  async fetchRegisteredArticle(doi: string, options: { registryPath?: string } = {}): Promise<KnowledgeDocumentInput> {
    const sourceRecords = await this.readSources(options.registryPath);
    const articleUrl = articleUrlForDoi(doi);
    if (!articleUrl) throw new Error(`PLOS DOI ${doi} 暂不支持正文获取。`);
    const source = sourceRecords.find((candidate) => canAutomaticallyIngest(candidate, articleUrl));
    if (!source) throw new Error(`PLOS DOI ${doi} 尚无允许自动抓取、保存和 AI/RAG 处理的来源登记；未发出正文请求。`);
    const url = new URL("https://api.plos.org/search");
    url.searchParams.set("q", `id:"${doi}"`);
    url.searchParams.set("fl", "id,title_display,author_display,publication_date,copyright,abstract");
    url.searchParams.set("wt", "json");
    url.searchParams.set("rows", "1");
    const payload = await this.requestJson(url);
    const document = payload.response.docs.find((candidate) => candidate.id === doi);
    if (!document) throw new Error(`PLOS API 未返回 DOI ${doi} 的文章正文。`);
    const copyright = stringField(document.copyright);
    if (!/creative commons attribution|\bcc by\b/i.test(copyright)) {
      throw new Error(`PLOS API 未返回可核实的 CC BY 许可声明；${doi} 未入库。`);
    }
    const jatsUrl = jatsArticleUrlForDoi(doi);
    if (!jatsUrl) throw new Error("该 PLOS DOI 暂无官方 JATS XML 文章端点。");
    const jatsXml = await this.requestText(new URL(jatsUrl), "application/xml, text/xml");
    const articleBody = jatsBodyForDoi(jatsXml, doi);
    const articleText = articleParagraphs(articleBody).map(({ text }) => text).join("\n\n");
    const content = cleanArticleText([stringField(document.abstract), articleText].filter(Boolean).join("\n\n"));
    if (content.length < 40 || content.length > 200_000) throw new Error(`PLOS 正文长度 ${content.length} 超出当前自动入库范围。`);
    const title = document.title_display ?? doi;
    const authors = document.author_display ?? [];
    return KnowledgeDocumentInputSchema.parse({
      sourceId: source.id,
      corpus: source.allowedCorpora[0],
      title,
      url: articleUrl,
      author: authors.join(", ") || "PLOS 作者",
      publisher: source.publisher,
      publishedAt: document.publication_date ?? null,
      license: source.license,
      attribution: `${authors.join(", ") || "PLOS 作者"}. ${title}. DOI: ${doi}. ${articleUrl}. ${source.license}. Data Provided by PLOS. Metadata verified via Search API; text from official JATS XML; figures, tables, supplementary material, references, acknowledgements, boxed text, and linked external materials excluded.`,
      acquisition: "authorized_fetch",
      content,
    });
  }

  async fetchRegisteredEvidenceDocuments(
    doi: string,
    options: { registryPath?: string } = {},
  ): Promise<KnowledgeEvidenceDocumentInput[]> {
    const sourceRecords = await this.readSources(options.registryPath);
    const articleUrl = articleUrlForDoi(doi);
    if (!articleUrl) throw new Error("PLOS DOI 暂不支持正文获取。");
    const source = sourceRecords.find((candidate) => canAutomaticallyIngest(candidate, articleUrl));
    if (!source) throw new Error("该 PLOS DOI 尚无允许自动抓取、保存和 AI/RAG 处理的来源登记；未发出正文请求。");
    if (!source.allowedCorpora.includes("methodology") || !source.allowedCorpora.includes("player_report")) {
      throw new Error("该 PLOS 来源尚未分别登记为方法资料与球员定性资料来源。");
    }
    const url = new URL("https://api.plos.org/search");
    url.searchParams.set("q", "id:\"" + doi + "\"");
    url.searchParams.set("fl", "id,title_display,author_display,publication_date,copyright,abstract");
    url.searchParams.set("wt", "json");
    url.searchParams.set("rows", "1");
    const payload = await this.requestJson(url);
    const rawDocument = payload.response.docs.find((candidate) => candidate.id === doi);
    if (!rawDocument) throw new Error("PLOS API 未返回请求文章。");
    if (!/creative commons attribution|\bcc by\b/i.test(stringField(rawDocument.copyright))) {
      throw new Error("PLOS API 未返回可核实的 CC BY 许可声明；文章未入库。");
    }
    const jatsUrl = jatsArticleUrlForDoi(doi);
    if (!jatsUrl) throw new Error("该 PLOS DOI 暂无官方 JATS XML 文章端点。");
    const jatsXml = await this.requestText(new URL(jatsUrl), "application/xml, text/xml");
    const articleBody = jatsBodyForDoi(jatsXml, doi);

    const title = rawDocument.title_display ?? doi;
    const authors = rawDocument.author_display ?? [];
    const abstract = cleanArticleText(stringField(rawDocument.abstract));
    const paragraphs = articleParagraphs(articleBody);
    const playerParagraphs = paragraphs.filter(({ text }) => isNamedLaLigaPlayeRankAnalysis(text));
    if (!playerParagraphs.length) throw new Error("PLOS 正文没有包含指定的具名 La Liga PlayeRank 历史分析段落；没有生成球员定性资料。");
    const playerText = new Set(playerParagraphs.map(({ text }) => text));
    const methodologyParagraphs = paragraphs.filter(({ text }) => !playerText.has(text));
    if (abstract) methodologyParagraphs.unshift({ heading: "Abstract", text: abstract });
    const attribution = authors.join(", ") + ". " + title + ". DOI: " + doi + ". " + articleUrl
      + ". CC BY 4.0. Data Provided by PLOS. DOI and license verified with the official PLOS Search API; article text from the official PLOS JATS XML endpoint; figures, tables, references, acknowledgements and external links excluded.";
    const shared = {
      sourceId: source.id,
      url: articleUrl,
      author: authors.join(", ") || "PLOS 作者",
      publisher: source.publisher,
      publishedAt: rawDocument.publication_date ?? null,
      license: source.license,
      attribution,
      competition: null as string | null,
      season: null as string | null,
      observedFrom: null as string | null,
      observedTo: null as string | null,
      acquisition: "authorized_fetch" as const,
    };
    const methodContent = methodologyParagraphs.map(({ text }) => text).join("\n\n");
    const methodology = KnowledgeEvidenceDocumentInputSchema.parse({
      ...shared,
      evidenceType: "methodology",
      corpus: "methodology",
      title,
      content: methodContent,
      sections: methodologyParagraphs.map((paragraph, index) => ({
        id: "method-paragraph-" + String(index + 1),
        heading: paragraph.heading,
        kind: "paragraph" as const,
        text: paragraph.text,
        locator: "article-body/paragraph-" + String(index + 1),
      })),
    });
    const playerReport = KnowledgeEvidenceDocumentInputSchema.parse({
      ...shared,
      evidenceType: "historical_player_analysis",
      corpus: "player_report",
      title: title + " — La Liga historical analysis",
      content: playerParagraphs.map(({ text }) => text).join("\n\n"),
      entityIds: ["Q11571", "Q615"],
      entityNames: ["Cristiano Ronaldo", "Lionel Messi"],
      competition: "La Liga",
      season: "2017/18",
      sampleSummary: "Authors discuss the role of Cristiano Ronaldo and Lionel Messi in La Liga PlayeRank results. The paper describes its underlying top-five-league event sample as the 2017/18 season, but does not identify each player's specific match dates in this passage.",
      sections: playerParagraphs.map((paragraph, index) => ({
        id: "player-analysis-paragraph-" + String(index + 1),
        heading: paragraph.heading,
        kind: "paragraph" as const,
        text: paragraph.text,
        locator: "article-body/player-analysis-paragraph-" + String(index + 1),
      })),
    });
    return [methodology, playerReport];
  }

  private async readSources(registryPath?: string): Promise<KnowledgeSource[]> {
    const resolvedRegistryPath = path.resolve(registryPath ?? process.env.TACTISCOUT_KNOWLEDGE_SOURCES_FILE ?? path.join(projectRoot, "data", "knowledge", "sources.json"));
    return KnowledgeSourceSchema.array().parse(JSON.parse(await readFile(resolvedRegistryPath, "utf8")) as unknown);
  }

  private async waitForRequestSlot(): Promise<void> {
    const waitMs = Math.max(0, this.minimumRequestIntervalMs - (Date.now() - this.lastRequestAt));
    if (waitMs) await delay(waitMs);
    this.lastRequestAt = Date.now();
  }

  private async requestJson(url: URL) {
    await this.waitForRequestSlot();
    const response = await this.fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("PLOS API 请求失败（HTTP " + response.status + "）。");
    return PlosResponseSchema.parse(await response.json() as unknown);
  }

  private async requestText(url: URL, accept: string): Promise<string> {
    await this.waitForRequestSlot();
    const response = await this.fetcher(url, { headers: { accept }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("PLOS JATS XML 请求失败（HTTP " + response.status + "）。");
    return response.text();
  }
}
