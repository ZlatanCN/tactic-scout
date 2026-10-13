import type { MethodologySourceReference } from "../domain/schemas.js";
import type { KnowledgeSearchResult } from "../knowledge/schemas.js";

function canonicalArticleUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.searchParams.sort();
  return url.toString();
}

export function collectMethodologySourceReferences(
  results: readonly KnowledgeSearchResult[],
): MethodologySourceReference[] {
  const referencesByUrl = new Map<string, MethodologySourceReference>();

  for (const result of results) {
    if (result.corpus !== "methodology" || !result.displayAllowed) continue;

    const key = canonicalArticleUrl(result.url);
    if (referencesByUrl.has(key)) continue;

    referencesByUrl.set(key, {
      title: result.title,
      url: result.url,
      author: result.author,
      publisher: result.publisher,
      publishedAt: result.publishedAt,
      license: result.license,
      attribution: result.attribution,
    });
  }

  return [...referencesByUrl.values()];
}
