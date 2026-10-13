# Route recruitment actions through a typed tool executor

Type: task
Status: resolved
Labels: ready-for-agent

## Goal

Separate tool execution from LangGraph state transitions with an exhaustive, typed executor contract, so the graph owns investigation policy while tool adapters own data access and return action-specific evidence.

## Why now

`execute_tool` currently combines action dispatch, repository and knowledge I/O, candidate evaluation, progress summaries, trace filters, tool history serialization, state updates, and source-failure handling. Adding or changing a data provider risks changing Planner control flow at the same time. LangGraph should remain responsible for deciding what to investigate and when; a typed executor can make the evidence contract and provider failure path independently inspectable.

## Acceptance criteria

- [x] Every dispatched tool action has a discriminated request and action-specific result; unsupported actions are rejected exhaustively.
- [x] The executor accepts repository, knowledge, and evaluation dependencies rather than constructing hidden app services.
- [x] Search filters, report-name restrictions, candidate pagination, and evaluation evidence are preserved exactly.
- [x] Tool failures propagate to the existing graph error policy and remain distinct from successful empty results.
- [x] LangGraph retains tool budgets, progress lifecycle, decision trace, checkpoint state writes, Planner loop, and user interrupt routes.
- [x] Deterministic tests cover all executor variants without network/model calls; relevant graph/Harness tests and builds pass.

## Answer

Added `src/agent/recruitment-tool-executor.ts` with an exhaustive request union and action-tagged result union for methodology search, player-report search, team inspection, candidate search, and candidate evaluation. Repository, knowledge base, and the deterministic evaluation callback are injected. The graph node still owns action budgets, progress, traces, failure-to-state policy, tool history, and each result's checkpoint-state updates.

The request adapter preserves the planner's candidate filters and offsets, and replaces model-suggested report names with the graph's already-evaluated and not-yet-searched player names. Provider errors continue to throw into the existing graph catch path; a valid empty page stays a successful result.

Verification: six executor tests passed, covering all five actions and empty-versus-failed candidate search. The complete suite passed 166/166 with the local StatsBomb test gate configured; backend and web production builds passed. Tests made no model or network calls.

## Comments

- 2026-10-05：依据 LangGraph 官方 fault-tolerance 资料和 issue 61 的模块拆分，采用普通 TS typed executor；只有未来某种 I/O 需要独立 checkpoint/retry/timeout 时才新增 Graph node。
- 2026-10-06：五类工具请求/结果已经类型化并通过依赖注入执行；LangGraph 节点仍控制调查进度、预算、checkpoint 状态更新及策略回路。完整 166 项测试和双端构建通过。
