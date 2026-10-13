# Enforce the men's competition boundary in StatsBomb data

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Enforce the product-wide men-only boundary at the StatsBomb data adapter. StatsBomb Open Data publishes both men's and women's competitions; a blank competition filter must not let women's records enter player search or reports.

## Accepted verification seam

- `StatsBombRepository.loadPlayers()` against a local fixture containing men's, women's, and unclassified competition metadata.
- Only records whose exact `(competition_id, season_id)` metadata is marked `competition_gender: "male"` may be returned.

## Acceptance criteria

- [x] Male competition-season records remain available.
- [x] Female and missing/unknown-gender competition-season records are excluded even when no competition allowlist is configured.
- [x] The filter uses official competition-season metadata and does not infer gender from competition names or player names.
- [x] Source documentation explains the enforced scope and fail-closed handling of missing metadata.

## Answer

`StatsBombRepository` now joins `competitions.json` metadata by exact competition and season IDs and processes only entries with `competition_gender: "male"`. Women's and unclassified scopes are excluded even when the optional competition and season allowlists are empty. The adapter does not infer gender from a league name or player data.

Verification: the mixed-gender public repository test first failed because all three records entered the returned dataset; after the filter it passed with only the official male scope. `pnpm test` passed 397/397; `pnpm build`, `pnpm build:web`, and `git diff --check` passed.

## Evidence

- [StatsBomb official `competitions.json`](https://github.com/hudl/open-data/blob/master/data/competitions.json)
- [StatsBomb Open Data README](https://github.com/hudl/open-data/blob/master/README.md)
- [Product data boundary](../../../CONTEXT.md#招募数据范围)

## Comments

- 2026-10-12: Spec review found the StatsBomb loader did not enforce the root context's men-only boundary. Official metadata includes `competition_gender` and both male/female competitions. The repository regression reproduced the scope leak before the filter.
