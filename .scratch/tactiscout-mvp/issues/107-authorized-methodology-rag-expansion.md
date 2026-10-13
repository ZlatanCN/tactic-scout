# Find an authorized, relevant expansion for the methodology RAG corpus

Type: research
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Question

Can TactiScout add one owner-published football performance-analysis paper that materially answers role, passing, or on/off-ball contribution questions seen in recruitment cases, while verifying the approved acquisition path, local persistence, embedding/RAG processing, and source attribution from first-party sources?

## Acceptance criteria

- Re-check only the strongest relevant candidates already identified in [the open-methodology review](../research/open-football-methodology-rag-sources-2026-10-09.md); avoid repeating the broad survey.
- Use publication-owner/API documentation to verify the article's license, programmatic acquisition route, any relevant rate/attribution requirements, and exclusions for third-party materials or underlying tracking/event data.
- Assess whether the licensed article text itself can be retained, embedded, retrieved by TactiScout's current Chinese case queries, summarized by the local model, and cited in a public portfolio; distinguish explicit permission from unknowns.
- Recommend one bounded next action: register and ingest one article, obtain clarification, or do not ingest. Do not fetch the article body or alter the knowledge index unless every required boundary is verified.
- Save one cited research note under `.scratch/tactiscout-mvp/research/`; update this ticket and the Map Fog/decision pointer with the result.

## Context

- [Domain context](../../../CONTEXT.md)
- [Permission-gated RAG ADR](../../../docs/adr/0002-permission-gated-scouting-corpora.md)
- [Open football methodology candidates](../research/open-football-methodology-rag-sources-2026-10-09.md)
- [Methodology RAG abstention policy](106-methodology-rag-abstention-threshold.md)
- [Real-model full-chain Harness](14-agent-harness-evaluation-suite.md)

## Answer

Among the already researched candidates, Forcher et al. (2022), DOI `10.3389/fpsyg.2022.813206`, is the closest fit for role-aware interpretation. The publisher record identifies CC BY 4.0. Frontiers Terms §14 explicitly permits text and data mining of public content for enriching external scientific-literature collections, while downloaded text remains subject to the article license and website performance must not be hindered.

Do not ingest the article yet. The official machine-readable single-article route and its request constraints have not been verified, and Chinese-query retrieval under the current abstention gate has not been measured. CC BY provides a reuse basis for attributed article text, summaries, and public display; it does not confer rights in separately licensed underlying match data or third-party material. The exact treatment of vector embeddings is not specifically addressed by the publisher/license text.

The research note is [authorized-methodology-rag-expansion-2026-10-09.md](../research/authorized-methodology-rag-expansion-2026-10-09.md). During the research, the publisher browsing interface returned article-page body content; it was not saved, quoted, or reused. Further work should first establish a narrow official metadata/machine-readable route, then use a source-specific Chinese retrieval check before registering or ingesting anything.

