# RAG evaluation

## Current RAG v2 workflow

The active evaluation workflow is RAG v2. Its design and current run status are in [the RAG v2 implementation guide](../../../.scratch/rag-v2/implementation.md). The frozen inputs are `rag-v2-question-pack.v5.json` and `rag-v2-judge-controls.v5.json`; the current budget stop record is `rag-v2-pipeline-preflight.v5-budget-exhausted.json`.

RAG v2 uses source-grounded, automatically generated questions and same-gateway semantic judges. All quality labels are AI automatic estimates; no artifact from this workflow is human review or domain ground truth. Development comparisons are available in `rag-v2-ranking-comparison-dev.v5.json` (hybrid/gateway/local ranking) and `rag-v2-retrieval-strategy-comparison-dev.v5.json` (full-text/dense-vector/hybrid retrieval). The frozen validation candidate, fixed baseline, Oracle and acceptance phases have run under the user-authorized 1,300-call ceiling. The budget account is 1,257/1,300, including conservative prior charges. The final record `rag-v2-acceptance-v5-authorized-1300-reconciled.json` is `not_accepted`: the candidate regressed against baseline, the baseline missed support/refusal targets, and five control judgments remained unresolved. An earlier candidate artifact is diagnostic only because repeated runs reused exhausted investigation ledgers; case IDs now include the evaluation run ID. Failed, incomplete or unresolved results must not be represented as accepted.

The earlier 24-question packet, manual review recorder and three-agent AI panel below belong to the historical pilot. They are retained for reproducibility and are not the acceptance path for RAG v2.

## Historical 24-question pilot

The pilot packet `rag-review-packet.v1.json` contains 24 starter questions: 12 methodology and 12 historical-player questions. Question content is frozen independently of mutable review records. This packet is not the current v5 RAG v2 benchmark.

The packet records human judgments only when a human reviewer is used; AI panel judgments are stored separately and are never labeled human review.

## Prepare the local corpus

1. Import the reviewed source-policy declarations with `pnpm knowledge:evidence -- import-sources`.
2. Build the two existing project-authored methodology summaries with `pnpm knowledge:evidence -- seed-methodology`.
3. Inspect the PLOS source without persisting it: `pnpm knowledge:evidence -- preview-plos 10.1371/journal.pone.0282295`. It verifies metadata and license through PLOS Search API, then reads structured JATS XML article text from the official PLOS article endpoint.
4. After checking the preview, publish both separately classified documents with `pnpm knowledge:evidence -- crawl-plos 10.1371/journal.pone.0282295`.
5. Prepare the model and current index before serving turns with `pnpm knowledge:evidence -- prepare-runtime`.

The PLOS player corpus is restricted to the authors' La Liga PlayeRank passage and the paper's 2017/18 sample season. The article's cited Wyscout, Transfermarkt/Kaggle, FBref, and ClubElo data are not included. The old SAGE candidate is not registered for AI/RAG use.

## Run the frozen questions

Run `pnpm eval:rag-run` after the corpus is ready. It uses the configured chat gateway model for answer generation and, by default, evaluates both the hybrid baseline and gateway-reranked path. It writes an attributed result artifact under `data/knowledge/evaluation/runs/` and prints its path. Each result contains the retrieval outcome, stable references, visible passages, model answer and citations, ranking mode, latency, token usage where available, packet/source hashes, and the active generation/snapshot.

The hybrid path is explicitly enabled only for `purpose: evaluation`, so it can be measured before baseline acceptance. This does not enable hybrid fallback for recruitment requests. `--ranking-mode hybrid` and `--ranking-mode gateway_reranked` run one path; `--only M01 --only P01` is for diagnostics and produces an incomplete run that cannot be used for formal human review. The runner never sends the expected answer outline or disposition to the answer model and does not assign correctness scores. Its expected-source hit rate is source-level recall only.

## Review modes and fallback gate

For each packet item, record:

- `answerSupported`: whether the produced answer is directly supported by the resolved passage;
- `citationAccurate`: whether the stable reference and displayed source identify that passage;
- `abstentionAppropriate`: whether the answer abstained on unsupported claims and missing scopes;
- `reviewerNotes`: the reason for a failed or borderline result;
- `reviewedAt`: the review date.

Use `pnpm eval:rag-review -- summary` to see separate human-review progress for hybrid and gateway-reranked runs. A human judgment is recorded against one complete run with `pnpm eval:rag-review -- record P01 --run-file data/knowledge/evaluation/runs/<run-file>.json --mode hybrid --answer-supported yes --citation-accurate yes --abstention-appropriate no --notes "why the answer overclaimed"`.

For this pilot, the user explicitly chose a three-agent isolated AI panel instead of additional manual ratings. The panel reviews only the question, generated answer, retrieved passages and source metadata; each reviewer first votes independently without the answer outline or peer opinions. A moderator then shares anonymized initial rationales and asks each reviewer to challenge and finalize their votes. Store the report separately as `rag-ai-panel-review.v1.json`, label it `blind_ai_panel`, and keep each reviewer identified as an AI subagent. Do not write panel results into the human-review fields. A baseline can qualify through this mode only when the panel artifact matches the complete question packet, source registry, run, generation and snapshot, and all 24 questions receive unanimous final “yes” judgments on answer support, citation accuracy and abstention behavior.

Only after a complete review should the acceptance record be updated with the actual review mode, question-packet SHA-256, source-registry SHA-256, `evaluationRunId` and `evaluationRunSha256`, active `indexGenerationId`, `evidenceSnapshotHash`, embedding model, measured results, and review date. These pins must match at runtime; changing source policies, content, index generation, or question content disables fallback until a new review. Keep `eligibleForProductionFallback` false unless the selected review process accepts the hybrid baseline. Reranker errors otherwise produce an explicit unavailable result.
