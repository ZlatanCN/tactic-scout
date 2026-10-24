# ADR-0003: Graph, player-data, and tool module boundaries

Status: accepted

Keep `src/agent.ts` as the LangGraph composition entry. Put only actual graph node implementations in `src/nodes/`; keep shared request-extraction and player-mention logic in purpose-named modules. Put player search, deterministic reference resolution, source readers, and their contracts in `src/player-data/`, because both the entity-resolution node and the model-facing search tool use that capability. Keep `src/tools/` for LangChain tools exposed to the model. Player-data contracts may be used by graph state, but player-data must not depend on graph state. Do not create generic `utils/`, or one-file `identity/` and `request/` directories.
