# LangGraph 最小工具循环

## Goal

在独立分支上从零重建 TactiScout 的最小 LangGraph.js Agent。用户消息进入 assistant node；模型可请求一个受限的本地球员查询工具；ToolNode 执行后把结果返回 assistant node，直到模型结束。

## Structure

- `src/utils/state.ts`: `Annotation.Root` channels; messages use `messagesStateReducer`, identity values use replace-on-update reducers.
- `src/utils/nodes.ts`: identity-resolution and clarification nodes, plus the model node.
- `src/utils/tools.ts`: bounded Understat/FM lookup and exact Reep identity lookup.
- `src/agent.ts`: StateGraph, identity gate, ToolNode, conditional routing, compile.
- `langgraph.json`: LangGraph CLI graph entry.
- Vitest covers one complete model/tool/model path and same-process thread recovery.
- TypeScript uses arrow functions, `type` aliases (no `interface`), and exports grouped at file bottoms.

## Boundaries

- No frontend, RAG, application database, custom planner, or persistent checkpoint.
- Checkpoint and Store both use LangGraph memory implementations.
- `.data/` snapshots and `.env` are local inputs and are never committed.
- Understat and FM results remain source-separated; names alone do not resolve identity.
- A named replacement/comparison reference must resolve to one exact Reep identity or wait for user confirmation before the model/tool loop starts.
- Remote model processing requires source-specific permission; loopback model endpoints are allowed for the local prototype.
