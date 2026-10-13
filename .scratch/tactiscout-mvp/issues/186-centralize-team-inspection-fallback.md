# Centralize the team inspection fallback

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Keep the local fallback for team inspection in one implementation so wrapped repositories and direct callers use the same matching, loading, and cancellation behavior.

## Accepted verification seam

- Public function `inspectTeamPlayers(repository, teamName, signal)`.
- Verify normalized partial team matching, full player loading when no specialized `inspectTeam` exists, and cancellation while loading.

## Acceptance criteria

- [x] The wrapper fallback delegates to the existing public team inspection function.
- [x] Normalized team matching and catalog loading behavior are unchanged.
- [x] Cancellation during loading rejects without returning a partial result.
- [x] The focused regression, API build, full test suite, and diff check pass.

## Comments

- 2026-10-13: Claimed after reviewing two identical team inspection fallbacks. The seam was confirmed by the user.

## Answer

`withLocalQueries` now delegates team inspection to `inspectTeamPlayers`, keeping the repository-specific `inspectTeam` path and local catalog fallback in one implementation. Characterization tests cover normalized partial matching, a single full-catalog read, and cancellation during that read. Since this is a behavior-preserving refactor, the characterization tests passed both before and after the delegation change.

Verification: focused tests 2/2; API build passed; full test suite 436/436; `git diff --check` passed.
