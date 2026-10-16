# Deepen mixed-responsibility modules

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Continue the modular-monolith cleanup by separating responsibilities that have distinct callers or lifecycles, while keeping cohesive provider and KnowledgeBase implementations intact. Preserve current behavior and public seams.

## Acceptance criteria

- [x] `createApp()` remains the composition root and preserves its injectable construction seam.
- [x] HTTP route registration is grouped by capability; request-scoped and app-scoped state keeps its current lifetime.
- [x] Harness evaluation remains one coherent evaluator; trace privacy projection and scripted clarification-driving behavior have explicit homes.
- [x] Oversized tests are split by behavior/capability without changing assertions or fixture semantics.
- [x] The candidate report UI extracts only cohesive components and preserves its public props and rendered content.
- [x] Existing API/Web build and deterministic test contracts pass; no behavior or external interfaces change.
- [x] The architecture note matches the implementation; `git diff --check` reports no whitespace errors or generated leftovers.

## Design notes

- Do not split `KnowledgeBase` or provider research modules only to reduce line count; they have cohesive ownership and lifecycle.
- Keep app progress maps and the turn coordinator allocated once per `createApp()` instance and shared by route handlers.
- Keep scenario checks and result shape together in the Harness evaluator; move only trace serialization/privacy and scripted conversation control.

## Comments

- 2026-10-16: Started after the architecture review identified mixed API composition and cross-boundary Harness helpers. The user approved addressing all worthwhile candidates, with cohesion as the deciding criterion.

## Answer

Reduced `src/app.ts` to dependency composition and route registration. HTTP endpoints now live under `src/app/routes/`; per-app progress state and turn coordination are still allocated once and shared. Harness scenario evaluation stays cohesive, while privacy-safe trace output and scripted clarification matching have dedicated modules. The 3,777-line recruitment integration suite is grouped into interaction, search, evidence, Understat, replacement, and HTTP suites with shared fixtures. The report screen delegates each candidate card and evidence formatting to feature-local components.

The review deliberately kept `KnowledgeBase` and provider research modules intact because their ownership/lifecycle is cohesive and no independent interface justified the extra indirection.

Verification: `pnpm build`, `pnpm build:web`, all 561 tests, and `git diff --check` pass. Existing HTTP routes, DTOs, checkpoint state, candidate rendering, and evaluator result contracts are unchanged.
