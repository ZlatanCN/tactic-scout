# Centralize explicit candidate search intent

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Resolve explicit candidate constraints from the user’s conversation in one domain interface, so clarification, candidate search, evaluation, and reporting apply the same position, age, minutes, competition, and season intent.

## Acceptance criteria

- [x] A pure, deterministic interface resolves user messages and the confirmed position into candidate search intent.
- [x] LangGraph uses that intent for position clarifications, search filters, evaluation eligibility, and final candidate filtering.
- [x] A reference player or target team alone does not imply candidate age, position, or competition constraints.
- [x] Existing search and same-case clarification behavior remains intact across the full data-to-report path.
- [x] Focused interface checks and the selected end-to-end LangGraph harness pass.

## Comments

- 2026-10-07：当前对话图在多个位置分别提取位置、年龄、分钟、赛事和赛季条件；本任务收敛解释规则，不改变数据源、Planner 能力或图的阶段路由。
- 2026-10-07：`pnpm eval:local-agent -- --scenario bayern-kane-replacement` 真实 Qwen 9B/FPL 运行通过 21/21 行为检查：3 轮对话、2 次同案追问、12 次工具调用、79 条匹配范围、30 人评估、Reviewer 与报告；耗时 282.4 秒。候选池为 FPL 当前赛季受限目录，球探排序准确率未评估。
- 2026-10-07：6 项意图接口边界检查、241 项完整测试、TypeScript 构建和网页生产构建通过。

## Answer

Added the pure `resolveCandidateSearchIntent` domain interface and routed graph search, candidate eligibility, report filtering and clarification transitions through its result. It preserves separate “competition mentioned” and “competition filter” meanings, so a negated league mention can prevent a misleading clarification without constraining candidate search. Real-model full-chain harness, deterministic suite and both builds passed.
