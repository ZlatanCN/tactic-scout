# Find the next useful current-player performance source

Type: research
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Question

Which one additional source, if any, should TactiScout pursue next to expand current-season player discovery and performance evidence beyond the sources already integrated or assessed? Audit the existing research first, then check current first-party documentation and terms for genuinely new candidates. Prefer a free/public route with useful player-level performance fields and a plausible path to a polished non-commercial portfolio demo.

The research must distinguish (a) a source technically accessible for bounded, no-model schema/coverage validation from (b) a source whose data may be retained, passed to a local model/RAG, derived into reports, and shown in a public portfolio. Do not assume web accessibility, a free API key, a non-commercial purpose, or an API rate-limit/cache recommendation grants those rights. Do not scrape around access controls or collect broad player data while the rights and scope are unknown.

For the strongest one or two candidates, verify from primary sources:

- Competition/season coverage and whether the current season is actually listed, not merely an API example.
- Player/team/source identifiers; roster versus appearance/statistics coverage; usable position, age, minutes, and performance fields; what the fields can and cannot say about tactical ability.
- Update timestamps or explicit freshness claims, request limits, credentials, price, and whether a small no-model smoke can measure real coverage.
- Published terms/licensing for local persistence, local inference, embeddings/RAG, derived analysis, attribution, and public portfolio display; call out every unresolved permission separately.
- One concrete next action: a bounded live smoke if available and appropriate, a specific permission question, or a justified decision to add no new source.

## Context

- [Domain/source boundaries](../../../CONTEXT.md)
- [Layered player evidence](39-layered-player-evidence.md)
- [Current multi-source player pool](99-multi-source-current-performance-pool.md)
- [SoccersAPI bounded smoke](100-soccersapi-current-season-bounded-smoke.md)
- [Current source expansion research](../research/current-player-source-next-route-2026-10-09.md)
- [SoccersAPI source review](../research/soccersapi-current-player-statistics-source-review-2026-10-09.md)
- [J.League source review](../research/jleague-current-player-performance-source-2026-10-08.md)
- [K League source review](../research/k-league-current-player-performance-api-2026-10-09.md)
- [Open current-source audit](../research/open-current-player-source-audit-2026-10-08.md)

## Research output

Write one dated Markdown report under `.scratch/tactiscout-mvp/research/`, cite primary sources near the claims they support, and link it in the answer below. No provider code or player data should be added as part of this research ticket.

## Answer

No newly assessed source is ready to join the Agent. Liga Portugal has useful 2026/27 player-stat pages, but its terms limit content to personal, non-commercial viewing and expressly prohibit copying, downloading, adaptation, derivative work, and retaining content. We therefore will not scrape, store, send it to Ollama/RAG, or show it in a TactiScout report.

The strongest conditional lead remains the already-known foot.io API, not a new source. It documents a broad player-season schema, but its REST/MCP are invite-only; free current-season competition counts do not establish complete player-stat coverage; freshness has no general SLA; and upstream row rights still govern each use. Its terms support minimum caching and source-attributed fact display only where the invite and upstream licences permit them. They do not clearly settle local Ollama, private embeddings/RAG, retention duration, or public derived player rankings. The public player totals also differ by page and measurement date (304,446 vs 311,637), so neither should be treated as a complete available pool.

Research evidence and primary-source links are in [the dated audit](../research/current-player-source-expansion-2026-10-09.md). No API was called and no player data was collected. The only justified next step is owner-led waitlist enrollment and written clarification from foot.io; a bounded, no-model smoke can be considered only after an invite, and model/RAG/report use remains separately gated. See [issue 112](112-footio-invite-and-rights-clarification.md).
