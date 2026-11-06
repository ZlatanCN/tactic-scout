# TactiScout

## Purpose

This branch is a LangGraph.js football-data agent with three explicit player workflows. Lookup uses a bounded model/tool loop; comparison and FM recommendation use deterministic task nodes that call their data tools directly. LangGraph owns routing, interrupts, and per-thread state.

## Terms

**Source record**: One record returned by one data provider. A matching display name across providers does not confirm that two records represent the same person.

**Performance record**: A player-season observation with its source, competition, season, minutes, and reported metrics. It does not establish current club registration or transfer availability.

**FM profile**: A versioned Football Manager ability profile containing current ability (CA), potential ability (PA), and player attributes. PA is a potential ceiling signal, not a probability or guarantee of reaching it.

**Ability-similar recommendation**: A ranking of FM profiles by their position-specific attributes for a selected playing position. For multiple references, their attributes are averaged equally; this describes similarity within the FM snapshot, not real-world transfer availability. Candidates linked by Reep to a reference or explicitly excluded identity are removed across all FM profile IDs; the selected reference profile alone defines the comparison attributes.

**Potential prospect recommendation**: A separate list for requests about youth or potential, ordered by PA while showing CA and current-attribute similarity as context. It does not predict a future attribute profile or combine PA with the current-ability similarity score.

**Recommendation target position**: The playing position used to compare and filter candidates. An explicitly requested position takes precedence; if references do not share one unambiguous natural position and none is specified, the target must be clarified. Every reference profile must have a rating of at least 15 for the target position.

**Recommendation reference set**: One or more identity-resolved FM profiles whose playing-position attributes define the requested ability profile.

**Position-capable candidate**: An FM profile with a rating of at least 15 for the recommendation target position.

**Team identity**: A team selected by its provider-specific identifier. In the team recommendation workflow, the API-Football team ID identifies the team; it is not a canonical Reep team identity.

**Team roster snapshot**: The provider-reported set of current squad members captured at retrieval time. Its date is distinct from the FM ability snapshot date.

**Transient provider failure**: A temporary network or service-side failure from API-Football or the model provider. A short rate limit is transient only when a retry delay is given and daily quota remains; exhausted quota, authorization errors, malformed data, and unresolved identities are not transient.

**Team-position reference profile**: The equal-weight mean of the target-position attributes for mapped roster FM profiles with a position rating of at least 15 and complete required features. It describes the existing team profile at that position, not an inferred squad gap or tactical style.

**Team-directed recommendation**: Candidates for a scout-selected team and target position, ranked by distance from the team-position reference profile. Every FM profile linked by Reep to a mapped current-roster identity is excluded from the candidate set, not only the particular mapped FM source ID.

**Roster FM profile mapping**: A link from a provider roster player to one exact local FM profile, established by a Reep bridge or explicit user confirmation. Matching names alone do not establish the mapping.

**Roster mapping coverage**: For a captured squad, the counts of members linked to one usable local FM profile, members with no local profile, and members awaiting confirmation. Reep-bridge and user-confirmed counts identify how profiles were linked. This measures profile mapping, not target-position capability.

**Agent loop**: The repeated path from model node to a LangGraph `ToolNode` when the model returns tool calls, then back to the model. The loop ends when the model returns a response without tool calls.

**Structured request**: A bounded extraction of the user's task kind, all named players and teams, and explicitly stated constraints. For comparison, season and competition are data scopes; metric names such as FM ability and xG describe what to compare, not hard filters. It routes work; it does not invent a plan or evidence.

**Canonical player identity**: A Reep ID linked to one or more provider-specific player IDs. Search results may be grouped across providers only when the identity registry resolves both provider IDs to the same canonical Reep ID. Matching names alone never establish identity.

**Conversation player focus**: The resolved focal player or players from the latest successful single-player data lookup in one thread. Identity resolution alone does not replace the focus. A later pronoun may refer to this prior-turn focus; an explicit player named as a comparison target in the current turn does not replace it.

**Thread-local player alias**: An exact player mention the user has confirmed in a thread, bound to that resolved player reference. It avoids repeating model-based name expansion and identity confirmation in that thread; it does not modify the shared Reep identity registry.

**Thread-confirmed source group**: A set of provider source records the user explicitly confirms as one player in a thread. It keeps each record's provider and Reep-link status; it does not claim that unlinked records share a canonical Reep ID.

**Active lookup**: The exact source-tagged result from the latest successful single-player lookup, associated with its resolved player. A factual follow-up may use that saved result without rerunning name resolution or querying a different identity.

**Active comparison**: The confirmed participants, effective conditions, and completed result from the latest successful comparison in a thread. Conditions can include the season and Understat competition scope. Adding a player or refining conditions inherits that context unless the current message explicitly overrides a condition. A replacement comparison establishes its own participants and conditions.

**Active recommendation**: The confirmed reference and excluded identities, target position, effective filters, result limit, and completed result from the latest successful player recommendation in a thread. Condition refinements inherit this context; failed or interrupted attempts do not replace it.

**Active team recommendation**: The selected API-Football team, mapped roster snapshot, target position, effective filters, named reference if used, and completed result from the latest successful team recommendation in a thread. Filter refinements inherit this context; selecting another team starts a fresh team request, and failed or interrupted attempts do not replace it.

**Saved-result reuse**: A request to explain a completed result reads the validated result attached to its active workflow snapshot and marks the outcome as saved. It does not repeat identity resolution, provider reads, or ranking.

**Workflow continuation**: A follow-up without an explicit target continues the last compatible successful workflow when that is unambiguous. If multiple active snapshots can accept the current change, the agent asks which one; the pending clarification retains the current-turn patch until the user chooses.

**Scouting evaluation case**: A versioned scouting request or conversation paired with fixed source evidence and expected workflow behavior. Its evaluation covers task completion and whether the answer's factual claims are supported by that evidence.

**Scouting evaluation trial**: One independent execution of a scouting evaluation case, including all of its scripted turns and clarification answers. A confirmed critical failure anywhere in the conversation fails the trial; repeating the case creates a separate trial.

**Player-name search normalization**: Player lookup ignores Unicode diacritics and common one-to-one Latin orthographic variants such as `ø`/`o` when finding source records. This only broadens candidate retrieval; records with different Reep IDs remain separate and require confirmation.

**Evaluation identity-name comparison**: Evaluation checks use the same diacritic and common Latin spelling normalization for player mention strings. They still require exact selected candidate IDs, canonical Reep IDs, provider source IDs, and resolution statuses; this is not an identity-merging rule.

**Fixed evaluation evidence**: Versioned FM profiles, Understat performance records, and squad snapshots available to a scouting evaluation case, retaining provider identities, source dates, and missing fields. Grounding a generated claim additionally requires that its supporting evidence was actually supplied to the agent or legitimately reused from saved context.

**Scouting execution claim**: A statement that the agent attempted or completed a source lookup, comparison, ranking, filter application, or roster retrieval. Its evidence is an actual execution outcome or explicitly identified saved-result reuse; a requested tool call alone does not establish execution or success.

## Boundaries

- `StateGraph` owns routing and per-thread message state.
- Tool functions own local data access and return source-tagged records.
- The model may explain returned records; it must not invent missing values or merge source identities by name.
- Football Manager is a fixed, dated ability snapshot. Use it only for snapshot CA, PA, natural positions, and attributes; never use it to claim current/seasonal performance, current club registration, injuries, availability, or transfer status. Use a source that actually covers the requested time period, and abstain when no such source is available.
- A birth date is a stable date-of-birth fact. Calculate age from that date using the query's explicit as-of date; never treat an age calculated at the FM snapshot date as current age.
- Understat records are scoped to a competition and season. They support only the returned season's performance fields and do not establish current registration or live status. Do not present snapshot-scoped data as real-time data.
- Every extracted player mention passes through identity resolution before data tools run. Ambiguity pauses the graph for user clarification.
- Request extraction removes a terminal English possessive suffix (`'s` or `’s`) from a player mention before identity lookup. It canonicalizes that grammatical form only; it does not merge provider IDs or create a shared alias.
- Source records with the same canonical Reep ID form one identity automatically. Similar unlinked cross-provider names may be offered as a tentative group for explicit confirmation; names alone never merge identities. Candidates with different canonical Reep IDs remain separate.
- Once a source record resolves to a canonical Reep ID, identity resolution may include other provider IDs explicitly linked to that same canonical identity, even when provider display names differ. It must not infer those links from names.
- The identity interrupt resolves a person candidate and may include multiple source records. The user can confirm the group for the current thread or choose one provider record. Thread confirmation never writes to the shared Reep registry.
- User-confirmed player mentions are stored as thread-local aliases. If one mention was confirmed for multiple identities, the graph asks which identity the user means.
- Explicit player names resolve through the identity registry. Prior-turn references resolve only against conversation focus; same-turn references require an explicit target mention. Missing or multiple referents pause for clarification.
- Per-turn request participants, per-thread conversation focus, active comparison, and active recommendation are separate. A successful single-player data lookup updates the focus; identity resolution alone does not.
- A completed comparison stores its participants and conditions together. Additions inherit season and competition scopes, explicit current scopes override matching previous ones, and a new comparison resets them. An omitted season in a new comparison selects the latest local snapshot.
- Player-search tools read only the provider source IDs selected by identity resolution. The model cannot substitute another name or source record.
- The request-understanding node recognizes lookup, comparison, player recommendation, and team recommendation. Only lookup enters the model/tool loop; comparison and recommendation workflows invoke deterministic tools directly.
- The request-understanding node extracts the current turn and routes it. Deterministic workflow request construction and inheritance live in `src/request-building.ts`; previous-turn target selection and saved-result decoding live in `src/workflow-continuation.ts`.
- Team-directed recommendation requires a user-selected team and target position; it does not infer weak positions or formations from squad data. API-Football teams use their provider IDs, roster snapshots are cached in process for seven days, and roster players map to FM only through a Reep bridge or explicit user confirmation. A provider search name translated from the user's original team mention must be confirmed even when it yields one result.
- Current-squad acquisition is a retryable provider node that commits the roster before a separate deterministic node maps roster members to FM profiles and asks for confirmations.
- Team roster source dates and FM ability snapshot dates are shown separately. Incomplete roster-to-FM identity resolution pauses the request rather than guessing.
- One typed pending clarification resumes identity, FM profile, position, age, role, season, or workflow-selection questions within the same request. Workflow selection retains the current-turn patch until a target is chosen. Request state does not duplicate that lifecycle with status flags or an active player index.
- Each active workflow snapshot stores a complete validated result. The snapshot and its completed outcome are committed together before answer generation; valid empty results count as completed, malformed results surface as contract errors, and failed or interrupted work does not replace a snapshot.
- Completed outcomes identify whether data was executed this turn or reused from a saved result. Saved-result explanations route directly to the answer node. Historical tool messages do not reconstruct missing context.
- Tool results expose canonical identity groups from the Reep registry while keeping provider data and metrics separate. Unlinked records remain separate.
- Evaluation name matching ignores diacritics and common Latin orthographic variants only. It does not relax the exact identity or source-ID checks. Runtime lookup uses the same spelling normalization to find candidates, while canonical identity grouping still relies on Reep IDs or explicit thread confirmation.
- Thread checkpointing uses LangGraph's in-memory saver. There is no Store. Restarting the process loses thread state.
- There is no frontend, RAG pipeline, or application database in this branch.
