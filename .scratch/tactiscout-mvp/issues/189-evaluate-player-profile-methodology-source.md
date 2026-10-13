# Evaluate a licensed player-profiling methodology source

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Evaluate whether one publisher-authorized PLOS paper on multivariate offensive/defensive player profiling adds useful methodology RAG coverage without weakening abstention. Keep this source separate from player statistics and recruitment-score evidence.

## Candidate

- DOI: `10.1371/journal.pone.0353239`
- Publisher page: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0353239
- Research and permissions assessment: [issue 188 source review](../research/methodology-rag-additional-sources-2026-10-13.md)
- Proposed corpus: attributed method text only. Do not import the linked player-statistics dataset, player-level rows, figures, tables, supplements, or third-party materials.

## Confirmed verification seams

1. `PlosDiscoveryProvider.fetchRegisteredArticle(doi)`: verify that an exact registered DOI is required, publisher-returned metadata must confirm the article and CC BY license, attribution survives, and excluded figure/table/supplement/reference content does not enter the returned document.
2. `compareMethodologyRetrievalV4({ baselineKnowledgeBase, candidateKnowledgeBase, dataset })`: verify source-specific answerable/ambiguous/out-of-scope evaluation, calibration/held-out query-family separation, and an inclusion-versus-exclusion ablation over the same index, queries, embedding model, and retrieval policy.

The user confirmed both public test interfaces on 2026-10-13. The comparison seam receives both source-off and source-on knowledge bases so both arms use the same physical index while source eligibility differs by registry.

## Evaluation design

- In both calibration and held-out splits, label at least one answerable query for each external methodology source; add two distinct answerable families for the candidate paper so its claimed coverage is not decided by one paraphrase.
- Candidate-paper questions should cover PCA/SHAP profile construction, the paper's interpretation of offensive involvement/volume versus lower efficiency-metric loadings, defensive profile indicators, and limits on generalizing index reconstruction to recruitment decisions.
- Include ambiguous questions about applying an analytical profile to a named recruitment decision, and out-of-scope questions about current player rankings, transfer value, availability, or future performance.
- Keep query families disjoint between calibration and held-out. Use the same frozen v4 set and current production policy for source-off and source-on; do not alter the threshold after seeing held-out results.
- Source-on earns adoption only if held-out retrieval adds relevant evidence for candidate-paper questions while the comparison shows no added unsupported ambiguous or out-of-scope acceptances.

## Acceptance criteria

- [x] Keep the article-specific permission record isolated to the v4 evaluation registry; verify reuse, automated fetch, local storage, AI processing, display, and attribution without enabling the source in production.
- [x] Fetch only the exact DOI through the official PLOS API; verify the returned DOI and CC BY metadata, preserve attribution, and exclude figures, tables, supplements, references, linked third-party material, and underlying football statistics.
- [x] Add an immutable `methodology-rag-v4` dataset with source-focused calibration and held-out query families, including answerable, ambiguous, and out-of-scope examples.
- [x] Evaluate source-off and source-on against the same local index, embedding model, dataset, and existing retrieval policy; report relevant evidence coverage, source-pair precision/recall, ambiguity acceptance, and out-of-scope false acceptance.
- [x] Preserve v2/v3 datasets and the current production retrieval threshold. Do not tune on held-out queries.
- [x] Keep corpus use disabled because held-out relevant evidence did not improve; purge the candidate source from the local index and record the negative result.
- [x] Keep fetched licensed text in the ignored local knowledge store during evaluation only; do not commit source text or underlying player data.

## Context

- [Project knowledge-base policy](../../../docs/knowledge-base.md)
- [Source permission registry](../../../data/knowledge/sources.json)
- [Methodology RAG v3 dataset](../../../data/evaluations/methodology-rag-v3.json)
- [Source research](../research/methodology-rag-additional-sources-2026-10-13.md)

## Comments

- 2026-10-13: Created from the issue 188 `GO` result. Waiting on confirmation of the two proposed public test seams required by the TDD skill. The current v3 corpus, registry, and retrieval threshold remain unchanged.
- 2026-10-13: User confirmed the two public seams: `PlosDiscoveryProvider.fetchRegisteredArticle(doi)` and `compareMethodologyRetrievalV4({ baselineKnowledgeBase, candidateKnowledgeBase, dataset })`. Began implementation after unblocking from resolved issue 188; preserve the current v3 corpus and retrieval threshold until source-on evaluation passes the stated adoption gate.

## Answer

Implemented the two confirmed public seams. The PLOS provider now removes figure/table, supplement, reference, acknowledgement, boxed-text, and linked external material before indexing, and attribution explicitly includes the DOI. A temporary source registration enables the one-DOI API fetch and source-on arm without changing the production registry. `KnowledgeStatus` exposes eligible methodology source IDs so the comparator can reject different indexes, embeddings, policy versions, or source registrations. The v4 dataset is frozen and keeps candidate-relevant questions separate across calibration and held-out families.

The official PLOS API returned the exact paper and a CC BY notice; 56 method-text chunks were temporarily indexed, then purged after evaluation. Source-off and source-on both reached 3/5 held-out answerable query coverage, source-pair precision 0.75 and recall 0.60; candidate-paper evidence coverage was 0/2. The candidate's held-out cosine scores exceeded 0.812, but query-term coverage topped out at 0.333, below the existing 0.5 production gate. Unsupported ambiguous accepts stayed 0 and out-of-scope false accepts stayed 0/1 in both arms. The fixed gate correctly abstained, so the source is not added to the production registry or index. No held-out tuning occurred; v2/v3 and the production threshold are unchanged.

The paper discusses an offensive principal component that primarily reflects volume/involvement, while shot-efficiency variables have lower loadings; its predictive models reconstruct PCA-derived indices, not independently validated recruitment fit. The v4 wording records that distinction. Evaluation data is in ignored `.data/evaluations/methodology-rag-v4-2026-10-13.json`; the fetched article text was purged from the current index and no source text or player rows were committed. See [the methodology evaluation protocol](../../../docs/knowledge-base.md#plos-球员画像论文-source-offsource-on-对照) and [the result](../../../docs/evaluation.md#新增方法来源检索准入-v4).

Validation: `pnpm test` passed 438/438; `pnpm build` passed; PLOS provider and v4 comparator tests passed; JSON and `git diff --check` passed. The CLI also completed the real official-source evaluation and reported the negative gate result.
