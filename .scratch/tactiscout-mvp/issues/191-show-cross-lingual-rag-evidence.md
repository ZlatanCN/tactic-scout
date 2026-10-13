# Show cross-lingual RAG evidence in the portfolio

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the `/showcase` methodology RAG section show the latest cross-lingual retrieval diagnostic alongside the existing full-graph ablation, with answer-first wording and limits visible before a reader interprets the result.

## Acceptance criteria

- [x] Present the held-out answerable evidence coverage (1/3 → 3/3), candidate-paper coverage (0/2 → 2/2), source-pair recall (1/3 → 3/3), and unchanged precision (1.0) for Chinese-original vs project-authored English queries.
- [x] State that only query language changed, with the same index, embedding model, and retrieval gate; make clear that no runtime translation was enabled.
- [x] Preserve the prior full-graph RAG ablation as a separate experiment and disclose that its 2026-10-13 repeat was 27/29 in both arms, so that repeat cannot support a decision-path claim.
- [x] Keep the small author-labeled sample and lack of independent bilingual review prominent; do not claim recommendation quality.
- [x] Update the concise project overview, inspect the rendered disclosure in the production preview, and review the narrow-width layout rules.

## Context

- [Cross-lingual retrieval evaluation](190-evaluate-cross-lingual-methodology-retrieval.md)
- [Methodology RAG showcase](../../../web/src/ShowcaseMethodologyRagAblation.tsx)
- [Evaluation report](../../../docs/evaluation.md#中文-query-与英文论文的-v5-跨语言诊断)

## Comments

- 2026-10-13: Claimed after the v5 paired retrieval evaluation was completed and committed as `ab19819`.

## Answer

The methodology RAG portfolio card now leads with the cross-lingual retrieval diagnostic and shows the four held-out metrics in a compact comparison. It says the paired arms differ only by query language, states the fixed threshold and unchanged precision, and notes that the author-translated queries were not independently reviewed and are not used at runtime. The previous whole-graph ablation remains separate and now includes the 2026-10-13 27/29 repeat result in both arms, so it no longer implies stable decision-path evidence. README uses the same qualified summary.

Verification: Web production build passed, and the rebuilt production preview's accessibility tree confirms the updated collapsed disclosure summary. Responsive CSS keeps the 390px table inside the available content width (the viewport itself was not resized). No automated tests were added or run for this static portfolio content change; the separate user-owned 390px review in issue 144 remains open.
