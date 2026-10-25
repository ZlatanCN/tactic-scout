# Preserve comparison conditions across turns

Status: resolved
Labels: ready-for-agent

## Accepted behavior

- Adding players without a new season inherits the last completed comparison's season.
- An explicit season in an addition replaces the previous season, including when extracted condition names differ between `season` and `赛季`.
- A new replacement comparison uses only its own conditions; an omitted season selects the latest local snapshot.
- Persist players and effective conditions together after the comparison tool completes. Identity interruptions and failed calls preserve the last completed comparison.
- Recover an older comparison's explicit season from the successful tool call's `seasonStartYear` argument.

## Implementation

- Group active comparison participants and conditions in one thread-state object.
- Reuse request understanding, identity resolution, and comparison memory nodes.
- Add deterministic whole-graph Vitest regressions at `createAgent().invoke()` and `getState()` with isolated in-memory persistence and mocked model/data dependencies.

## Completion checks

- Six new whole-graph regressions pass, covering repeated inheritance, season alias overrides, fresh comparison reset, historical recovery, identity interruption, and failed data queries.
- The complete suite passes: 16 tests across 3 files.
- TypeScript build, Ultracite, and diff whitespace checks pass.
- Independent read-only review found no actionable issues in this feature.
