# RAG pilot review

The packet `rag-review-packet.v1.json` contains 24 frozen starter questions: 12 methodology and 12 historical-player questions. It starts in `pending_human_review`; every question's answer/citation fields are intentionally blank. Model self-scores and test fixtures are not human review.

## Prepare the local corpus

1. Import the reviewed source-policy declarations with `pnpm knowledge:evidence -- import-sources`.
2. Build the two existing project-authored methodology summaries with `pnpm knowledge:evidence -- seed-methodology`.
3. Inspect the PLOS source without persisting it: `pnpm knowledge:evidence -- preview-plos 10.1371/journal.pone.0282295`. It verifies metadata and license through PLOS Search API, then reads structured JATS XML article text from the official PLOS article endpoint.
4. After checking the preview, publish both separately classified documents with `pnpm knowledge:evidence -- crawl-plos 10.1371/journal.pone.0282295`.
5. Prepare the model and current index before serving turns with `pnpm knowledge:evidence -- prepare-runtime`.

The PLOS player corpus is restricted to the authors' La Liga PlayeRank passage and the paper's 2017/18 sample season. The article's cited Wyscout, Transfermarkt/Kaggle, FBref, and ClubElo data are not included. The old SAGE candidate is not registered for AI/RAG use.

## Human review and fallback gate

For each packet item, record:

- `answerSupported`: whether the produced answer is directly supported by the resolved passage;
- `citationAccurate`: whether the stable reference and displayed source identify that passage;
- `abstentionAppropriate`: whether the answer abstained on unsupported claims and missing scopes;
- `reviewerNotes`: the reason for a failed or borderline result;
- `reviewedAt`: the review date.

Use `pnpm eval:rag-review -- summary` to see progress and `pnpm eval:rag-review -- record P01 --answer-supported yes --citation-accurate yes --abstention-appropriate no --notes "why the answer overclaimed"` to save one human review atomically. The summary counts only questions with all three Boolean judgments present.

Only after all 24 questions are reviewed should the acceptance record be updated with the question-packet SHA-256, source-registry SHA-256, active `indexGenerationId`, `evidenceSnapshotHash` from the evidence status command, embedding model, measured results, and review date. These pins must match at runtime; changing source policies, content, index generation, or packet content disables fallback until a new independent review. Keep `eligibleForProductionFallback` false unless the hybrid baseline has passed that review. Reranker errors otherwise produce an explicit unavailable result.
