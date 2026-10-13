# Align the Harness runbook with the selected dataset mode

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the documented Understat demo and the Harness CLI help point to a scenario ID that is available in Understat mode, so a reader can reproduce the shown run without hitting an unknown-scenario error.

## Evidence

- The interactive walkthrough instructs readers to configure `TACTISCOUT_DATA_MODE=understat`.
- `selectScenarios()` limits Understat mode to `understat-five-league-xg-creation`; the documented `bayern-kane-replacement` ID is unavailable in that mode.
- The latest identity-free Understat Harness summary reports 31/31 checks and 53.195 seconds. The earlier 107.674-second run is a separate valid run retained in the evaluation timeline.

## Acceptance criteria

- [x] Harness help explains that its default scenario depends on the configured dataset mode and shows the Understat scenario ID.
- [x] README and demo walkthrough commands explicitly select the Understat scenario when instructing users to configure Understat.
- [x] Demo walkthrough cites the latest verified identity-free run and points to the full evaluation record without erasing earlier run history.
- [x] CLI help and TypeScript build succeed; `git diff --check` passes.

## Answer

The Harness help now describes mode-specific default scenarios and shows the Understat scenario ID. README and the interview walkthrough explicitly select `understat-five-league-xg-creation` for the Understat demo, while retaining the configured local Qwen model. Both instructions write only an identity-free local summary and explain the no-overwrite behavior. The walkthrough uses the latest verified 53.195-second summary and distinguishes the earlier 107.674-second run; the full evaluation history remains intact.

Verification: `TACTISCOUT_DATA_MODE=understat pnpm eval:local-agent -- --help` displayed the corrected mode-aware guidance; `pnpm build` and `git diff --check` passed. No live model or source request was needed for this documentation/CLI-help correction.

## Comments

- 2026-10-12: Created after cross-checking the runbook commands against `configuredScenarios`, the CLI selector, and the ignored aggregate summary artifact.
- 2026-10-12: Corrected the CLI guidance and both documented Understat commands; verified the local CLI help and TypeScript build.
