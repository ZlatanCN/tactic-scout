# Isolate the Planner model adapter from LangGraph control flow

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Give the Planner's OpenAI-compatible model call, structured-output parsing, and phase-specific instructions one focused module interface, while LangGraph remains the owner of durable case state, investigation policy, routing, tool execution, review, and user interrupts.

## Why now

`src/agent/conversation.ts` currently owns both the full `StateGraph` implementation and the concrete model adapter that implements the injected `RecruitmentPlanner` seam. The module already receives a fakeable planner, so the adapter has a real alternate implementation. Separating it lets maintainers inspect or replace model protocol behavior without mixing it into graph control flow, and gives the adapter's diagnostics and prompt variants a clear home.

LangGraph's current TypeScript design guide describes LLM operations as graph steps, with state retained as raw data and prompt context formatted when the node runs. TactiScout should keep that separation: the graph node still chooses when to ask the Planner and records its selected action; the extracted adapter only turns one typed decision request into one validated action. [Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)

## Acceptance criteria

- [x] The OpenAI-compatible Planner adapter, structured-output parsing, decision prompts, and Planner diagnostics live outside `conversation.ts`.
- [x] `conversation.ts` remains the owner of graph state, decision loop, policies, node/edge routing, tool scheduling, interrupt/resume, review, and checkpoint integration.
- [x] The graph depends on a small typed Planner interface; production and injected fake planners continue to satisfy it.
- [x] Existing model configuration, prompts, timeout/error classes, and HTTP response behavior remain unchanged.
- [x] Existing prompt/evaluator imports remain usable or are deliberately migrated without duplicating prompt definitions.
- [x] Deterministic behavior tests and backend/web builds pass without calling a model or external service.

## Answer

Moved the OpenAI-compatible implementation and its phase-specific prompts into [`recruitment-planner.ts`](../../../src/agent/recruitment-planner.ts). The module owns one typed `decide()` interface, structured-output parsing and diagnostics, prompt selection, and model timeout/configuration errors. The production graph constructs this adapter through `createRecruitmentPlanner()`; tests and other callers still inject a structural `RecruitmentPlanner` fake.

`conversation.ts` continues to own the sole LangGraph state graph: Planner invocation timing, state-derived constraints, policy overrides, tool budgets and execution, progress, `interrupt()` resume, evidence review, checkpointing, and final report projection. Compatibility exports preserve current application, evaluator, and prompt-test imports. The graph does not store prompt strings in checkpoint state.

Verification: backend and web production builds passed; the full deterministic suite passed 169/169 with the test-only StatsBomb loopback gate enabled. No model or external provider was called. The graph implementation shrank from 2,287 to 2,075 lines; the extracted adapter is 236 lines. README and `CONTEXT.md` now describe Planner and query-failure semantics without implying that current tool errors trigger LangGraph `retryPolicy`.

## Comments

- 2026-10-06：经 codebase-design skill 检查，这是已存在的真实 seam：production OpenAI-compatible adapter 和 conversation/Harness 中的 fake Planner 都实现同一个 `RecruitmentPlanner` interface。切片不增加第二层代理，也不把 prompt/state 复制到 LangGraph state；只移动实现并保持现有 injection seam。
- 2026-10-06：核对 LangGraph 官方 TypeScript 设计指南后，保留“图调用 typed LLM adapter”的节点职责：图 state 保存案件事实与动作，不保存格式化 prompt；适配器构造对应阶段的 prompt 并解析结构化 action。来源：[Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)。
