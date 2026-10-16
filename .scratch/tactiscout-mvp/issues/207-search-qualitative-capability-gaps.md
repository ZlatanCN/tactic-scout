# Add bounded Web Search for qualitative capability gaps

Type: feature
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

When event data cannot directly show a requested football ability, let the existing recruitment investigation find a small number of attributable public observations without converting prose into statistics or changing candidate metric scores.

## Acceptance criteria

- [x] Reuse the existing `search_player_reports` / `KnowledgeRepository` boundary; do not add another graph, agent, or crawler.
- [x] Send structured capability gaps plus evaluated candidate name, team, competition, and season to the search adapter.
- [x] Keep Web Search opt-in behind a provider key, domain allowlist, and explicit AI-processing, report-display, and local-retention switches.
- [x] Bound requests to four basic search results, reject off-domain, ambiguous-identity, unanchored, or capability-irrelevant snippets, mark which gap terms matched, and never fetch article bodies.
- [x] Keep web observations qualitative and unverified; leave missing metric coverage missing.
- [x] Validate the mechanism with a paired full-graph source-on/source-off ablation using the same candidate snapshot and scripted Planner.
- [x] Record the limits of the experiment: it does not demonstrate shortlist quality or general web-source coverage.

## Context

- [Capability evidence feasibility research](../research/web-capability-evidence-feasibility-2026-10-14.md)
- [Knowledge base operations](../../../docs/knowledge-base.md)
- [LangGraph workflow](../../../docs/architecture.md)

## Answer

Added an optional Tavily adapter behind the current player-report retrieval boundary. It runs only when the graph supplies a recognized capability gap and exact candidate contexts, then requires an exact candidate-name mention, a current-team anchor, and at least one matched capability gap. Partial coverage is labeled so the Planner can leave other gaps unknown. It does not crawl pages, store search hits in LanceDB, or create numerical evidence.

The paired whole-graph ablation returned the same recommendation, metric evidence, and `missing` status for “进攻接应” in both arms. The Web Search arm added one linked observation marked `unverified`; the control arm added none. This validates evidence-flow isolation only. No Tavily key is configured, so the live provider path was exercised with a fixed response fixture; real-world coverage, retrieval precision, and shortlist quality remain unmeasured and require a frozen source set plus independent blind review.

Targeted tests and TypeScript build passed. No live request was made.
