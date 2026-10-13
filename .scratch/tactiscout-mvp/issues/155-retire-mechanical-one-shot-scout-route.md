# Retire the mechanical one-shot scouting route

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the natural-language recruitment case the only supported scouting workflow. The obsolete `POST /api/v1/scout` route currently exposes a separate deterministic score-and-rank path that contradicts the conversational LangGraph product decision in [issue 07](07-conversational-ability-evaluation.md).

## First-principles boundary

- Return HTTP `410 Gone` from the retired one-shot route for any request body and identify `POST /api/v1/recruitment/cases/:caseId/turns` as its replacement.
- Do not load players, calculate role scores, or produce a shortlist through the retired route.
- Remove the unreferenced one-shot graph, parser, and rule-based role scorer; keep per-90 normalization used by capability evidence and legacy schemas used only to migrate saved plans.
- Keep historical saved-plan schema compatibility where the browser still needs it; do not conflate persisted snapshot parsing with a supported runtime workflow.
- Preserve the complete LangGraph turn path, including question/answer continuation and report delivery.

## Accepted verification seams

- `createApp` HTTP behavior for the retired route and current recruitment-case turn endpoint.
- `createRecruitmentConversation` from a natural-language first turn through a grounded report.

## Acceptance criteria

- [x] The legacy route returns 410 with a machine-readable replacement path, regardless of request payload.
- [x] The legacy route makes no repository reads and cannot call the deterministic scorer.
- [x] The old deterministic graph/parser and unused role-scoring functions are removed; saved-plan v1 migration remains supported.
- [x] The web client has no callable one-shot scout helper.
- [x] The LangGraph conversation/report path remains available and passes its full-chain regression.
- [x] API and Web production builds pass.

## Answer

Retired `POST /api/v1/scout` with HTTP 410 and a machine-readable replacement pointing at the natural-language recruitment-case turn endpoint. The route does not parse fixed-field scouting input or access the player repository. Removed the obsolete one-shot graph and parser, its unreferenced rule-based role-scoring functions, the web client's `scout()` helper, and the duplicate legacy API contract test. Kept per-90 conversion for the capability evidence evaluator and legacy response schemas used only to migrate version-1 saved plans.

The existing natural-language LangGraph path still pauses for a material choice, resumes the same case, and produces a grounded report. Full tests pass 390/390; API and Web production builds pass; `git diff --check` is clean.

## Comments

- 2026-10-11: Started after confirming the product decision that natural-language recruitment cases replace fixed-field mechanical screening. The status code is `410` so existing clients receive an explicit retirement signal and migration target.
- 2026-10-11: HTTP regression first failed against the old behavior (200 from a valid fixed-field request), then passed with 410 and zero player reads. Full-chain HTTP → LangGraph pause/resume/report regression passes; full test suite passes 390/390, both production builds pass, and the legacy plan migration regression remains green.
- 2026-10-11: After the public HTTP seams were reconfirmed, reran the retired-route contract and the full natural-language HTTP pause → same-case resume → grounded-report path; both passed (2/2).
- 2026-10-12: Confirmed the accepted seams: `createApp` HTTP behavior plus the natural-language LangGraph report path. Current full suite passes 391/391; API and Web production builds pass.
