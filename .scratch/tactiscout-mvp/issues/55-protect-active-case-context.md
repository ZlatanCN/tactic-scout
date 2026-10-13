# Protect an active case while a turn is unresolved

Type: task
Status: resolved
Labels: ready-for-human

## Goal

Prevent saved-plan navigation and editing from replacing or confusing the case context while LangGraph is running or a transport result is still unknown.

## Why now

A response updates the case that initiated it. Switching or deleting a saved plan before that response arrives can make the workbench jump back to stale case state or recreate a deleted plan. The new reanalysis action adds another long-running turn where this boundary matters.

## Acceptance criteria

- [x] While a turn is running or its outcome is unknown, users cannot open, delete, or create another plan from the saved-plan controls.
- [x] The composer and save action are disabled until the current turn completes or is recovered.
- [x] Event handlers guard the same transitions so the UI cannot invoke them during an unresolved turn.
- [x] Request-state tests cover active, unknown-outcome, and settled states.
- [x] API and web production builds pass.

## Answer

The workbench now treats running and unknown-outcome turns as unresolved. Saved-plan open/delete/new actions, plan name editing, saving, and the composer are disabled, with a short status message explaining when they will become available again. The same guard is applied inside the handlers so a stale callback cannot bypass the UI state.

Verification: 15 focused request/API/plan tests passed; API and web production builds and `git diff --check` passed.

## Comments

- 2026-10-05：复用 turn coordinator 的 `isTurnUnresolved`，把界面操作边界绑定到执行态与未知结果态；用户恢复同一请求或拿到终态后重新开放。
