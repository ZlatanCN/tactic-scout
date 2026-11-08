# ADR-0001: Native LangGraph model and tool loop

Status: accepted

The identity-specific routing described here is superseded by ADR-0002. The single assistant/ToolNode loop remains accepted. ADR-0011 supersedes this document's in-memory/no-restart persistence clauses for the Dev Server/Studio path; implementation is complete under tickets 01–07.

## Decision

Build the first agent as one explicit LangGraph `StateGraph` with an assistant node and LangGraph `ToolNode`. `toolsCondition` routes model tool calls to the tool node and returns tool results to the assistant node.

Requests that name a player as a replacement/comparison reference pass through a graph identity-resolution gate before entering the model/tool loop. The gate uses structured extraction for the mention and exact Reep ID links for local candidate records. If identity is ambiguous or the registry is unavailable, the graph pauses with `interrupt()` and waits for explicit user confirmation supplied through `Command({ resume })`.

State uses LangGraph's `MessagesZodState` extended with reference-resolution and nullable clarification-answer channels. The prebuilt messages state tags the `messages` schema so LangGraph Chat recognizes it. Clarification resumes through `Command({ resume })`; a normal message input is not an interrupt resume value.

The original prototype chose `MemorySaver` for thread checkpoints and `InMemoryStore` for the Store, without application-managed recovery across process restarts. See ADR-0011 for the accepted Dev Server persistence design and in-memory test injection.

Keep the first source tool narrow: it performs bounded name lookup in the existing local Understat and FM SQLite snapshots. It returns each provider's records separately and does not infer identity from matching names.

## Rationale

- LangGraph owns the loop, message reducer, tool execution, and routing.
- The four source modules have one responsibility each: state schema, model node, data tools, and graph assembly.
- The first milestone does not need a custom planner, API server, frontend, RAG pipeline, or application database.
- Identity resolution is required control flow, so it is a graph node rather than an optional model-selected tool. Local lookup logic remains a deterministic function.
- In-memory checkpointing and Store keep the prototype simple while exercising LangGraph's graph interfaces.

## Consequences

- Standalone in-memory prototype execution loses its state on restart. Dev Server persistence ownership and the accepted recovery boundary are documented in ADR-0011.
- Source snapshots remain local files under `.data/`; they are separate from graph persistence.
- Source processing is blocked for remote model endpoints unless the relevant source-specific permission flag is enabled.
- A later persistence or UI decision can be made without changing the source search contract or model/tool loop.
