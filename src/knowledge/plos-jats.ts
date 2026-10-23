import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const excludedElements = new Set([
  "ack",
  "acknowledgements",
  "boxed-text",
  "fig",
  "fig-group",
  "figure",
  "figure-group",
  "ext-link",
  "fn-group",
  "media",
  "ref-list",
  "supplementary-material",
  "supplementary-materials",
  "table",
  "table-wrap",
  "table-wrap-group",
]);

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: {
    enabled: true,
    maxEntityCount: 100,
    maxEntitySize: 10_000,
    maxExpansionDepth: 8,
    maxTotalExpansions: 1_000,
    maxExpandedLength: 2_000_000,
  },
  maxNestedTags: 80,
});

type XmlNode = Record<string, unknown>;

export interface ParsedJatsSection {
  id: string;
  heading: string | null;
  kind: "paragraph" | "list_item";
  text: string;
  locator: string;
  textSha256: string;
}

export interface ParsedJatsArticle {
  doi: string;
  title: string | null;
  abstract: ParsedJatsSection[];
  body: ParsedJatsSection[];
}

function elementName(node: XmlNode): string | null {
  return Object.keys(node).find((key) => key !== ":@" && key !== "#text") ?? null;
}

function children(node: XmlNode): XmlNode[] {
  const name = elementName(node);
  const value = name ? node[name] : null;
  return Array.isArray(value) ? value.filter((child): child is XmlNode => Boolean(child) && typeof child === "object") : [];
}

function elementChildren(nodes: XmlNode[], name: string): XmlNode[] {
  return nodes.filter((node) => elementName(node) === name);
}

function attributes(node: XmlNode): Record<string, unknown> {
  const value = node[":@"];
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizedText(value: string): string {
  return value.replace(/\u00a0/gu, " ").replace(/\s+/gu, " ").trim();
}

function textContent(nodes: XmlNode[]): string {
  const fragments: string[] = [];
  for (const node of nodes) {
    if (typeof node["#text"] === "string") {
      fragments.push(node["#text"] as string);
      continue;
    }
    const name = elementName(node);
    if (!name || excludedElements.has(name)) continue;
    const value = textContent(children(node));
    if (value) fragments.push(` ${value} `);
  }
  return normalizedText(fragments.join(""));
}

function locatorSegment(name: string, index: number, node: XmlNode): string {
  const id = attributes(node)["@_id"];
  return typeof id === "string" && id.trim()
    ? `${name}[@id='${id.replace(/'/gu, "&apos;")}']`
    : `${name}[${index}]`;
}

function block(input: {
  sectionPath: string[];
  locator: string;
  kind: ParsedJatsSection["kind"];
  text: string;
}): ParsedJatsSection {
  const heading = input.sectionPath.length ? input.sectionPath.join(" / ") : null;
  const id = createHash("sha256").update(`${input.locator}\n${input.kind}\n${input.text}`).digest("hex").slice(0, 32);
  return {
    id: `jats-${id}`,
    heading,
    kind: input.kind,
    text: input.text,
    locator: input.locator,
    textSha256: createHash("sha256").update(input.text).digest("hex"),
  };
}

function parseBlocks(container: XmlNode, initialHeadingPath: string[], initialLocator: string): ParsedJatsSection[] {
  const result: ParsedJatsSection[] = [];

  const visit = (node: XmlNode, headingPath: string[], locator: string): void => {
    const nodeChildren = children(node);
    const childCounts = new Map<string, number>();
    for (const child of nodeChildren) {
      const name = elementName(child);
      if (!name || name === "title" || excludedElements.has(name)) continue;
      const index = (childCounts.get(name) ?? 0) + 1;
      childCounts.set(name, index);
      const childLocator = `${locator}/${locatorSegment(name, index, child)}`;

      if (name === "sec") {
        const title = normalizedText(textContent(elementChildren(children(child), "title")));
        visit(child, title ? [...headingPath, title] : headingPath, childLocator);
        continue;
      }

      if (name === "p") {
        const text = textContent(children(child));
        if (text) result.push(block({ sectionPath: headingPath, locator: childLocator, kind: "paragraph", text }));
        continue;
      }

      if (name === "list") {
        const listItems = elementChildren(children(child), "list-item");
        listItems.forEach((item, listIndex) => {
          const itemText = textContent(children(item));
          if (itemText) {
            const itemLocator = `${childLocator}/${locatorSegment("list-item", listIndex + 1, item)}`;
            result.push(block({ sectionPath: headingPath, locator: itemLocator, kind: "list_item", text: itemText }));
          }
        });
        continue;
      }

      visit(child, headingPath, childLocator);
    }
  };

  visit(container, initialHeadingPath, initialLocator);
  return result;
}

function descendants(nodes: XmlNode[], name: string): XmlNode[] {
  const result: XmlNode[] = [];
  const visit = (node: XmlNode): void => {
    const currentName = elementName(node);
    if (currentName === name) result.push(node);
    if (currentName && excludedElements.has(currentName)) return;
    for (const child of children(node)) visit(child);
  };
  for (const node of nodes) visit(node);
  return result;
}

/** Parse only public article structure; external DTDs and linked material are never fetched. */
export function parsePlosJatsArticle(xml: string, requestedDoi: string): ParsedJatsArticle {
  if (Buffer.byteLength(xml, "utf8") > 5_000_000) throw new Error("PLOS JATS XML 超过当前安全解析上限。");
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (validation !== true) throw new Error("PLOS JATS XML 格式无效；未生成资料。" + (typeof validation === "object" ? ` ${validation.err.msg}` : ""));
  const document = parser.parse(xml) as XmlNode[];
  const articleIds = descendants(document, "article-id");
  const doi = articleIds
    .find((node) => attributes(node)["@_pub-id-type"] === "doi")
    ? normalizedText(textContent(children(articleIds.find((node) => attributes(node)["@_pub-id-type"] === "doi")!)))
    : null;
  if (!doi || doi.toLocaleLowerCase() !== requestedDoi.toLocaleLowerCase()) {
    throw new Error(`PLOS JATS XML DOI 不匹配（请求 ${requestedDoi}，返回 ${doi ?? "未提供"}）；未生成资料。`);
  }

  const article = descendants(document, "article")[0];
  if (!article) throw new Error(`PLOS JATS XML 未包含 article 节点；${requestedDoi} 未生成资料。`);
  const front = elementChildren(children(article), "front")[0];
  const articleMeta = front ? elementChildren(children(front), "article-meta")[0] : undefined;
  const titleNode = articleMeta ? descendants(children(articleMeta), "article-title")[0] : undefined;
  const title = titleNode ? normalizedText(textContent(children(titleNode))) : null;
  const abstractNodes = articleMeta ? elementChildren(children(articleMeta), "abstract") : [];
  const abstract = abstractNodes.flatMap((node, index) => parseBlocks(node, ["Abstract"], `jats:/front/article-meta/abstract[${index + 1}]`));
  const body = elementChildren(children(article), "body")[0];
  if (!body) throw new Error(`PLOS JATS XML 未包含正文节点；${requestedDoi} 未生成资料。`);
  const sections = parseBlocks(body, [], "jats:/body");
  if (!sections.length) throw new Error(`PLOS JATS XML 没有可入库的正文段落；${requestedDoi} 未生成资料。`);
  return { doi, title, abstract, body: sections };
}
