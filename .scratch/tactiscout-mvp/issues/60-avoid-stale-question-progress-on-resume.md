# Keep interrupt progress honest when resuming a user answer

Type: task
Status: resolved
Labels: ready-for-agent

## Goal

Prevent the live timeline from showing a stale “preparing a question” event when LangGraph resumes the `wait_for_user` node after the user has already answered.

## Why now

LangGraph re-executes an interrupted node from its beginning when resuming. `wait_for_user` currently emits `asking_user/started` before `interrupt()`, so an answer-resume turn can replay that old start event before continuing the investigation. The turn adapter already emits `asking_user/waiting_for_user` once the graph is actually paused; that is the authoritative user-visible wait state.

## Acceptance criteria

- [x] An actual interrupt is represented by the terminal `asking_user/waiting_for_user` event.
- [x] Resuming that interrupt does not emit a stale `asking_user/started` event before processing the answer.
- [x] A deterministic graph test covers both the pause and same-thread resume progress callback.
- [x] The issue map records the verified behavior and notes that real screen-reader verification remains separate.

## Answer

Removed the `asking_user/started` event emitted immediately before `interrupt()`. The turn adapter already publishes `asking_user/waiting_for_user` after LangGraph has actually paused; this is the accurate UI state and is not replayed as work when the node resumes.

The same-thread graph integration case now captures progress for the initial pause and resumed turn. It verifies the first turn ends in `waiting_for_user` and the answer-resume turn does not replay an `asking_user` start.

Verification: the targeted test `a clarified role survives checkpoint resume and constrains search, evaluation, reports, and later role changes` passed 1/1 with the local-only StatsBomb test gate configured; `pnpm build` passed. The full conversation test file was not run successfully without that gate, and manual screen-reader/browser verification remains separate.

## Comments

- 2026-10-05：依据 LangGraph 官方 interrupt 规则确认：恢复时会从含 `interrupt()` 的节点开头重跑；因此节点在 `interrupt()` 前的进度副作用会再次发生。官方依据见[中断恢复规则](https://docs.langchain.com/oss/javascript/langgraph/interrupts#rules-of-interrupts)及本地研究[LangGraph 控制架构](../research/langgraph-agent-control-design-2026-10-05.md)。
