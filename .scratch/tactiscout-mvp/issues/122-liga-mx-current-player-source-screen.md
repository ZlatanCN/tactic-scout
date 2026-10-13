# Screen the Liga MX current-player source route

Type: research
Status: resolved
Labels: ready-for-human
Blocked by: none

## Question

Can the official Liga MX current-season player statistics route safely add Mexican league coverage to the TactiScout candidate pool and portfolio demo?

## Acceptance criteria

- [x] Verify the current competition/season, player fields, and performance fields from first-party pages.
- [x] Check whether the official source documents a complete player pool, stable identities, API contract, pagination, and update cadence.
- [x] Assess local retention, Ollama, embeddings/RAG, derived reports, and public named-player display separately.
- [x] Do not fetch or persist player rows, scrape undocumented routes, or add a provider when access and usage rights remain unverified.
- [x] Record the source decision in the data-source guide and issue map.

## Evidence

- [Research note](../research/current-player-open-data-frontier-2026-10.md)
- [Liga MX official site](https://ligamx.net/)
- [Liga MX official player statistics](https://ligamx.net/cancha/estadistica)
- [Liga MX player profile example](https://subinternacional.ligamx.net/cancha/jugador/98228)

## Answer

**Do not add a provider or collect player data.** The official site proves a current 2026 Apertura route with basic goals/minutes/discipline tables and player-profile fields, which would add Mexican coverage. It does not document a complete player pool, supported developer API, stable identity schema, pagination, or an update SLA. The statistics pages reserve rights and prohibit copying; local retention, local model processing, RAG, derived reporting, and public named-player display have not been authorized.

If Mexican coverage becomes a priority, first request a formal data feed/API specification and written permission for each intended use. Until then, retain the official pages as manual scouting references only. No endpoint was queried and no player rows were downloaded.

## Comments

- 2026-10-09: Research was performed against Liga MX first-party pages only; conclusion is limited to publicly verifiable page content and does not infer permissions from browser access.
