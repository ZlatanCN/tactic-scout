# Surface ordinal reviewer disagreement

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the local shortlist quality workbench explain how independent 0–3 reviewer judgments differ, without treating ordinal gaps as calibrated distances or introducing an unsupported reliability coefficient.

## Scope

- Add pure query-level summaries to `evaluateShortlistQuality`: per-reviewer rating distributions and a 0–3 cross-tab plus gap counts for each reviewer pair.
- Keep `unknown` out of numeric tables and distance summaries; retain both-unknown and mixed unknown/numeric counts.
- Display the summaries in `/adjudicate` behind a compact, accessible disclosure so the main result stays focused.
- Keep nDCG and the rating scale unchanged. Do not calculate alpha/kappa or claim scale reliability.

## Accepted verification seam

- Pure function `evaluateShortlistQuality(input)` for distribution, pairwise cross-tab, gap counts, and unknown handling.
- The local adjudication result view for showing the new summaries without exposing identities or changing answer-key gating.

## Acceptance criteria

- [x] Every reviewer’s counts for grades 0–3 and `unknown` are reported with a denominator.
- [x] Every reviewer pair has a numeric 4×4 cross-tab and counts for exact, one-grade, and two-or-more-grade differences.
- [x] Pairwise unknown/unknown and mixed unknown/numeric responses remain separate and are not added to numeric grade statistics.
- [x] UI exposes the summaries accessibly while keeping nDCG and identity-unlock behavior unchanged.
- [x] Documentation describes these as query-scoped descriptive statistics, not a reliability coefficient or general scouting truth.
- [x] Targeted tests, web build, and diff checks pass.

## Context

- [Ordinal reliability methods research](../research/blinded-shortlist-interrater-reliability-2026-10-13.md)
- [Current adjudication protocol](../../../docs/evaluation.md#盲态裁决与质量评测)
- [Existing quality evaluator](../../../src/evals/shortlist-quality-evaluation.ts)

## Comments

- 2026-10-13: Claimed after research review found that the evaluator reports exact agreement and unknown pairs but not per-reviewer marginals, ordinal gap counts, or a reviewer-pair contingency table. The extension preserves descriptive-only interpretation and defers reliability coefficients until real labels exist.

## Answer

The quality evaluator now reports each reviewer’s 0–3/`unknown` counts and denominator, plus a separate 4×4 numeric-grade contingency table and exact/one-grade/two-or-more-grade gap counts for each reviewer pair. `unknown` remains outside the numeric tables and is counted as both-unknown or mixed-with-numeric. `/adjudicate` keeps this detail in an accessible disclosure with reviewer labels, table caption, and row/column headers; nDCG calculation and answer-key unlock order are unchanged. Documentation states that these are query-scoped descriptions and do not establish scale reliability.

Verification: `tests/shortlist-quality-evaluation.test.ts` passed 13/13, `pnpm build`, `pnpm build:web`, and `git diff --check` passed. The `/adjudicate` route loaded in the local preview. No real human ratings were present or used.
