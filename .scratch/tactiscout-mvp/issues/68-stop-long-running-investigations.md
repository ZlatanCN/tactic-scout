# Stop long-running investigations from the workbench

Type: task
Status: open
Labels: ready-for-human
Blocked by: none

## Goal

Let the user stop a long LangGraph investigation from the UI and have the cancellation reach its active model request, while preserving the most recent complete report and avoiding reuse of a partially cancelled case checkpoint.

## Acceptance criteria

- [x] The active turn is addressable by its case ID and request ID and can be cancelled idempotently.
- [x] An `AbortSignal` reaches LangGraph, the Planner model request, and optional report-only PlayerElo lookups.
- [x] A turn waiting for the same-thread lock can be cancelled without blocking later turns behind an unreleased lock.
- [x] The UI shows an in-progress stop request until the graph has actually exited, then records cancellation as an explicit terminal event/API response rather than an ordinary failure or unknown transport outcome.
- [x] The workbench exposes a stop action, preserves the prior full report, and lets the user continue from a fresh graph case with visible conversation context.
- [x] Deterministic checks cover the HTTP cancel/progress contract, cancellation through a compiled LangGraph run, and release of the same-case queue for the next turn.
- [x] API and web production builds pass; local Qwen cancellation has been exercised through the running workbench.
- [ ] Manually verify the stop action and cancellation announcements with a screen reader.

## Comments

- 2026-10-06: Started after reviewing the long-running local-model path. The graph currently has a bounded per-request model timeout, but the UI has no stop control and an HTTP disconnect alone would not carry a cancellation signal into the LangGraph run.
- 2026-10-06: Added request-scoped cancellation from the workbench to the LangGraph `signal`, Planner `invoke`, and optional PlayerElo HTTP requests. Added a separate `cancelled` terminal event/API response, abortable same-thread lock waiting, and a stop control. After cancellation, the workbench retains the last report and starts any subsequent user input in a fresh graph case seeded from the visible transcript. Both production builds pass; live Ollama cancellation and screen-reader interaction were not exercised.
- 2026-10-06: Added three deterministic cancellation checks. The HTTP check confirms a cancelled response plus inactive terminal progress; the LangGraph check runs the compiled conversation graph, confirms the Planner receives the aborted signal, and verifies a cancelled runtime terminal; the queue check confirms cancelling the active turn lets the next same-thread turn run without overlapping graph runs. `node --import tsx --test tests/recruitment-cancellation.test.ts` passes 3/3, and API/web production builds pass. Live Ollama behavior and manual screen-reader interaction remain unverified.
- 2026-10-06: Corrected the cancellation lifecycle: the server previously labeled the turn `cancelled` and inactive immediately after signaling abort, before LangGraph had unwound. The progress snapshot now reports an active `cancelling` stage and the actual runtime exit appends the distinct terminal event; the focused HTTP check verifies both states, duplicate cancellation does not duplicate events, and event sequence numbers stay unique. The compiled graph check also waits for an observed `planning/started` event before aborting and verifies that cancellation reaches Planner and ends as cancelled. Focused checks pass 3/3; live Ollama and manual screen-reader interaction remain unverified.
- 2026-10-07: Through an isolated workbench tab, started a real `qwen3.5:9b` investigation and stopped it while the Planner was active. The visible timeline recorded “stop requested” followed by the actual cancelled terminal, and the assistant confirmed no report was produced. Then allowed a fresh investigation to complete, submitted another follow-up, and stopped that run during planning: the earlier complete report remained visible with its 0/30 ability-coverage evidence and risk notes; the input remained available, no plan was saved, and the temporary tab was closed. This validates the live Ollama abort and report-preservation path in the browser. Actual screen-reader announcements remain unverified, so the issue stays claimed.
- 2026-10-07: Re-ran the focused cancellation checks after the browser session: HTTP lifecycle, compiled LangGraph abort and same-case queue release all pass (3/3). Current API TypeScript build, web TypeScript/production build and `git diff --check` also pass. No full test suite was run.
- 2026-10-08: Per the user's selected acceptance scope, re-ran the HTTP lifecycle, compiled LangGraph cancellation and same-case queue-release checks; all 3/3 passed. The full deterministic suite also passes (281/281), along with both production builds and `git diff --check`. Screen-reader announcement behavior remains the one manual acceptance item.
- 2026-10-09: The user selected both the three cancellation seams and the complete warehouse-to-report conversation as acceptance surfaces. Re-ran `tests/recruitment-cancellation.test.ts`: HTTP lifecycle, compiled LangGraph `AbortSignal`, and same-case queue release all pass (3/3); API and Web production builds pass. The latest current-FPL → multi-turn LangGraph → Reviewer → report run is recorded in [issue 14](14-agent-harness-evaluation-suite.md) at 29/29 Harness checks. Screen-reader announcements remain the sole manual acceptance item.
