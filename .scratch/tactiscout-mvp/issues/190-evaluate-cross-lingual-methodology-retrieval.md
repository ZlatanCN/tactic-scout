# Evaluate cross-lingual methodology retrieval

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Determine whether one manually authored, meaning-preserving English translation of each new Chinese methodology query can improve retrieval of the registered English PLOS player-profiling paper while preserving the existing production abstention policy.

This is a diagnostic/evaluation change. It does not enable query translation in the Agent, alter production thresholds, or admit the candidate paper into the production source registry.

## Public test seams

1. `createCrossLingualMethodologyQueryArms(query)`: pure function that produces the paired Chinese-baseline and English-translation evaluation queries while preserving the same query family, split, answerability, source labels, and rationale.
2. `compareMethodologyRetrievalV5({ knowledgeBase, dataset })`: public paired evaluation over one fixed `LocalKnowledgeBase`; it checks the pinned model/policy/source inventory and reports calibration and held-out retrieval, false acceptance, and false abstention for both query arms.

## Acceptance criteria

- [x] Add 12 new query families, six calibration and six held-out; each has a Chinese query and a meaning-preserving English translation. Both language variants stay in the same split.
- [x] Include answerable, ambiguous, and out-of-scope cases in each split; cover the PLOS candidate and existing methodology sources.
- [x] Keep the dataset family-disjoint from methodology RAG v4 and preserve the v4/v3 data unchanged.
- [x] Run both arms against the same physical index, source inventory, embedding model, and current retrieval policy. The only arm difference is query language.
- [x] Report per-split source coverage, source precision/recall, false abstentions, ambiguous unsupported acceptances, out-of-scope false acceptances, and paired per-query signals.
- [x] Keep the current `0.812` cosine and `0.5` term-coverage policy unchanged. Do not tune on held-out results.
- [x] Fetch and index the PLOS article only in the isolated evaluation registry; preserve attribution and purge the candidate source in `finally` after evaluation.
- [x] Record the result and limits in evaluation/knowledge-base docs. Keep production source registry and current index free of the candidate source.

## Context

- [Cross-lingual retrieval research](../research/chinese-english-methodology-rag-retrieval-2026-10-13.md)
- [Issue 189: source-specific PLOS evaluation](189-evaluate-player-profile-methodology-source.md)
- [Current knowledge retrieval implementation](../../../src/knowledge/index.ts)

## Comments

- 2026-10-13: Research found acceptable multilingual-E5 cosine signals but insufficient exact Chinese-term overlap for the English candidate paper. Keep the current gate fixed and first isolate query language on a fresh family-disjoint v5 set.

## Answer

The v5 paired evaluation is complete. The English-translation arm improved held-out answerable evidence coverage from 1/3 to 3/3; candidate-paper coverage improved from 0/2 to 2/2. Held-out source-pair recall improved from 1/3 to 3/3 while precision remained 1.0. Neither arm accepted unsupported ambiguous evidence, and both had 0/2 out-of-scope false accepts. Both ran against the same index and source inventory using the unchanged production policy (`cosine >= 0.812` and same-chunk term coverage `>= 0.5`).

The candidate paper's 56 chunks were indexed temporarily and 56 were deleted from the current LanceDB table version after the run. The production source registry was not modified. The raw output remains in ignored `.data/evaluations/methodology-rag-v5-2026-10-13.json`.

The result is a small author-labeled retrieval diagnostic, not a validated translation system or a general cross-lingual benchmark. English translations were project-authored and did not receive independent bilingual review. No runtime translation, Chinese article summaries, reranker, or threshold change was introduced. See [evaluation results](../../../docs/evaluation.md#中文-query-与英文论文的-v5-跨语言诊断), [dataset](../../../data/evaluations/methodology-rag-v5-crosslingual.json), and [research report](../research/chinese-english-methodology-rag-retrieval-2026-10-13.md).

Verification: focused v5 tests 3/3; full suite 441/441; API and Web builds; dataset/package JSON parsing; and `git diff --check` all passed.
