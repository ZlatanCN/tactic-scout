# TactiScout

## Purpose

This branch is a minimal LangGraph.js football-data agent. The model may call a bounded local player-search tool; LangGraph owns the model/tool loop and thread state.

## Terms

**Source record**: One record returned by one data provider. A matching display name across providers does not confirm that two records represent the same person.

**Performance record**: A player-season observation with its source, competition, season, minutes, and reported metrics. It does not establish current club registration or transfer availability.

**FM profile**: A versioned Football Manager ability profile. Current ability and potential are game data; potential is not a guarantee of future development.

**Agent loop**: The repeated path from model node to a LangGraph `ToolNode` when the model returns tool calls, then back to the model. The loop ends when the model returns a response without tool calls.

**Structured request**: A bounded extraction of the user's task kind, all named players and teams, and explicitly stated constraints. It routes work; it does not invent a plan or evidence.

**Canonical player identity**: A Reep ID linked to one or more provider-specific player IDs. Search results may be grouped across providers only when the identity registry resolves both provider IDs to the same canonical Reep ID. Matching names alone never establish identity.

**Conversation player focus**: The resolved focal player or players from the latest supported player lookup or explicit identity correction in one thread. A later pronoun may refer to this prior-turn focus; an explicit player named as a comparison target in the current turn does not replace it.

**Thread-local player alias**: An exact player mention the user has confirmed in a thread, bound to that resolved player reference. It avoids repeating model-based name expansion and identity confirmation in that thread; it does not modify the shared Reep identity registry.

## Boundaries

- `StateGraph` owns routing and per-thread message state.
- Tool functions own local data access and return source-tagged records.
- The model may explain returned records; it must not invent missing values or merge source identities by name.
- Every extracted player mention passes through identity resolution before model/tool execution. Ambiguity pauses the graph for user clarification.
- User-confirmed player mentions are stored as thread-local aliases. If one mention was confirmed for multiple identities, the graph asks which identity the user means.
- Explicit player names resolve through the identity registry. Prior-turn references resolve only against conversation focus; same-turn references require an explicit target mention. Missing or multiple referents pause for clarification.
- Per-turn request participants and per-thread conversation focus are separate. A completed single-player lookup or explicit identity correction updates the focus; unsupported comparison and recommendation requests preserve it.
- A single resolved player controls the player-search tool argument, so older mentions in the chat history cannot change the queried identity.
- The request-understanding node recognizes lookup, comparison, player recommendation, and team recommendation. Only player lookup currently enters the model/tool loop; other recognized tasks end with a clear unsupported response.
- Tool results expose canonical identity groups from the Reep registry while keeping provider data and metrics separate. Unlinked records remain separate.
- Checkpoint and Store use in-memory implementations in this branch. Restarting the process loses them.
- There is no frontend, RAG pipeline, or application database in this branch.
