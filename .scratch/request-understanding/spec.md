# Structured request understanding and routing

## Goal

Give the LangGraph agent one structured intake path for player lookup, comparison, player recommendation, and team recommendation requests. Resolve every named player through the local identity registry before the assistant or search tool uses that mention.

## Request contract

- `kind`: `player_lookup`, `player_comparison`, `player_recommendation`, `team_recommendation`, or `other`.
- `players`: zero or more exact user mentions with optional lookup hints. A lookup hint never confirms identity.
- `teams`: zero or more exact team mentions.
- `constraints`: named user-provided conditions, preserved as text.
- Player identity results: one result per mention, resolved only through an exact canonical Reep ID or explicit user selection.

## Routing

- All requests pass through structured understanding.
- All extracted player mentions pass through identity resolution before routing.
- The existing player lookup request enters the current assistant and ToolNode loop.
- Comparison and recommendation intents are recognized and receive a clear unsupported response until their workflows are implemented. Do not route them as ordinary lookups or create empty placeholder workflows.
- Ambiguous or unresolved player mentions use LangGraph `interrupt()` and resume through `Command({ resume })`.
- Search output groups source-record references under a canonical identity only when the Reep registry verifies the same canonical ID; unlinked records are listed separately.

## Boundaries

- No recommendation, comparison, team roster, RAG, or frontend workflow is implemented in this ticket.
- Do not merge records by display name. Keep each provider record and its provenance intact; canonical IDs identify shared players.
- Keep the model/tool ReAct loop for the currently supported lookup path.
