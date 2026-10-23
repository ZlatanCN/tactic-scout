# ADR-0002: Structured request understanding and identity routing

Status: accepted

Supersedes the identity-routing decision in ADR-0001.

## Decision

Every user turn passes through one structured request-understanding node. It extracts a bounded task kind, all player and team mentions, and only user-stated constraints. Raw mentions remain separate from optional lookup hints.

Every extracted player mention passes through the local identity resolver before the request can reach the model/tool loop. Multiple players are resolved one at a time. The resolver accepts an exact canonical Reep ID mapping or explicit user confirmation; it never resolves identity from a shared display name.

The graph state keeps per-turn request participants separate from the per-thread `conversationContext.focusPlayers`. The focus is updated only by a completed `player_lookup`; unsupported comparison and recommendation requests preserve it. A `prior_context` reference resolves only against the prior focus, never against explicit players that merely co-occur in the current request. A `same_turn` reference must name its explicit antecedent. Ambiguous or missing referents pause for clarification. References are never sent to the name lookup as literal names. This context uses the graph checkpointer and does not add a Store, database, memory node, or graph node.

The current `player_lookup` kind enters the existing assistant and `ToolNode` loop. Recognized comparison and recommendation kinds receive an explicit unsupported response until their workflows are designed. The graph does not create empty placeholder routes.

The search tool keeps each provider's data schema and provenance intact. It groups source-record references only when the identity registry resolves them to the same canonical Reep ID. Unlinked or ambiguous records stay separate.

## Rationale

- Routing by task kind prevents future workflows from becoming one tool-heavy ReAct prompt.
- Extracting all entities up front prevents ordinary lookup requests from bypassing identity resolution.
- A typed request contract gives comparison and recommendation workflows a stable input seam without implementing speculative execution nodes.
- Canonical grouping allows verified cross-source identity while retaining the distinct meanings of performance records and FM profiles.

## Consequences

- Request understanding runs before each new user turn and adds one structured model call.
- The identity state supports multiple player mentions, but team identity resolution waits for a team registry.
- Comparison, player recommendation, and team recommendation remain unsupported until their data needs and validation rules are specified.
