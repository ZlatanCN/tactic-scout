# Keep candidate-expansion planning context compact

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Reduce avoidable local-model wait during candidate expansion while keeping the investigation genuinely model-directed. The Planner already receives the current exact search scope/cursor and evidence coverage as structured constraints, so earlier raw candidate/evaluation tool payloads should not be resent with each expansion decision.

## Acceptance criteria

- Candidate-expansion decisions preserve every user turn and the Agent's explicit clarification questions.
- Prior tool outputs and action logs already represented by structured decision constraints are excluded from the expansion history sent to the model.
- The model still receives target-team, source, confirmed role, requested capability coverage, eligible evaluated candidate IDs/evidence keys, exact expansion filters, and the next page offset through existing structured fields.
- Initial investigation and final evidence synthesis keep their current context semantics.
- Deterministic checks prove the compacted context preserves conversation turns/questions, removes bulky candidate/evaluation payloads, and does not change the decision constraints.
- The full local-model Harness scenario still completes from the configured repository through LangGraph, Reviewer, and report; record before/after latency as a single-run observation, not as a reliability claim.

## Answer

Extracted Planner history shaping into `src/agent/planner-context.ts`. Expansion decisions keep all user turns and formal `ask_user` questions, preserve tool results that are not represented by the structured decision state, and drop prior candidate-search/evaluation payloads plus ordinary action logs. The Planner still receives requested capability coverage, evaluated player IDs/evidence keys, the exact page filters/cursor, target club, source, and confirmed role through structured context. Initial investigation and conclusion history retain their previous behavior.

The expansion-only finish schema now bounds free-text output and candidate count. The Planner still chooses among another page, a material question, or a concise grounded finish; this preserves dynamic orchestration while avoiding an unnecessarily large report action during a page-expansion decision. If policy rejects an expansion question, a recovery decision passes the feedback to the Planner and only permits an exact next-page search or a grounded finish. It prevents repeat questions without hard-coding whether to continue.

Validation:

- `pnpm test`: 256/256 passed.
- `pnpm exec tsc --noEmit`: passed.
- `git diff --check`: passed.
- Full local Qwen/FPL scenario on the final code: 26/26 Harness checks passed in 43.305 seconds. It completed two clarification/resume cycles, evaluated 10 players, recovered from one policy-blocked question, passed Reviewer, and generated an evidence-backed report.

Latency observations are single runs: prior successful baseline 374.199 seconds; history compaction alone failed in 499.946 seconds after a 406.290-second truncated Planner response; output-bounded expansion passed in 50.992 seconds; a later run produced three failed behavior checks after repeating a blocked question; final recovery-branch run passed in 43.305 seconds. These observations do not establish a stable speedup or model reliability; local-model behavior varied substantially.

## Evidence and design

The 2026-10-08 FPL/Qwen end-to-end run passed all 26 behavior checks but took 374.199 seconds. During repeated candidate-page expansion, full search and evaluation tool payloads continued to grow in the Planner's `history` even though the graph separately provides requested-capability coverage and the exact search cursor/scope.

The history-compaction module is an internal seam: it accepts conversation entries and returns only the history the Planner needs for a given decision mode. It must not replace the Planner's dynamic choice with a deterministic next-action policy.

## Comments

- 2026-10-08：从真实运行轨迹确认后续扩样 Planner 调用不断携带历史工具原文；开始抽取纯上下文整理模块，保留 user/ask_user 轨迹，去掉 expansion 已有结构化约束可重建的工具数据。
- 2026-10-08：第一次完整复验经历两次追问、10 人评估和报告检索，但扩样 Planner 用时 406.290 秒后返回 `finishReason=length`，整场 499.946 秒失败。为扩样分支增加精简 finish schema 与输出指引后，同场景 50.992 秒完成，26/26 Harness 检查通过；与 374.199 秒基线及失败运行一起记录为单次观察，不作为性能保证。
- 2026-10-08：后续完整复验中模型两次重复提出策略拒绝的问题；guard 安全生成报告，但没有推荐且 3 项 Harness 检查失败。新增 `expand_recovery` 决策模式：将策略反馈交回模型，只允许按精确游标扩样或提交有证据约束的报告，不允许再次追问。
- 2026-10-08：最终 Qwen/FPL 全链路触发一次被策略拒绝的扩样追问；恢复模式保留原用户请求与策略反馈，模型选择提交证据约束报告，26/26 Harness 检查通过（43.305 秒）。最终代码 `pnpm test` 256/256、TypeScript 检查及 `git diff --check` 通过。
