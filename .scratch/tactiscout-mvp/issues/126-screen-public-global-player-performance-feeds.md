# Screen public global player-performance feeds

Type: research
Status: resolved
Labels: ready-for-human
Blocked by: none

## Question

Can a public football data site provide a practical current-season player-statistics route that materially expands the candidate pool beyond TactiScout's current mosaic, and can we verify the interface well enough to build a bounded local prototype?

## Scope

- Check the current source matrix and prior route screens first; do not call a previously rejected lead new without identifying what changed.
- Compare FotMob with one other broad-coverage provider route, using official pages, first-party site/API responses or provider-owned source code and terms.
- Verify current competitions/seasons, candidate discovery, useful per-player fields, stable identifiers, pagination, update timing, and access stability.
- Distinguish documented API support from an observed public web endpoint. Record restrictions, attribution, storage and local-model/RAG uncertainty; do not bypass authentication, anti-bot controls, or access denials.
- Recommend a concrete next step: implement an adapter, run a tightly bounded schema smoke, request access, or reject the route.
- Research only: no API calls, scraping, player rows, or credentials during this screening.

## Acceptance criteria

- [x] A dated Markdown report compares at least two routes with direct provider-owned citations.
- [x] The report distinguishes facts, observations, and unknowns, and addresses whether the routes add meaningful candidate-pool/metric coverage.
- [x] The recommendation identifies the next verifiable technical step and any remaining access or usage questions.
- [x] No API requests, scraping, credentials, or player-level rows were persisted during research.

## Answer

See [the dated research report](../research/public-global-player-performance-feeds-2026-10-10.md). FotMob has rich public metrics but its official terms/robots rules rule out automated collection absent written consent. The distinct DSG/GSA route has broad potential and a documented authenticated API, but current-season entitlement, access cost, candidate pagination, metric coverage, freshness SLA, upstream provenance, and local/LLM/RAG/public-display rights are unverified. Do not scrape GSA pages or add either provider to the candidate pool. Ask DSG for a one-competition trial/quote and written permissions; if granted, run a maximum-four-request, no-model in-memory schema smoke.
