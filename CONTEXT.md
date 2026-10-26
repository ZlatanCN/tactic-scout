# TactiScout

## Purpose

This branch is a LangGraph.js football-data agent with three explicit player workflows. Lookup uses a bounded model/tool loop; comparison and FM recommendation use deterministic task nodes that call their data tools directly. LangGraph owns routing, interrupts, and per-thread state.

## Terms

**Source record**: One record returned by one data provider. A matching display name across providers does not confirm that two records represent the same person.

**Performance record**: A player-season observation with its source, competition, season, minutes, and reported metrics. It does not establish current club registration or transfer availability.

**FM profile**: A versioned Football Manager ability profile containing current ability (CA), potential ability (PA), and player attributes. PA is a potential ceiling signal, not a probability or guarantee of reaching it.

**Ability-similar recommendation**: A ranking of FM profiles by their position-specific attributes for a selected playing position. For multiple references, their attributes are averaged equally; this describes similarity within the FM snapshot, not real-world transfer availability.

**Potential prospect recommendation**: A separate list for requests about youth or potential, ordered by PA while showing CA and current-attribute similarity as context. It does not predict a future attribute profile or combine PA with the current-ability similarity score.

**Recommendation target position**: The playing position used to compare and filter candidates. An explicitly requested position takes precedence; if references do not share one unambiguous natural position and none is specified, the target must be clarified. Every reference profile must have a rating of at least 15 for the target position.

**Recommendation reference set**: One or more identity-resolved FM profiles whose playing-position attributes define the requested ability profile.

**Position-capable candidate**: An FM profile with a rating of at least 15 for the recommendation target position.

**Team identity**: A team selected by its provider-specific identifier. In the team recommendation workflow, the API-Football team ID identifies the team; it is not a canonical Reep team identity.

**Team roster snapshot**: The provider-reported set of current squad members captured at retrieval time. Its date is distinct from the FM ability snapshot date.

**Transient provider failure**: A temporary network or service-side failure from API-Football or the model provider. A short rate limit is transient only when a retry delay is given and daily quota remains; exhausted quota, authorization errors, malformed data, and unresolved identities are not transient.

**Team-position reference profile**: The equal-weight mean of the target-position attributes for mapped roster FM profiles with a position rating of at least 15 and complete required features. It describes the existing team profile at that position, not an inferred squad gap or tactical style.

**Team-directed recommendation**: Candidates for a scout-selected team and target position, ranked by distance from the team-position reference profile. Exact mapped current roster profiles are excluded from the candidate set.

**Roster FM profile mapping**: A link from a provider roster player to one exact local FM profile, established by a Reep bridge or explicit user confirmation. Matching names alone do not establish the mapping.

**Agent loop**: The repeated path from model node to a LangGraph `ToolNode` when the model returns tool calls, then back to the model. The loop ends when the model returns a response without tool calls.

**Structured request**: A bounded extraction of the user's task kind, all named players and teams, and explicitly stated constraints. It routes work; it does not invent a plan or evidence.

**Canonical player identity**: A Reep ID linked to one or more provider-specific player IDs. Search results may be grouped across providers only when the identity registry resolves both provider IDs to the same canonical Reep ID. Matching names alone never establish identity.

**Conversation player focus**: The resolved focal player or players from the latest successful single-player data lookup in one thread. Identity resolution alone does not replace the focus. A later pronoun may refer to this prior-turn focus; an explicit player named as a comparison target in the current turn does not replace it.

**Thread-local player alias**: An exact player mention the user has confirmed in a thread, bound to that resolved player reference. It avoids repeating model-based name expansion and identity confirmation in that thread; it does not modify the shared Reep identity registry.

**Thread-confirmed source group**: A set of provider source records the user explicitly confirms as one player in a thread. It keeps each record's provider and Reep-link status; it does not claim that unlinked records share a canonical Reep ID.

**Active lookup**: The exact source-tagged result from the latest successful single-player lookup, associated with its resolved player. A factual follow-up may use that saved result without rerunning name resolution or querying a different identity.

**Active comparison**: The confirmed participants and effective conditions from the latest completed comparison in a thread. Adding a player inherits those conditions unless the current message explicitly overrides them. A new comparison establishes its own conditions.

**Active recommendation**: The confirmed reference and excluded identities, target position, effective filters, result limit, and completed result from the latest successful player recommendation in a thread. Condition refinements inherit this context; failed or interrupted attempts do not replace it.

**Active team recommendation**: The selected API-Football team, mapped roster snapshot, target position, effective filters, named reference if used, and completed result from the latest successful team recommendation in a thread. Filter refinements inherit this context; selecting another team starts a fresh team request, and failed or interrupted attempts do not replace it.

## Boundaries

- `StateGraph` owns routing and per-thread message state.
- Tool functions own local data access and return source-tagged records.
- The model may explain returned records; it must not invent missing values or merge source identities by name.
- Every extracted player mention passes through identity resolution before data tools run. Ambiguity pauses the graph for user clarification.
- Source records with the same canonical Reep ID form one identity automatically. Similar unlinked cross-provider names may be offered as a tentative group for explicit confirmation; names alone never merge identities. Candidates with different canonical Reep IDs remain separate.
- The identity interrupt resolves a person candidate and may include multiple source records. The user can confirm the group for the current thread or choose one provider record. Thread confirmation never writes to the shared Reep registry.
- User-confirmed player mentions are stored as thread-local aliases. If one mention was confirmed for multiple identities, the graph asks which identity the user means.
- Explicit player names resolve through the identity registry. Prior-turn references resolve only against conversation focus; same-turn references require an explicit target mention. Missing or multiple referents pause for clarification.
- Per-turn request participants, per-thread conversation focus, active comparison, and active recommendation are separate. A successful single-player data lookup updates the focus; identity resolution alone does not.
- A completed comparison stores its participants and conditions together. Additions inherit conditions, explicit current conditions override matching previous conditions, and a new comparison resets them. An omitted season in a new comparison selects the latest local snapshot.
- Player-search tools read only the provider source IDs selected by identity resolution. The model cannot substitute another name or source record.
- The request-understanding node recognizes lookup, comparison, player recommendation, and team recommendation. Only lookup enters the model/tool loop; comparison and recommendation workflows invoke deterministic tools directly.
- Team-directed recommendation requires a user-selected team and target position; it does not infer weak positions or formations from squad data. API-Football teams use their provider IDs, roster snapshots are cached in process for seven days, and roster players map to FM only through a Reep bridge or explicit user confirmation. A provider search name translated from the user's original team mention must be confirmed even when it yields one result.
- Team roster source dates and FM ability snapshot dates are shown separately. Incomplete roster-to-FM identity resolution pauses the request rather than guessing.
- One typed pending clarification resumes identity, FM profile, position, age, role, or season questions within the same request. Request state does not duplicate that lifecycle with status flags or an active player index.
- Successful lookup, comparison, player recommendation, and team recommendation contexts are committed with their data outcomes before answer generation. Historical tool messages do not reconstruct missing context.
- Tool results expose canonical identity groups from the Reep registry while keeping provider data and metrics separate. Unlinked records remain separate.
- Thread checkpointing uses LangGraph's in-memory saver. There is no Store. Restarting the process loses thread state.
- There is no frontend, RAG pipeline, or application database in this branch.
