import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import {
  KnowledgeEvidenceDocumentInputSchema,
  EvidencePlayerSubjectSchema,
  type KnowledgeEvidenceDocumentInput,
  type EvidencePlayerSubject,
} from "./evidence-schemas.js";
import {
  KnowledgeDocumentInputSchema,
  KnowledgeSourceSchema,
  type KnowledgeDocumentInput,
  type KnowledgeSource,
} from "./schemas.js";
import { canAutomaticallyIngest } from "./permissions.js";
import { parsePlosJatsArticle, type ParsedJatsSection } from "./plos-jats.js";

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

const PlosCurationManifestSchema = z.object({
  schemaVersion: z.literal("knowledge-evidence-curation-v1"),
  playerAnalysisPassages: z.array(z.object({
    sourceId: z.string().min(1),
    doi: z.string().min(1),
    paragraphTextSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    subjects: z.array(EvidencePlayerSubjectSchema).min(1).max(10),
    competition: z.string().trim().min(1).max(120),
    season: z.string().trim().min(2).max(40),
    observedFrom: z.iso.date().nullable().default(null),
    observedTo: z.iso.date().nullable().default(null),
    sampleSummary: z.string().trim().min(1).max(2_000),
  })),
});

function toEvidenceSection(section: ParsedJatsSection) {
  return {
    id: section.id,
    heading: section.heading,
    kind: section.kind,
    text: section.text,
    locator: section.locator,
  };
}

function documentContent(sections: Array<{ text: string }>): string {
  return sections.map(({ text }) => text).join("\n\n");
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
    const article = parsePlosJatsArticle(jatsXml, doi);
    const articleText = [...article.abstract, ...article.body].map(({ text }) => text).join("\n\n");
    const content = cleanArticleText([stringField(document.abstract), articleText].filter(Boolean).join("\n\n"));
    if (content.length < 40 || content.length > 200_000) throw new Error(`PLOS 正文长度 ${content.length} 超出当前自动入库范围。`);
    const title = document.title_display ?? article.title ?? doi;
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
    options: { registryPath?: string; curationPath?: string } = {},
  ): Promise<KnowledgeEvidenceDocumentInput[]> {
    const sourceRecords = await this.readSources(options.registryPath);
    const articleUrl = articleUrlForDoi(doi);
    if (!articleUrl) throw new Error("PLOS DOI 暂不支持正文获取。");
    const source = sourceRecords.find((candidate) => canAutomaticallyIngest(candidate, articleUrl));
    if (!source) throw new Error("该 PLOS DOI 尚无允许自动抓取、保存和 AI/RAG 处理的来源登记；未发出正文请求。");
    const curationManifest = await this.readCurationManifest(options.curationPath);
    const playerCuration = curationManifest.playerAnalysisPassages.filter((entry) => entry.doi === doi && entry.sourceId === source.id);
    if (playerCuration.length && !source.allowedCorpora.includes("player_report")) {
      throw new Error("具名球员段落清单与来源允许的语料不一致；未发出正文请求。");
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
    const sourcePayloadSha256 = createHash("sha256").update(jatsXml).digest("hex");
    const article = parsePlosJatsArticle(jatsXml, doi);

    const title = rawDocument.title_display ?? article.title ?? doi;
    const authors = rawDocument.author_display ?? [];
    const abstractSections = article.abstract.length
      ? article.abstract
      : (() => {
        const text = cleanArticleText(stringField(rawDocument.abstract));
        if (!text) return [];
        const textSha256 = createHash("sha256").update(text).digest("hex");
        return [{ id: "abstract-" + textSha256.slice(0, 24), heading: "Abstract", kind: "paragraph" as const, text, locator: "search-api/abstract", textSha256 }];
      })();
    const allSections = [...abstractSections, ...article.body];
    const selectedByHash = new Map<string, ParsedJatsSection>();
    for (const selection of playerCuration) {
      const matches = article.body.filter(({ textSha256 }) => textSha256 === selection.paragraphTextSha256);
      if (matches.length !== 1) {
        throw new Error(`具名球员段落清单要求 DOI ${doi} 精确匹配一个原文段落，实际匹配 ${matches.length} 个；没有发布资料。`);
      }
      selectedByHash.set(selection.paragraphTextSha256, matches[0]!);
    }
    const selectedSectionIds = new Set([...selectedByHash.values()].map(({ id }) => id));
    const attribution = `${authors.join(", ") || "PLOS 作者"}. ${title}. DOI: ${doi}. ${articleUrl}. ${source.license}. Data Provided by PLOS. DOI and license verified via the official PLOS Search API; text from the official JATS XML article endpoint. The importer preserves article section/paragraph structure and excludes figures, tables, supplementary material, references, acknowledgements, boxed text and linked external materials unless a source-specific policy explicitly admits them.`;
    const common = {
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
      normalizationVersion: "plos-jats-v1",
      sourcePayloadSha256,
    };
    const documents: KnowledgeEvidenceDocumentInput[] = [];
    if (source.allowedCorpora.includes("methodology")) {
      const methodologySections = allSections.filter(({ id }) => !selectedSectionIds.has(id)).map(toEvidenceSection);
      const content = documentContent(methodologySections);
      if (content.length >= 40) documents.push(KnowledgeEvidenceDocumentInputSchema.parse({
        ...common,
        evidenceType: "methodology",
        corpus: "methodology",
        title,
        content,
        sections: methodologySections,
      }));
    }
    if (source.allowedCorpora.includes("player_report")) {
      for (const selection of playerCuration) {
        const passage = selectedByHash.get(selection.paragraphTextSha256)!;
        const sections = [toEvidenceSection(passage)];
        documents.push(KnowledgeEvidenceDocumentInputSchema.parse({
          ...common,
          evidenceType: "historical_player_analysis",
          corpus: "player_report",
          title: `${title} — ${selection.competition} historical analysis`,
          url: `${articleUrl}#evidence-${selection.paragraphTextSha256.slice(0, 16)}`,
          content: documentContent(sections),
          entityIds: selection.subjects.map(({ subjectId }) => subjectId),
          entityNames: selection.subjects.map(({ displayName }) => displayName),
          competition: selection.competition,
          season: selection.season,
          observedFrom: selection.observedFrom,
          observedTo: selection.observedTo,
          sampleSummary: selection.sampleSummary,
          sections,
        }));
      }
    }
    if (!documents.length) throw new Error(`PLOS DOI ${doi} 没有符合来源授权和显式内容分类清单的资料；未生成资料。`);
    return documents;
  }

  private async readSources(registryPath?: string): Promise<KnowledgeSource[]> {
    const resolvedRegistryPath = path.resolve(registryPath ?? process.env.TACTISCOUT_KNOWLEDGE_SOURCES_FILE ?? path.join(projectRoot, "data", "knowledge", "sources.json"));
    return KnowledgeSourceSchema.array().parse(JSON.parse(await readFile(resolvedRegistryPath, "utf8")) as unknown);
  }

  private async readCurationManifest(curationPath?: string) {
    const resolvedPath = path.resolve(curationPath ?? process.env.TACTISCOUT_KNOWLEDGE_EVIDENCE_CURATION_FILE ?? path.join(projectRoot, "data", "knowledge", "evidence-curation.v1.json"));
    const value = JSON.parse(await readFile(resolvedPath, "utf8")) as unknown;
    return PlosCurationManifestSchema.parse(value);
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
