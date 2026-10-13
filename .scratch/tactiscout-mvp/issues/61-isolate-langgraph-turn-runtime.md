# Isolate the LangGraph turn runtime from recruitment graph construction

Type: task
Status: resolved
Labels: ready-for-agent

## Goal

Give the LangGraph graph builder and the HTTP-facing conversation turn lifecycle separate, small interfaces while preserving one shared recruitment graph, checkpoint state, thread ID, and progress contract.

## Why now

`src/agent/conversation.ts` currently owns both the investigation graph and the application turn protocol. The graph itself is a substantive LangGraph workflow: Planner/tool iteration, constrained policy routes, reviewer loop, and interrupt/resume. The turn adapter also owns thread serialization, checkpoint preflight, v3 event consumption, response projection, and terminal progress. Keeping these in one module makes runtime behavior harder to test and obscures which behavior belongs to LangGraph versus the application.

## Acceptance criteria

- [x] The graph remains the sole owner of investigation state, nodes, conditional routes, interrupt/resume, and the same checkpointer/thread ID.
- [x] A focused runtime module owns per-thread serialization, checkpoint preflight, initial-run versus resume selection, progress event draining, response projection, and terminal progress/errors.
- [x] The runtime interface is small and typed; it receives only the response projection plus interrupt markers, not full LangGraph state or raw event payloads.
- [x] Existing completed, needs-input, same-thread resume, failed-run, and concurrent same-thread behaviors remain intact.
- [x] Deterministic tests exercise the runtime through its interface, and relevant conversation integration tests plus backend/web builds pass.
- [x] No subgraph, duplicated state model, second checkpointer, or planner behavior change is introduced.

## Answer

Added `src/agent/conversation-turn-runtime.ts` as the application turn module. It serializes operations by thread ID, checks for expired saved cases, chooses whether the graph starts or resumes, drains and validates the typed v3 progress channel, and projects only the user-facing response fields. `conversation.ts` adapts the existing compiled graph into this interface; it still owns the single `StateGraph`, planner/tool loop, review route, interrupt node, and checkpointer.

Verification: the turn-runtime contract tests passed 5/5; `tests/recruitment-conversation.test.ts` passed 30/30 and `tests/recruitment-conversation-api.test.ts` passed 3/3 with the local StatsBomb test gate configured; backend and web production builds passed. No model or network call was made by these tests.

## Comments

- 2026-10-05：依据 [LangGraph 控制架构研究](../research/langgraph-agent-control-design-2026-10-05.md)，选取普通 TypeScript 模块 seam，不改变图运行语义。实现期间继续核对实际类型和调用点，避免把 Graph state 镜像到应用运行时。
- 2026-10-05：turn lifecycle 已移入 `conversation-turn-runtime.ts`。图适配器只投影 `pendingQuestion`、`responseMessage`、`report` 和 interrupt 标记；typed custom progress 在模块内 schema 校验，原始 LangGraph state/event 不进入 API/UI。
