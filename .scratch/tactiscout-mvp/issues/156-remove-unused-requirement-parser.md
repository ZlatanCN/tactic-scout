# Remove the unused requirement-parser model path

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the user’s natural-language message enter the LangGraph recruitment case directly. The standalone `/api/v1/requirements/parse` route and structured-output parser are unused by the Web client and preserve an obsolete “parse fields, then confirm” interaction.

## First-principles boundary

- Retire the endpoint with HTTP 410 and point clients to `POST /api/v1/recruitment/cases/:caseId/turns`, which accepts the original message directly.
- Remove the unused parser, client helper, and parser-only request/response schemas; do not add another extraction layer before the LangGraph Planner.
- Preserve the existing `ScoutInput` / `ScoutResponse` schemas only where they remain necessary to migrate old browser-saved plans.
- Correct historical evaluation notes to say the recorded Harness starts at the LangGraph turn; do not relabel historical Planner usage as end-to-end model usage.

## Accepted verification seams

- `createApp` HTTP behavior for the retired parser route and the live recruitment-case turn endpoint.
- `createRecruitmentConversation` from natural-language input through the grounded report.

## Acceptance criteria

- [x] The parser route returns 410 with the direct conversation endpoint as replacement and does not call a model.
- [x] No production source or Web client contains a callable requirement-parser path.
- [x] The main LangGraph natural-language turn and full report chain remain intact.
- [x] Historical token-use documentation describes the old Harness scope accurately and notes the parser path is no longer part of the product.
- [x] API and Web builds and the full test suite pass.

## Answer

Retired `/api/v1/requirements/parse` with HTTP 410 and a replacement pointing directly to the natural-language recruitment-case turn endpoint. Removed the unused structured-output parser, its request/response schemas, and the Web API helper. The first user message now enters the LangGraph case without a separate model call or field-confirmation draft. Updated `CONTEXT.md` and the historical token-use notes without changing what the old Harness actually measured.

Verification: the public HTTP regression passes, and the existing end-to-end case still pauses for a material choice, resumes, and produces a grounded report. The full suite passes 391/391; API and Web production builds pass; `git diff --check` is clean.

## Comments

- 2026-10-11: Opened after an architecture scan found the endpoint and parser had no Web caller; only app registration, the unused API helper and their schemas referenced this path.
- 2026-10-11: HTTP regression first observed the old 400 validation response, then passed with 410 and a direct case-turn replacement. Source search confirms only the retired route/test mention `/requirements/parse`; the parser module, schemas and client helper are gone. Full suite 391/391 and both builds pass.
