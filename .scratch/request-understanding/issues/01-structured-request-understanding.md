# Add structured request understanding and routing

Status: resolved
Labels: ready-for-agent

## What to build

Add a graph intake node that extracts a bounded request kind, every player and team mention, and user-stated constraints. Resolve all extracted player mentions through the local Reep registry, prompting through LangGraph interrupts when identity is unclear. Route the supported player lookup intent into the existing model/tool loop. Return a clear response for recognized comparison and recommendation intents until their workflows exist.

## Acceptance

- Request extraction uses a typed, bounded schema and preserves literal mentions separately from lookup hints.
- Multiple named players are resolved one by one before request routing.
- Player records are only treated as the same person when canonical IDs match or the user explicitly selects a candidate.
- Tool output groups source record references by verified canonical ID and lists records without a resolved bridge separately.
- A normal player lookup continues to use the existing assistant/ToolNode loop.
- Recognized but unimplemented intents are not silently treated as lookups or recommendations.
- Existing no-interface, arrow-function, exports-at-bottom conventions remain in force.

## Answer

Implemented in `src/agent.ts`, `src/utils/state.ts`, `src/utils/nodes.ts`, and `src/utils/tools.ts`. The graph now extracts a structured request before resolving every player mention, routes the current lookup kind to the existing ReAct loop, and ends unsupported comparison/recommendation kinds with a direct explanation. Search results include canonical identity groups based only on verified Reep bridges. `pnpm build` passes. Vitest was not run in this turn.
