# TactiScout

## Purpose

This branch is a minimal LangGraph.js football-data agent. The model may call a bounded local player-search tool; LangGraph owns the model/tool loop and thread state.

## Terms

**Source record**: One record returned by one data provider. A matching display name across providers does not confirm that two records represent the same person.

**Performance record**: A player-season observation with its source, competition, season, minutes, and reported metrics. It does not establish current club registration or transfer availability.

**FM profile**: A versioned Football Manager ability profile. Current ability and potential are game data; potential is not a guarantee of future development.

**Agent loop**: The repeated path from model node to a LangGraph `ToolNode` when the model returns tool calls, then back to the model. The loop ends when the model returns a response without tool calls.

**Reference identity resolution**: Identifying a player named as the target of a replacement or comparison request. The resolver may suggest candidates from local source records, but only an exact unique Reep ID mapping or an explicit user confirmation resolves the reference. A shared name alone does not link records across providers.

## Boundaries

- `StateGraph` owns routing and per-thread message state.
- Tool functions own local data access and return source-tagged records.
- The model may explain returned records; it must not invent missing values or merge source identities by name.
- Requests with a named reference player pass through identity resolution before the model can search for alternatives. Ambiguity pauses the graph for user clarification.
- Checkpoint and Store use in-memory implementations in this branch. Restarting the process loses them.
- There is no frontend, RAG pipeline, or application database in this branch.
