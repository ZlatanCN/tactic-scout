# Reanalyze a saved recruitment plan in a fresh LangGraph case

Type: task
Status: resolved
Labels: ready-for-human

## Goal

Let users deliberately refresh a saved report against the current data by starting a new LangGraph case from the plan's original brief, without losing the previous report during the run.

## Why now

The current “复核报告” action sends a follow-up into the completed case checkpoint. That can reuse previously discovered and evaluated candidates, so it does not guarantee fresh candidate discovery. A real reanalysis should start with a clean graph state while keeping the saved plan and its last complete report available.

## Acceptance criteria

- [x] A completed saved plan exposes a clear “重新分析” action; a plan waiting for an answer cannot accidentally start a second investigation.
- [x] Reanalysis creates a new case ID and starts the LangGraph turn with `expectsExistingState: false`.
- [x] The new case receives the original user brief and its originally selected target team, but not the old report as evidence or a source of candidate filters.
- [x] The previous report remains visible during investigation and if the new turn fails or asks a question; only a completed report replaces the saved snapshot and timestamp.
- [x] If transport outcome is unknown, retry reuses the same request ID and fresh case ID; it does not duplicate the investigation.
- [x] Tests cover request construction, plan snapshot retention/replacement, fresh-case versus follow-up contracts, and retry identity reuse.
- [x] API and web production builds pass.

## Answer

Replaced the misleading “复核报告” action with “重新分析”. It starts a new LangGraph case from the saved original brief, original target-team selection, and user clarifications. Replay construction excludes old assistant conclusions, candidate names, evidence, and the UI-only reanalysis marker. The pending-turn coordinator pins the fresh case ID and idempotency request ID across an unknown-outcome retry, while blocking a different turn until that result is recovered.

The last complete report remains visible during the new investigation, after a follow-up question, and after a known failure. Only a `completed` response with a report advances the saved snapshot timestamp. A question uses the new case checkpoint for its follow-up answer.

Verification: 14 focused plan/API/request-coordination tests passed; API and web production builds and `git diff --check` passed. Automated browser visual inspection was unavailable because the browser access review could not complete; no alternate access path was used.

## Context

- [MVP spec user stories 16–17](../spec.md)
- [local plan snapshot decision](03-local-plan-snapshots.md)

## Comments

- 2026-10-05：本机工作台有“复核报告”按钮，但它沿用已完成案件的 checkpoint。切换为全新案件可以明确刷新行为，同时复用既有“新报告完成后才替换快照”的 storage contract。
- 2026-10-05：重分析现在使用独立案件 ID 和只包含原始需求/澄清的请求；旧助手结论、候选和证据不会进入新的 Planner 上下文。断线未知结果时复用原案件与 request ID。
- 2026-10-05：定向 14 项测试、API/Web 构建、`git diff --check` 全部通过。浏览器视觉检查的自动审查未能完成，因此未尝试其他浏览器访问方式。
