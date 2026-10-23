import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KnowledgeEvidenceDocumentInputSchema, KnowledgeEvidenceSourceSchema, type KnowledgeEvidenceDocumentInput } from "./evidence-schemas.js";
import type { KnowledgeEvidenceMarkdownInput } from "./markdown-evidence.js";
import { createKnowledgeEvidence } from "./evidence.js";
import { starterKnowledgeDocuments } from "./seed.js";
import { PlosDiscoveryProvider } from "./plos-discovery.js";

const [command, ...argumentsList] = process.argv.slice(2).filter((argument) => argument !== "--");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function methodSummaryAsEvidence(): KnowledgeEvidenceDocumentInput[] {
  return starterKnowledgeDocuments.map((document, index) => KnowledgeEvidenceDocumentInputSchema.parse({
    ...document,
    sections: [{
      id: `authored-method-summary-${index + 1}`,
      heading: "Project-authored method summary",
      kind: "paragraph",
      text: document.content,
      locator: `project-summary/${index + 1}`,
    }],
  }));
}

const usage = `用法：
  pnpm knowledge:evidence -- status
  pnpm knowledge:evidence -- import-sources
  pnpm knowledge:evidence -- prepare-runtime
  pnpm knowledge:evidence -- seed-methodology
  pnpm knowledge:evidence -- preview-plos <DOI>
  pnpm knowledge:evidence -- crawl-plos <DOI>
  pnpm knowledge:evidence -- crawl-plos-batch <DOI> [<DOI> ...]
  pnpm knowledge:evidence -- ingest <document.json>
  pnpm knowledge:evidence -- ingest-markdown <metadata.json> <document.md>
  pnpm knowledge:evidence -- source-history <source-id>
  pnpm knowledge:evidence -- revoke-source <source-id> [--erase]

preview-plos 只读取已登记来源并展示可入库片段，不写入权威目录；crawl-plos 会抓取、发布并重建派生索引。`;

const system = createKnowledgeEvidence();
try {
  if (command === "status") {
    console.log(JSON.stringify(await system.admin.status(), null, 2));
  } else if (command === "prepare-runtime") {
    const result = await system.admin.prepareRuntime();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
  } else if (command === "import-sources") {
    const registryPath = path.resolve(process.env.TACTISCOUT_KNOWLEDGE_SOURCES_FILE ?? path.join(projectRoot, "data", "knowledge", "sources.json"));
    const sources = KnowledgeEvidenceSourceSchema.array().parse(JSON.parse(await readFile(registryPath, "utf8")) as unknown);
    await system.admin.registerSources(sources);
    console.log(JSON.stringify({ importedPolicyCount: sources.length, registryPath }, null, 2));
  } else if (command === "seed-methodology") {
    const published = [];
    for (const document of methodSummaryAsEvidence()) published.push(await system.admin.publishDocument(document));
    console.log(JSON.stringify({ published }, null, 2));
  } else if ((command === "preview-plos" || command === "crawl-plos") && argumentsList[0]) {
    const documents = await new PlosDiscoveryProvider().fetchRegisteredEvidenceDocuments(argumentsList[0]!);
    if (command === "preview-plos") {
      console.log(JSON.stringify(documents.map((document) => ({
        corpus: document.corpus,
        title: document.title,
        author: document.author,
        url: document.url,
        attribution: document.attribution,
        sampleSummary: document.sampleSummary,
        sections: document.sections?.map((section) => ({ heading: section.heading, locator: section.locator, text: section.text.slice(0, 1_600) })),
      })), null, 2));
    } else {
      const published = [];
      for (const document of documents) published.push(await system.admin.publishDocument(document));
      console.log(JSON.stringify({ published }, null, 2));
    }
  } else if (command === "crawl-plos-batch" && argumentsList.length > 0) {
    if (argumentsList.length > 20) throw new Error("一次批量抓取最多处理 20 个 DOI。");
    const provider = new PlosDiscoveryProvider();
    const documents: KnowledgeEvidenceDocumentInput[] = [];
    for (const doi of argumentsList) documents.push(...await provider.fetchRegisteredEvidenceDocuments(doi));
    const published = await system.admin.publishDocuments(documents);
    console.log(JSON.stringify({ requestedDoiCount: argumentsList.length, documentCount: documents.length, published }, null, 2));
  } else if (command === "ingest" && argumentsList[0]) {
    const filename = path.resolve(argumentsList[0]!);
    const raw = await readFile(filename, "utf8");
    const document = KnowledgeEvidenceDocumentInputSchema.parse({
      ...JSON.parse(raw) as Record<string, unknown>,
      normalizationVersion: "json-sections-v1",
      sourcePayloadSha256: createHash("sha256").update(raw).digest("hex"),
    });
    console.log(JSON.stringify(await system.admin.publishDocument(document), null, 2));
  } else if (command === "ingest-markdown" && argumentsList[0] && argumentsList[1]) {
    const metadataPath = path.resolve(argumentsList[0]!);
    const markdownPath = path.resolve(argumentsList[1]!);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as KnowledgeEvidenceMarkdownInput["metadata"];
    const markdown = await readFile(markdownPath, "utf8");
    console.log(JSON.stringify(await system.admin.publishMarkdownDocument({ metadata, markdown }), null, 2));
  } else if (command === "revoke-source" && argumentsList[0]) {
    await system.admin.revokeSource(argumentsList[0]!, { eraseStoredContent: argumentsList.includes("--erase") });
    console.log(JSON.stringify({ revokedSourceId: argumentsList[0], erasedStoredContent: argumentsList.includes("--erase") }, null, 2));
  } else if (command === "source-history" && argumentsList[0]) {
    console.log(JSON.stringify(await system.admin.sourceHistory(argumentsList[0]!), null, 2));
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Knowledge evidence command failed.";
  console.error(message);
  process.exitCode = 1;
} finally {
  await system.close();
}
