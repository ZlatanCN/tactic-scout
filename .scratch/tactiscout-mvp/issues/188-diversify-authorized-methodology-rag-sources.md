# Find authorized methodology RAG sources that add coverage

Type: research
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Determine whether additional soccer role, performance-evaluation, or tactical-method papers can improve the methodology corpus using a verified article license and publisher-approved automated access path.

## Current evidence

- The production registry has three external methodology sources: two PLOS CC BY 4.0 articles and one Frontiers article accessed through its exact PMC OAI-PMH record.
- The current v3 retrieval baseline has 213 methodology chunks, 6/6 answerable queries with relevant evidence accepted, held-out source-pair precision 0.75, one held-out ambiguous query with evidence accepted, and 0/2 out-of-scope false accepts.
- The corpus is small and source-level evaluation is project-author labeled; adding more text could increase coverage or worsen false positives.

## Research questions

- Are there relevant primary papers with a clear article-level reuse license, preferably CC BY 4.0?
- Does the publisher or repository document an automated full-text access route whose terms permit the intended retrieval and storage?
- Does the paper add a distinct methodology topic rather than repeat existing role, physical performance, or soccer-performance analysis coverage?
- Which figures, tables, match data, or other third-party material must remain excluded?

## Acceptance criteria

- [x] Inspect existing research and the registered corpus before screening candidates.
- [x] Record only publisher/repository primary sources and cite direct evidence for relevance, article license, and automated retrieval route separately.
- [x] Classify each lead as `GO`, `CONDITIONAL`, or `NO-GO`; accessibility alone must never imply ingestion permission.
- [x] State whether a source adds query coverage and the benchmark/recalibration needed before ingestion; do not change the registry, index, or production retrieval threshold in this research issue.
- [x] If no lead passes all gates, record that result and the smallest concrete missing authorization or capability.

## Context

- [Methodology retrieval and ingestion rules](../../../docs/knowledge-base.md)
- [Registered source permissions](../../../data/knowledge/sources.json)
- [Open football-methodology source review](../research/open-football-methodology-rag-sources-2026-10-09.md)
- [Current methodology retrieval benchmark](../../../data/evaluations/methodology-rag-v3.json)

## Comments

- 2026-10-13: Claimed after rerunning the v3 baseline: 213 indexed methodology chunks; 6/6 answerable questions retrieved relevant sources; held-out precision 0.75; one ambiguous question accepted a source; 0/2 out-of-scope questions false-accepted. Research is limited to additional authorized source options; no article or data will be fetched into the corpus during screening.
- 2026-10-13: Publisher pages and PLOS TDM/CC BY terms independently rechecked. The 2026 PLOS player-profiling article is a GO for attributed methodology text only; the 2024 PLOS event-detection article is conditional on adding data-quality and measurement-error coverage; PlayeRank remains a NO-GO because its recorded CC BY-NC-SA terms are incompatible with the project's reuse boundary. No article text, figures, tables, or football data were downloaded or added.

## Answer

Research is complete; see [the source review](../research/methodology-rag-additional-sources-2026-10-13.md). The strongest follow-up is to evaluate the 2026 PLOS paper on a new source-specific calibration/held-out query set before adding its licensed method text. Keep the existing v3 benchmark and threshold unchanged. The 2024 paper should wait until the methodology corpus explicitly covers event definitions and measurement quality. No registry, corpus, code, or production retrieval behavior changed in this issue.
