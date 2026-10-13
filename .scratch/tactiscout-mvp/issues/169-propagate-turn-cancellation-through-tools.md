# Propagate turn cancellation through scouting tools

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

When a user stops an investigation, propagate the request-scoped `AbortSignal` from LangGraph through the active scouting tool into provider I/O, knowledge retrieval, and candidate evaluation. A cancelled dependency must not be reported as an ordinary source failure, and the graph must not start another tool or produce a report after cancellation.

## Scope

- Keep the existing HTTP cancel, compiled LangGraph runtime, and same-case queue behavior.
- Propagate cancellation through candidate search, team inspection, methodology/player-report retrieval, and evaluator player/cohort reads.
- At Understat/ASA adapter-owned fetches used by `understat`, `asa`, and `mosaic` modes, combine the caller signal with existing request timeouts and stop response-body reads when supported.
- Check cancellation before and after operations that do not offer cooperative cancellation; document that an in-flight non-cancellable library operation may finish in the background.
- Preserve timeout/source-failure distinctions. A user cancellation is a terminal cancellation, never a zero-result page or a recoverable provider failure.
- Do not migrate LangGraph streaming, checkpoints, or turn-runtime architecture.

## Accepted verification seams

- `createApp` HTTP cancellation while an injected public repository or knowledge repository operation is active.
- `createRecruitmentConversation` compiled-graph cancellation through a real tool action; assert the dependency observes abort, cancellation reaches a terminal event, no next tool/report runs, and the same-case queue releases.
- A paired control that deliberately withholds the signal at the adapter seam, compared with the signal-enabled path. Report elapsed cancellation and work still active after terminal; this validates cancellation propagation only, not general speed or recommendation quality.

## Acceptance criteria

- [x] The active request signal reaches candidate search, team inspection, knowledge search, and evaluator reads.
- [x] Understat/ASA HTTP adapters used by `understat`, `asa`, and `mosaic` modes use the caller signal together with their existing timeout and stop fetch/body reads on user cancellation where the fetch implementation permits it.
- [x] CPU/local-library work checks the signal around awaited work and at meaningful batch boundaries; limitations of work that cannot be interrupted mid-call are explicit.
- [x] Cancellation errors bypass ordinary tool-failure recovery and cannot trigger another Planner/tool action or a report.
- [x] HTTP, compiled LangGraph, and same-case queue regressions pass through the accepted seams.
- [x] The paired signal-on/off observation shows whether post-terminal work remains; claims are limited to the observed fixture and dependency.
- [x] API/Web builds and `git diff --check` pass.

## Context

- [LangGraph tool cancellation gap research](../research/langgraph-tool-cancellation-gap-2026-10-12.md)
- [Existing stop/cancel behavior](68-stop-long-running-investigations.md)
- [Existing turn runtime seam](61-isolate-langgraph-turn-runtime.md)

## Comments

- 2026-10-12: Created from first-party LangGraph documentation/source review and inspection of the current tool/provider interfaces. Existing cancellation proves graph, Planner, PlayerElo, HTTP terminal lifecycle and queue release; it does not prove active scouting dependencies stop.

## Answer

Propagated the turn signal through typed tool execution, candidate/team repository reads, methodology/player-report RAG, and candidate/cohort evaluation. Understat and ASA fetches combine user cancellation with their request timeout; mosaic forwards one turn signal to both sources. Shared cached loads stop only after every active subscriber cancels. Cancellation bypasses normal provider-failure recovery; the graph cannot restart Planner or produce a report after a cancelled tool.

Verification: focused cancellation/provider set 48/48; full suite 415/415; API and Web production builds; `git diff --check`. Actual `createApp` HTTP, compiled `createRecruitmentConversation`, and same-case queue tests pass. The three-pair fixture ablation ended with 0 active source operations in all 3 signal-enabled trials and 1 in each of 3 controls where the adapter deliberately withheld the signal; controls were explicitly released after measurement. This is signal-propagation evidence for the fixture, not a speed or recommendation-quality claim. Transformers.js embedding and LanceDB calls may finish after cancellation because their current interfaces cannot abort an in-flight local operation; their results are discarded before another action/report.
