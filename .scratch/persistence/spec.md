# Managed persistence and user-confirmed player memory

Status: resolved

Design confirmed: 2026-11-06 (Q19). Implementation completed in tickets 01–07 on 2026-11-08.

## Problem Statement

The local Studio demonstration needs a reliable way to continue the same conversation after a normal service restart. Chat messages alone are insufficient: the agent also needs its resolved identities, scouting conditions, successful workflow snapshots, and any native interrupt that is waiting for an answer. Losing or reconstructing those from prose can repeat questions, select the wrong player, or explain an unrelated result.

The user also repeatedly confirms Chinese names, nicknames, cross-provider source groups, and roster-to-FM identities. Those explicit confirmations currently belong to one thread. A new thread cannot intentionally reuse them, and there is no conversational way to inspect, correct, or forget shared player memory.

The installed development server already supplies a managed checkpointer and Store. The application needs a clear persistence contract and confirmed-memory behavior around that existing runtime, rather than another storage backend. Existing thread aliases cannot be treated as confirmed-memory records because automatic resolution and explicit user confirmation both create them.

## Solution

Use the existing Dev Server / Studio as the persistent entrypoint for this local, single-process demonstration. After a normal stop and restart, the user can reopen the same thread, inspect its previous results, and explicitly continue or answer its pending question. Starting the service does not initiate fresh scouting work.

Remember successful explicit player-identity confirmations for the same local user across threads. Keep only identity pointers and their confirmation provenance in shared memory, validate them against current sources before reuse, and keep source facts in their existing datasets and workflow snapshots. Shared memory supplements the existing identity resolver without modifying the canonical Reep registry.

Support viewing, forgetting, correcting, and clearing player memory through the existing conversation interface. Preserve ambiguity instead of silently overwriting an earlier identity. Require one native interrupt confirmation before clearing all player memory. Memory failures remain visible while an otherwise valid scouting request can continue with thread-local context or ordinary source resolution.

## User Stories

1. As a local scout, I want my conversation messages to remain available after a normal service restart, so that I can continue an earlier discussion.
2. As a local scout, I want resolved players, request conditions, conversation focus, and local aliases to survive a normal restart, so that the agent does not reconstruct them incorrectly from chat text.
3. As a local scout, I want successful lookup, comparison, player recommendation, and team recommendation snapshots to survive a restart, so that follow-ups still refer to the correct completed results.
4. As a local scout, I want a pending player-identity question to remain answerable in the same thread after restart, so that I can finish choosing the intended person.
5. As a local scout, I want a pending roster-to-FM question to resume after restart, so that I can finish an interrupted team recommendation.
6. As a local scout, I want a pending clear-all confirmation to remain pending after restart, so that restarting cannot silently approve a destructive memory operation.
7. As a local scout, I want service startup to wait for my continuation or retry request, so that reopening the application does not initiate unexpected model or provider calls.
8. As a local scout, I want continuation of unfinished execution to use its latest compatible checkpoint, so that completed steps are not restarted unnecessarily.
9. As a local scout, I want a handled, completed failure to require a new retry request, so that a saved failed outcome is not mistaken for a still-running task.
10. As a local scout, I want an explicitly confirmed Chinese name or nickname to work in another thread, so that I do not repeatedly identify the same player.
11. As a local scout, I want an explicitly confirmed FM / Understat source group to work in another thread, so that valid records for one person remain usable together.
12. As a local scout, I want an explicitly confirmed API-Football player-to-FM mapping to work in another team request, so that I do not repeat the same roster identity confirmation.
13. As a local scout, I want roster identity memory to identify a person without asserting their current club, so that an old confirmation cannot become false registration evidence.
14. As a local scout, I want successful explicit identity confirmations to be remembered automatically, so that I do not need a second save command.
15. As a local scout, I want automatic unique matches, model guesses, and Reep bridges to remain distinguishable from my confirmations, so that shared memory does not claim authority I never supplied.
16. As a local scout, I want historical thread aliases to stay local unless I confirm them again after this feature is enabled, so that uncertain provenance is not silently imported.
17. As a local scout, I want a task-specific FM reference-profile choice to remain part of that task, so that one selection does not become a permanent identity preference.
18. As a local scout, I want shared memory to retain exact provider identifiers, so that similar names do not cause records for different people to be merged.
19. As a local scout, I want distinct canonical Reep identities to remain distinct, so that personal memory cannot bypass the project's identity rules.
20. As a local scout, I want the agent to ask which player I mean when one remembered alias has several identities, so that a new confirmation does not silently erase an earlier one.
21. As a local scout, I want an explicit correction to resolve the replacement identity before changing shared bindings, so that a misunderstood correction cannot silently discard the previous meaning.
22. As a local scout, I want to view remembered aliases and roster mappings with their identifiers and confirmation context, so that I can understand what the agent remembers.
23. As a local scout, I want missing or conflicting remembered identities to be identified as needing confirmation, so that stored records are not presented as currently verified.
24. As a local scout, I want an unambiguous request to forget one alias to execute directly, so that routine memory management stays simple.
25. As a local scout, I want to forget one exact roster mapping, so that an incorrect mapping can be removed without clearing unrelated memories.
26. As a local scout, I want an ambiguous forget or correction target to be clarified, so that the agent does not edit the wrong memory.
27. As a local scout, I want a clear-all request to show its scope and ask for confirmation, so that I can review it before shared player memory is removed.
28. As a local scout, I want cancellation of clear-all to leave the remembered records available, so that declining the operation has an observable effect.
29. As a local scout, I want clearing player memory to affect only my player-memory namespace, so that unrelated Store data, source datasets, and thread history are not deleted.
30. As a local scout, I want deleting a thread to preserve shared player memory, so that conversation cleanup does not erase useful confirmations.
31. As a local scout, I want forgetting or correcting shared memory to preserve old threads' confirmed local context and results, so that their historical conversations remain coherent.
32. As a local scout, I want new threads and explicit re-resolution requests to use the latest shared memory, so that a correction or deletion affects future resolution.
33. As a local scout, I want remembered source IDs to be checked against current datasets and Reep constraints, so that obsolete or conflicting identities are not reused automatically.
34. As a local scout, I want obsolete confirmation records to remain visible until I explicitly forget them, so that I can understand and repair their history.
35. As a local scout, I want an incompatible old thread to retain readable history and explain that I must open a new thread, so that unsafe execution does not corrupt my conversation.
36. As a local scout, I want a shared-memory read failure to fall back to local context or normal identity resolution with a clear notice, so that a storage problem does not unnecessarily prevent scouting.
37. As a local scout, I want a shared-memory write failure to preserve my successful thread-local confirmation and disclose that it was not saved across threads, so that the current task can continue honestly.
38. As a local scout, I want failed list, forget, correction, or clear operations to be reported as failures, so that the agent never claims a memory change it did not complete.
39. As a local scout, I want resumed or retried confirmation steps not to create duplicate records, so that graph recovery does not multiply memories.
40. As a local scout, I want confirmed identities to remain remembered until I forget them while still being revalidated on use, so that an arbitrary expiry does not erase useful confirmations.
41. As a local scout, I want restored results to retain their source dates, so that fixed FM values and old roster or performance snapshots are not presented as current facts.
42. As a project maintainer, I want tests to exercise the real managed-server API across a normal stop and restart, so that the persistence claim is demonstrated at its actual entrypoint.
43. As a project maintainer, I want graph tests to inject independent checkpoint and Store instances, so that memory-failure and thread-isolation checks are repeatable without paid model calls.
44. As a project maintainer, I want persistence tests to use temporary storage, so that verification cannot clear or modify the user's actual conversations.
45. As a project maintainer, I want the four existing scouting workflows and their fault-tolerance rules to retain their behavior, so that adding persistence does not reopen previously solved workflow failures.

## Implementation Decisions

### Runtime ownership and scope

- The persistent product entrypoint is the existing Dev Server / Studio. Let the native server supply its checkpointer and Store; do not introduce an application database or a second persistence owner.
- The standalone agent factory remains the isolated execution seam. Extend its existing dependency contract to accept a Store as well as a checkpointer. Keep standalone defaults isolated and in memory; a server-owned exported graph uses the runtime-supplied persistence services. Existing standalone callers must not unexpectedly share memory.
- Support a local, single-process, private demonstration with normal shutdown and restart. The installed development storage is not a promise of zero loss after forced termination, power failure, or corruption.
- Scope shared memory under a stable, trusted local-user namespace that remains the same across threads and restarts. Thread IDs do not define that namespace, and model output cannot select it. This does not introduce accounts or authentication.

### Persistence responsibilities and State

- The checkpointer owns the complete thread State and native execution state: messages, structured request, conversation focus, thread-local aliases, pending clarification, fault-tolerance state, outcomes, four validated active workflow snapshots, and native interrupts.
- The Store owns user-confirmed player memory independently of threads. It does not replace workflow snapshots, source databases, the Reep registry, or the provider cache.
- Extend State only with the current typed memory-management request, its pending clarification when needed, and a truthful memory operation result or notice. Do not copy the complete shared memory collection into every thread or add another lifecycle alongside the existing pending clarification.
- Keep the existing validated-result contract: a successful snapshot and its completed outcome are committed together; failed or interrupted work does not replace the last successful snapshot. Stored results remain dated historical evidence.
- Nodes return structured State patches. Access shared persistence through the injected Store contract, not a module-global mutable collection. Preserve the current serial graph unless a concrete workflow requires concurrency; reducers remain necessary only where updates actually need merging.

### Memory contract and confirmation authority

- Build one cohesive player-memory capability that owns native Store access, deterministic identity lookup, validation, idempotent confirmation writes, and memory-management operations. Existing graph nodes consume that capability rather than duplicating its storage rules.
- Persist two record kinds: player alias/source-group confirmations and roster identity confirmations. Alias records retain the original and normalized mention, exact provider player IDs, and any verified canonical Reep identity. Roster records link one exact API-Football player ID to one exact FM player ID.
- Each record includes a schema version, stable identity key, confirmation identifier, originating thread, confirmation time, and applicable source-version information. Retain enough provenance to distinguish explicit confirmation from automatic resolution and to explain a remembered relationship.
- Store identity pointers and provenance only. Do not store CA, PA, performance statistics, squad contents, current club assertions, preferences, temporary scouting constraints, whole transcripts, or a selected task-specific FM reference profile as shared memory.
- Capture writes only at an actual successful explicit user-confirmation boundary, including an explicit correction that has resolved its target. A model-proposed candidate, an automatic unique match, or a Reep bridge alone cannot create user-confirmed memory.
- Existing thread-local aliases mix automatic and explicit origins. Do not bulk-import them or scan old threads into the Store. New confirmation provenance starts when this feature is enabled; a user can explicitly reconfirm an older relationship.
- Use the existing name normalization for deterministic mention matching, including permitted diacritic normalization. Normalization does not establish identity, merge providers, or relax exact source-ID and canonical Reep checks. No embedding index or semantic memory retrieval is required.
- Personal memory never writes canonical links to the shared Reep registry. Preserve each source record's link status, and reject attempts to combine records with different canonical Reep IDs. A user-confirmed source group is not a globally verified canonical identity.

### Resolution and graph integration

- Reuse a compatible thread-local reference before consulting shared memory. Otherwise consult the current user's shared records and validate their exact source IDs against current source data and canonical constraints before automatic reuse.
- With no applicable memory, follow existing source search and clarification. Multiple remembered identities for one mention require clarification; an obsolete or conflicting record is retained but cannot authorize automatic resolution. Ask for a valid confirmation instead of silently deleting or trusting it.
- An explicit request to re-resolve a player consults the latest shared memory rather than treating an older local binding as final. Shared changes alone do not rewrite an existing thread's already-confirmed local context.
- After an explicit identity confirmation, retain the resolved reference in the current thread and attempt the shared write. Keep provider data separate downstream and read only the selected source IDs.
- During roster resolution, reuse a validated user-confirmed API-Football-to-FM mapping across roster snapshots. It establishes identity only; current membership still comes from the current provider roster snapshot.
- Add one business node, `manage_player_memory`. Extend request understanding to recognize explicit list, forget, correction, and clear commands. Route memory operations through this node without adding graph nodes whose sole purpose is loading or saving persistence.
- Corrections that need a replacement player reuse the existing identity-resolution and clarification paths before shared bindings change. Memory-specific ambiguity and clear-all use the existing typed clarification mechanism with native interrupt / Command recovery. Preserve the interrupted command until the answer is applied.
- Deterministic code performs validation, selection, Store operations, deduplication, and State changes. Semantic request interpretation may use the existing model boundary; do not expose an unrestricted model tool for writing arbitrary Store keys.

### Management, replay, and failure behavior

- Listing returns remembered aliases and roster mappings with readable names, exact provider IDs, provenance, and current validation status. A list is a deliberate operation result, not a permanent mirror of the Store in State.
- An explicit, unambiguous single-item forget command runs directly. Clarify an ambiguous target before editing it. Forgetting an alias removes its shared bindings; forgetting a roster mapping targets its provider identity relationship.
- A normal new confirmation adds a possible identity without silently replacing another identity for the same alias. Only an explicit correction replaces earlier shared alias bindings, and its replacement identity must be resolved first. Cancellation or unresolved target selection must not remove the earlier bindings.
- Clear-all reports the scope and pauses for one native confirmation. Approval removes the current user's active player-memory records only; cancellation removes none. It does not delete threads, checkpoints, source datasets, the canonical registry, or unrelated Store namespaces.
- Shared memory deletion and thread deletion have independent lifecycles. Previously confirmed local references and historical workflow results remain available in an old thread after shared forget, correction, or clear-all. Future threads and explicit re-resolution use the latest shared state.
- Use stable record keys and confirmation identifiers so replay of the same confirmation does not create duplicate records. Preserve separate relationships for different confirmed identities. Checkpoint and Store operations are not one transaction; do not claim exactly-once external execution or atomic multi-record edits.
- Do not automatically expire active memories. Revalidation determines whether they can be reused; explicit forget and clear determine removal.
- On a Store read failure during scouting, continue with available thread-local context or ordinary source resolution and produce a clear memory-failure notice. On a confirmation write failure, preserve the successful local identity and continue the task while stating that cross-thread saving failed.
- A failed list, forget, correction, or clear operation is an unsuccessful management outcome. Never claim that memory was saved or removed without a successful Store operation. If an operation completed only partially, report that limitation instead of reporting full success. Do not turn unexpected programming exceptions into successful memory results.

### Restart, compatibility, and engineering constraints

- Startup restores access to stored threads and memory without submitting or automatically continuing application work. A pending interrupt waits for an explicit same-thread resume answer.
- User-triggered continuation of unfinished execution uses the latest checkpoint. A handled provider failure that already reached the graph's end requires a new retry request; an empty continuation is not a retry mechanism for completed failed outcomes.
- Interrupted or unfinished nodes may execute again, including read-only model or provider calls. Preserve the accepted fault-tolerance attempt limits and honest execution reporting rather than promising that every external request executes once.
- Introduce explicit State and memory schema versions with compatibility validation before unsafe business execution or memory reuse. An incompatible thread must retain readable history, disclose the incompatibility, and request a new thread. Do not automatically migrate incompatible checkpoints or treat incompatible memory as authoritative.
- Revalidate identity references after source changes. Historical results retain their original dates; new calculations use current source data and normal provider/cache rules. A restored roster snapshot does not refresh its retrieval date or repopulate the process cache as a newly fetched roster.
- Keep modules cohesive and reuse existing request, identity, roster, and result boundaries. Follow the repository's arrow-function-only style, `type` declarations instead of `interface`, and consolidated exports at the bottom of source files.

## Testing Decisions

### Test seams and prior art

- The primary acceptance seam is the real Dev Server API serving the application graph. Launch it with a temporary project/storage directory and deterministic local model/provider HTTP, create and run threads through public APIs, stop normally, restart with the same storage, then inspect or resume those threads. This seam proves the actual Studio persistence path instead of a standalone saver approximation.
- Reuse the existing `createAgent` compiled-graph seam for focused fault injection that is impractical through the managed server: provide an independent in-memory saver and Store per test, share a Store across threads only when the scenario requires it, and inject failing Store operations deliberately. Assert graph invoke, same-thread Command resume, State snapshots, messages, and observed dependency calls.
- These boundaries carry forward the accepted plan's verification scope. The server test extends the existing graph/Command tests to the managed entrypoint; it does not add a public helper-testing API. Existing agent, identity-resolution, team-recommendation, and fault-tolerance Vitest suites provide examples of isolated graph construction, interruption/resumption, saved-result reuse, and deterministic provider failures. Evaluation-runner tests provide prior art for local fake HTTP services and request counting.
- Good tests assert external behavior: which person and source IDs were selected, whether a question was asked, which operation succeeded, which history remains, and which calls occurred. Do not assert private helper calls, internal node order when several legal routes exist, or the server's private persistence-file layout.

### Acceptance scenarios

1. **Complete normal-restart recovery.** Persist representative successful snapshots for all four workflows together with messages, conditions, focus, aliases, and outcome. Stop and restart normally, inspect the same thread, and make a compatible follow-up. Verify exact participants, effective conditions, saved evidence dates, and the distinction between saved-result reuse and fresh execution.
2. **Native interrupt recovery.** Stop while waiting for player identity, roster mapping, and clear-all confirmation. After restart, verify the same question remains pending and an explicit Command answer continues the intended request. Cancellation of clear-all leaves memories available; startup alone issues no model/provider request and performs no deletion.
3. **Manual recovery semantics.** An unfinished execution resumes only after a user action and uses its latest checkpoint. A completed handled failure remains a completed outcome until a new retry request. Verify provider request counts and successful snapshot retention rather than merely checking chat text.
4. **Cross-thread confirmation lifecycle.** Explicitly confirm an alias in thread A, resolve it in independent thread B, restart, and resolve it in thread C. Repeat for a confirmed FM / Understat source group and for a roster mapping. Assert exact source IDs and no repeated identity question when the validated memory is unambiguous.
5. **Confirmation authority.** Automatic unique/Reep resolution, unaccepted model suggestions, historical thread aliases, and task-specific FM profile selection do not create new confirmed-memory records. Actual identity confirmation does. Observe memory through conversational listing and later resolution rather than importing private storage helpers.
6. **Identity boundaries.** Cover equal display names for different people, permitted accent variants, a confirmed noncanonical source group, and conflicting canonical Reep IDs. Normalization may retrieve candidates but cannot merge distinct IDs. Memory never mutates the canonical registry or fabricates a current club relationship.
7. **Ambiguity and correction.** Two ordinary confirmations of one alias preserve both identities and require a later choice. An explicit correction resolves its target and replaces the earlier shared bindings. Cancelled, unresolved, or invalid correction targets preserve the earlier bindings. Replaying a successful confirmation creates no duplicate visible memory.
8. **Conversational management.** Check list, direct unambiguous alias forget, exact roster-mapping forget, ambiguous target clarification, correction, clear approval, and clear cancellation. Confirm the operation's visible result and its effect in a fresh thread. Unrelated namespaces and source datasets remain unaffected.
9. **Independent lifecycles.** Delete thread A through the managed API and reuse its confirmed memory in another thread. Forget, correct, or clear shared memory and verify an older thread retains its local references and historical results while a fresh thread or explicit re-resolution observes the new shared state.
10. **Source and schema compatibility.** Remove a remembered source ID, introduce a canonical conflict, or change a version to an unsupported schema. Verify unsafe automatic reuse is refused, an actionable clarification or new-thread notice appears, and readable history/confirmation provenance is retained. An old result's date is never rewritten as current.
11. **Store failure behavior.** Inject read, confirmation-write, list, delete, correction, and clear failures through the existing graph seam. Scouting can continue when valid local/source evidence remains, with a truthful notice; management does not report success. A failed save preserves the thread-local confirmation, and later successful operations do not inherit a stale success/failure claim.
12. **Isolation and replay.** Separate cases use separate persistence instances and temp directories. Threads deliberately sharing one trusted namespace can reuse memory; different namespaces cannot. Repeated resume or confirmation keeps stable visible records without silent last-write loss of another identity.

### Verification boundaries

- Use Vitest, tiny deterministic source fixtures, fake model/provider transports, and actual graph execution. Keep request understanding, identity selection, source-ID validation, and business computation real where the scenario exercises them; do not replace the entire workflow with canned completed results.
- Do not use the user's actual development storage, copy its conversations, or clear it for setup. Keep temporary server resources and local HTTP services scoped to the test and clean them up after the process stops normally.
- Run the existing relevant workflow regressions alongside the new acceptance checks during implementation. Persistence correctness does not require a new paid-model evaluation campaign; the passed V43 report remains historical baseline evidence.
- Verify normal-stop durability and manual recovery only. Forced-kill, power-loss, corrupt-storage recovery, distributed races, and exactly-once external execution are outside the promised acceptance contract.

## Out of Scope

- A new SQLite/Postgres persistence backend, a custom checkpointer, or a replacement Agent Server implementation.
- Production deployment, authentication, multiple user accounts, multi-process coordination, or distributed consistency guarantees.
- Embedding search, RAG, vector memory, inferred preferences, general conversational autobiography, or a model-controlled arbitrary Store-write tool.
- Promoting personal confirmations into the shared canonical Reep registry or merging distinct canonical identities.
- Treating remembered FM values, old performance data, or roster snapshots as current registration, contract, availability, or transfer evidence.
- Persisting a task-specific FM profile preference across threads.
- Automatic backfill from historical aliases or transcripts, automatic migration of incompatible checkpoints, or retroactive rewriting of old threads after shared memory changes.
- Automatic expiry of confirmed memories, automatic execution of unfinished scouting work at startup, or exactly-once guarantees across checkpoint, Store, model, and provider operations.
- Zero-loss recovery after forced termination, power failure, or corrupted development storage.
- New frontend work, a generic agent memory framework, or another live-model quality-gate campaign as part of this persistence milestone.

## Further Notes

- The user confirmed the complete [persistence plan](plan.md) in Q19 on 2026-11-06. This specification synthesizes that agreement; it does not reopen the product interview.
- [ADR-0011](../../docs/adr/0011-managed-persistence-and-confirmed-player-memory.md) records the accepted runtime and memory boundaries. It supersedes only the Dev Server in-memory/no-restart clauses of earlier decisions; canonical identity, fault-tolerance, and validated workflow-result contracts continue to apply.
- Use the vocabulary in [CONTEXT](../../CONTEXT.md), especially source record, canonical player identity, thread-confirmed source group, user-confirmed player memory, player-memory correction, roster FM profile mapping, and validated active workflow snapshots.
- The runtime investigation covered installed LangGraph 1.5.2, checkpoint 1.2.1, CLI/API 1.5.5, and core 1.3.0. Recheck managed persistence and shutdown behavior if dependencies change during implementation. Runtime implementation details in the plan are evidence, not a public storage-file contract.
- Implementation tickets 01–07 are resolved. Managed-server restart recovery, user-confirmed memory, and source/State compatibility are implemented and covered by deterministic tests.
