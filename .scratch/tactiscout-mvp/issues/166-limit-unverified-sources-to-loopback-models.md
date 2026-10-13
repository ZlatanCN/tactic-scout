# Keep unverified current-source data off remote model endpoints

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Prevent player data from Understat, ASA, or their mosaic combination from being sent to a remote OpenAI-compatible model while the sources' model-processing permissions remain unverified. Local-only processing is a containment boundary, not a grant of source permission.

## Accepted verification seam

- `createApp` HTTP behavior for Understat-, ASA-, and mosaic-backed natural-language turns.
- A remote model endpoint returns HTTP 503 before checkpoint reads, player reads, or Planner calls.
- A loopback model endpoint continues through the Planner and player-search tool for all three modes.

## Acceptance criteria

- [x] Remote model endpoints are rejected before case or player data is read or sent to the Planner.
- [x] Loopback endpoints retain the local research workflow for Understat, ASA, and mosaic.
- [x] Documentation says the guard does not establish permission for collection, retention, model processing, or display.
- [x] Regression tests, API/Web builds, and diff checks pass.

## Answer

The shared LangGraph pre-turn gate now permits Understat, ASA, and mosaic only when `OPENAI_BASE_URL` resolves to an HTTP(S) loopback host. Other endpoint URLs receive HTTP 503 before the checkpoint, player repository, or Planner is touched. The existing local research path continues to work for all three modes. README, `.env.example`, and source documentation clarify that local-only handling does not grant permission to scrape, retain, process, or display provider data.

Verification: the accepted `createApp` HTTP regressions covered remote rejection and loopback continuation for each of the three modes. `pnpm test` passed 397/397; `pnpm build`, `pnpm build:web`, and `git diff --check` passed.

## Evidence

- [Data-source processing boundaries](../../../docs/data-sources.md#模型处理门控)
- [Product data boundary](../../../CONTEXT.md#来源处理边界)

## Comments

- 2026-10-12: The accepted HTTP regressions first observed a remote request reaching the Planner and returning HTTP 502. The loopback-only check now blocks it before checkpoint/player reads while preserving local-only runs.
