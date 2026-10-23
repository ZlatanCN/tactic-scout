import { createHash } from "node:crypto";
import { marked, type Token, type Tokens } from "marked";
import { z } from "zod/v4";
import {
  KnowledgeEvidenceDocumentInputSchema,
  KnowledgeEvidenceDocumentMetadataSchema,
  type KnowledgeEvidenceDocumentInput,
  type KnowledgeEvidenceSection,
} from "./evidence-schemas.js";

export const KnowledgeEvidenceMarkdownInputSchema = z.object({
  metadata: KnowledgeEvidenceDocumentMetadataSchema,
  markdown: z.string().min(1).max(1_000_000),
});
export type KnowledgeEvidenceMarkdownInput = z.infer<typeof KnowledgeEvidenceMarkdownInputSchema>;

function normalizeText(value: string): string {
  return value.replace(/\u00a0/gu, " ").replace(/[\t\f\v ]+/gu, " ").replace(/ *\n */gu, "\n").trim();
}

function childrenText(token: Token): string {
  const value = token as Token & { tokens?: Token[]; text?: unknown };
  if (Array.isArray(value.tokens)) return tokensText(value.tokens);
  return typeof value.text === "string" ? value.text : "";
}

function tokensText(tokens: Token[]): string {
  const parts: string[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "html":
        throw new Error("Markdown 原文含 raw HTML 块/标签；当前导入器拒绝解释可执行或结构不明的 HTML。");
      case "space":
      case "def":
      case "hr":
      case "checkbox":
        break;
      case "br":
        parts.push(" ");
        break;
      case "image":
        parts.push(childrenText(token));
        break;
      case "link":
      case "em":
      case "strong":
      case "del":
      case "blockquote":
        parts.push(childrenText(token));
        break;
      case "list":
        parts.push((token as Tokens.List).items.map((item: Tokens.ListItem) => tokensText(item.tokens)).filter(Boolean).join("\n"));
        break;
      case "list_item":
        parts.push(childrenText(token));
        break;
      default:
        parts.push(childrenText(token));
        break;
    }
  }
  return normalizeText(parts.filter(Boolean).join(" "));
}

function blockLocator(markdown: string, raw: string, cursor: number, ordinal: number): { locator: string; nextCursor: number } {
  const found = raw ? markdown.indexOf(raw, cursor) : -1;
  const offset = found >= 0 ? found : cursor;
  return {
    locator: `markdown:utf16:${offset}:block:${ordinal}`,
    nextCursor: found >= 0 ? found + raw.length : cursor,
  };
}

export function parseMarkdownKnowledgeEvidence(input: KnowledgeEvidenceMarkdownInput): KnowledgeEvidenceDocumentInput {
  const parsedInput = KnowledgeEvidenceMarkdownInputSchema.parse(input);
  const tokens = marked.lexer(parsedInput.markdown, { gfm: true });
  const sections: KnowledgeEvidenceSection[] = [];
  const headingPath: string[] = [];
  let cursor = 0;
  let ordinal = 0;

  const addSection = (section: Omit<KnowledgeEvidenceSection, "id">): void => {
    if (!section.text.trim()) return;
    ordinal += 1;
    const idHash = createHash("sha256").update(`${section.locator}\n${section.kind}\n${section.text}`).digest("hex").slice(0, 24);
    sections.push({ id: `md-${idHash}`, ...section });
  };

  for (const token of tokens) {
    const position = blockLocator(parsedInput.markdown, token.raw, cursor, ordinal + 1);
    cursor = position.nextCursor;
    if (token.type === "heading") {
      const headingToken = token as Tokens.Heading;
      const heading = tokensText(headingToken.tokens);
      headingPath.length = headingToken.depth - 1;
      headingPath.push(heading);
      continue;
    }
    if (token.type === "space" || token.type === "def" || token.type === "hr") continue;
    if (token.type === "html") throw new Error("Markdown 原文含 raw HTML 块/标签；当前导入器拒绝解释可执行或结构不明的 HTML。");
    if (token.type === "paragraph" || token.type === "text") {
      const text = tokensText((token as Tokens.Paragraph | Tokens.Text).tokens ?? []);
      addSection({ heading: headingPath.join(" / ") || null, kind: "paragraph", text, locator: position.locator });
      continue;
    }
    if (token.type === "code") {
      addSection({ heading: headingPath.join(" / ") || null, kind: "paragraph", text: normalizeText((token as Tokens.Code).text), locator: position.locator });
      continue;
    }
    if (token.type === "list") {
      (token as Tokens.List).items.forEach((item: Tokens.ListItem, itemIndex: number) => {
        const text = tokensText(item.tokens);
        addSection({
          heading: headingPath.join(" / ") || null,
          kind: "list_item",
          text,
          locator: `${position.locator}/item:${itemIndex + 1}`,
        });
      });
      continue;
    }
    if (token.type === "table") {
      const tableToken = token as Tokens.Table;
      const headers = tableToken.header.map((cell: Tokens.TableCell) => tokensText(cell.tokens));
      tableToken.rows.forEach((row: Tokens.TableCell[], rowIndex: number) => {
        const values = row.map((cell: Tokens.TableCell) => tokensText(cell.tokens));
        const text = headers.map((header: string, index: number) => `${header}: ${values[index] ?? ""}`).filter((cell: string) => cell.trim()).join(" | ");
        addSection({ heading: headingPath.join(" / ") || null, kind: "table", text, locator: `${position.locator}/row:${rowIndex + 1}` });
      });
      continue;
    }
    if (token.type === "blockquote") {
      const text = tokensText((token as Tokens.Blockquote).tokens);
      addSection({ heading: [...headingPath, "引用段落"].join(" / "), kind: "paragraph", text, locator: position.locator });
      continue;
    }
    throw new Error(`Markdown 包含当前不支持的块类型 ${token.type}；未发布资料。`);
  }

  const content = sections.map(({ text }) => text).join("\n\n");
  if (content.trim().length < 40) throw new Error("Markdown 解析后正文太短，未发布资料。");
  return KnowledgeEvidenceDocumentInputSchema.parse({
    ...parsedInput.metadata,
    normalizationVersion: "markdown-gfm-v1",
    sourcePayloadSha256: createHash("sha256").update(parsedInput.markdown).digest("hex"),
    content,
    sections,
  });
}
