# Put the scouting decision before the evidence audit

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Let a reader understand the request, the recommended follow-up leads, and their direct evidence before reading the detailed data-source audit, while keeping limitations and provenance easy to inspect.

## Why now

The report currently renders dataset scope, search scopes, coverage summaries, optional source signals, historical samples, and knowledge retrieval before the recommendation list. On a two-column workbench this pushes the main scouting conclusion far down the report and makes a first read feel like an audit log.

## Acceptance criteria

- [x] After the need summary and inferred capability profile, the reader can reach the recommendation list before the detailed source and coverage sections.
- [x] Dataset scope, search criteria, coverage counts, external signals, historical appendix, and retrieval coverage remain present together in one clearly named, keyboard-operable disclosure.
- [x] Candidate evidence, trade-offs, recommendation-order caveat, visible report limitations, and report timestamp remain available; no evidence is removed or changes ranking behavior.
- [x] The new hierarchy compiles in the web production build and passes `git diff --check`.

## Answer

The report now places candidate recommendations directly after the request summary, inferred profile, and requested-capability coverage. Detailed dataset scope, search criteria, evidence counts, external signals, historical samples, and retrieval coverage remain available in a native disclosure labelled “数据与来源依据”; report limitations stay expanded and visible below it. Candidate evidence and ordering caveats are unchanged.

Verification: API and web production builds passed; `git diff --check` passed. Automated tests were not run. Browser visual inspection was unavailable in this environment, so this confirms compilation and source structure rather than pixel-level rendering.

## Comments

- 2026-10-07: Applied the codebase-design skill to the report view's single caller-facing input; this change keeps the report data contract stable and reorganizes only its presentation order.
