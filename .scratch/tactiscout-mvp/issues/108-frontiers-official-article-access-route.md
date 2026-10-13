# Verify a single-article official acquisition route for Frontiers

Type: research
Status: resolved
Labels: ready-for-agent
Blocked by: 107

## Question

Does Frontiers or a first-party scholarly repository provide a documented, bounded machine-readable route for retrieving metadata or text for Forcher et al. (2022), DOI `10.3389/fpsyg.2022.813206`, consistent with the publisher's text-and-data-mining terms?

## Acceptance criteria

- Use only official Frontiers, Europe PMC, PubMed Central, or NCBI documentation and metadata endpoints; do not open the article's `/full`, PDF, XML, or other body endpoint.
- Verify any exact article identifier, route, authentication requirement, rate limit, request identification requirement, and relevant reuse/license flags from source-owned metadata.
- Separate a documented permitted route from a URL that happens to respond; do not infer authorization or stable API support from successful access alone.
- Record unknowns and recommend whether a separate bounded ingestion task should proceed. Do not fetch article body text, register the source, write data, or call embedding/LLM services.
- Save one cited Markdown note under `.scratch/tactiscout-mvp/research/` and update this ticket and the Map.

## Context

- [Issue 107 rights check](107-authorized-methodology-rag-expansion.md)
- [Publisher Terms §14 and CC BY assessment](../research/authorized-methodology-rag-expansion-2026-10-09.md)
- [Permission-gated RAG ADR](../../../docs/adr/0002-permission-gated-scouting-corpora.md)

## Answer

The official metadata path is verified. Europe PMC `resultType=lite` resolves the DOI to PMID `35712183` / PMCID `PMC9197445` and marks it open access. The PMC OAI-PMH `pmc_fm` front-matter record exposes `pmc-prop-open-access=yes`, `pmc-license-ref=CC BY`, and the CC BY 4.0 URI; `ListMetadataFormats` lists the metadata-only `pmc_fm` format and the separate `pmc` full-text format. No full-text format was requested in this research.

PMC documents OAI-PMH as an automated retrieval route, capped at 3 requests per second; requests above 100 should run off peak with no concurrency. Combined with Frontiers Terms §14 and the article's CC BY 4.0 marker, a one-article, low-rate ingestion task is viable. Still exclude figures, tables, supplements, and separately credited material until their notices are checked; the article's Chinese-query retrieval quality remains untested.

Metadata-only evidence and direct official endpoints are recorded in [frontiers-official-article-access-2026-10-09.md](../research/frontiers-official-article-access-2026-10-09.md). The next task should add the source with a narrow, reproducible ingestion path, test Chinese retrieval under the existing gate, and run the user's selected full warehouse → LangGraph → report Harness.

