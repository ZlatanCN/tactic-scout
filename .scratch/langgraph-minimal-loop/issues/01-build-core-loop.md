# Build the native LangGraph core loop

Status: resolved
Labels: ready-for-agent

## What to build

Replace the previous agent/API/frontend/RAG implementation on the isolated branch with the four-module LangGraph structure in `spec.md`. Reuse the existing local Understat and FM SQLite snapshots through one bounded tool. Use in-memory checkpoint and Store; use Vitest for the loop test.

## Acceptance

- The graph is assembled from `StateGraph`, `ToolNode`, and LangGraph conditional routing.
- A named replacement/comparison reference is resolved against exact Reep IDs before tool search; ambiguity interrupts for user confirmation.
- A model tool call runs the local search tool, returns its result to the model, and produces a final message.
- Re-invoking the same `thread_id` in one process resumes the message history.
- No external model or local player database is needed by Vitest.
- TypeScript build and Vitest pass.

## Answer

Implemented in `src/agent.ts` and `src/utils/{state,nodes,tools}.ts`. The graph resolves exact names through the Reep registry, interrupts on short/ambiguous references before the assistant or search tool runs, and passes the confirmed identity into the assistant context. State uses explicit `Annotation.Root` reducers; the TypeScript follows arrow-function/type-only/export-at-bottom conventions. `pnpm test` passes 3 tests and `pnpm build` passes.
