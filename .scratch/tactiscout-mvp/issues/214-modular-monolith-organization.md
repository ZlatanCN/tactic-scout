# Organize the codebase around product capabilities

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Replace broad, crowded source folders with a clear modular-monolith layout that makes ownership, allowed dependencies, and runtime entry points obvious. Complete the migration rather than leaving compatibility folders or duplicate module trees behind.

## Acceptance criteria

- [x] The accepted module boundaries and dependency direction are recorded in ADR 0014 and reflected in the architecture guide.
- [x] The LangGraph case workflow has a product-specific home, not a generic `agent` bucket.
- [x] Player contracts and identity are separate from provider-specific data adapters; adapters are grouped by provider.
- [x] Dataset, knowledge, evaluation, and observation modules have clear capability ownership and maintain working CLI entry points.
- [x] The large domain schema module is split into cohesive domain modules; no new catch-all barrel is introduced.
- [x] Frontend route/capability code is grouped under `features/`, with shared primitives isolated under `shared/`.
- [x] Tests are grouped by the same capability boundaries, and the root test command discovers nested test files.
- [x] No stale source paths, duplicate compatibility wrappers, or unreferenced obsolete implementation remain.
- [x] Existing HTTP routes, request/response shapes, checkpoint behavior, CLI commands, and browser plan persistence remain unchanged.
- [x] Full API build, Web build, test suite, and diff whitespace checks pass.
- [x] The final changes are committed and the working tree is clean.

## Migration slices

1. Rename the recruitment workflow module and update direct references.
2. Separate player contracts/identity and group source adapters by provider.
3. Split domain schemas by concept and update imports.
4. Clarify dataset/evaluation capability folders and preserve CLI scripts.
5. Group frontend code by feature and shared UI.
6. Audit stale paths and dead implementations; run full verification and commit.

## Comments

- 2026-10-16: Started after reviewing the current flat, layer-first tree and identifying the LangGraph workflow, provider adapters, evaluation tools, and React panels as separate cohesive capabilities.

## Answer

Reorganized the API into a modular monolith by product capability and provider; split domain contracts by concept; grouped React code by feature and shared UI; and grouped tests by the same capabilities. Removed the unreferenced legacy methodology evaluation module. Existing routes, DTOs, checkpoint format, CLI command names, and browser storage behavior were preserved.

Verification: API build and Web build pass; all 561 tests pass (the two loopback HTTP tests were rerun with local listener permission after the sandbox-only run rejected them); `git diff --check` passes; stale-path and relative-import audits are clean. The migration was committed and the working tree is clean.
