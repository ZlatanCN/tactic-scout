# Managed persistence and user-confirmed player memory

Status: resolved

Confirmed by the user in Q19 on 2026-11-06. Implementation is complete in tickets 01–07. Implementation specification: [spec.md](spec.md). Architecture decision: [ADR-0011](../../docs/adr/0011-managed-persistence-and-confirmed-player-memory.md).

## Goal

For the existing local, single-process Studio demonstration, preserve complete conversation state and pending clarification questions across normal service stops/restarts. Reuse a local user's explicitly confirmed player identities across threads, with visible correction and forgetting operations.

## Confirmed decisions

| Question | Accepted decision |
| --- | --- |
| Q1 | Local development/private interview demonstration. |
| Q2 | Recover complete thread State and native pending interrupts, not chat messages alone. |
| Q3 | Include cross-thread player memory in this milestone. |
| Q4 | Store confirmed player aliases and identity relationships; no inferred personal preferences or temporary scouting filters. |
| Q5 | Automatically save successful explicit identity confirmations. Model guesses and unique automatic matches alone cannot create long-term memory. |
| Q6 | Dev Server/Studio owns persistent execution; standalone invoke remains an isolated test seam. |
| Q7 | Support normal-stop/restart recovery. Do not promise zero loss after SIGKILL, power loss, or corrupt development storage. |
| Q8 | Preserve multiple identities for one alias and clarify. Only an explicit correction replaces earlier remembered bindings. |
| Q9 | Thread deletion and shared player-memory deletion are independent. |
| Q10 | Wait for user-triggered continuation/retry after restart; pending interrupts keep waiting for the user. |
| Q11 | Memory failures allow the scouting task to continue with local thread/source evidence and a truthful notice. A failed memory operation cannot be reported successful. |
| Q12 | Retain obsolete/conflicting confirmation records, suspend automatic use, and request re-confirmation. |
| Q13 | Include explicit API-Football-player-to-FM identity mappings as well as player aliases/source groups. |
| Q14 | Preserve existing threads' already-confirmed context and historical results after shared memory changes. New threads and explicit re-resolution use current shared memory. |
| Q15 | Incompatible graph/data changes require a new thread when safe continuation is impossible. Preserve readable history; no automatic checkpoint migration. |
| Q16 | Provide memory management in the existing conversation interface. |
| Q17 | Clear-all requires one native interrupt confirmation. An explicit, unambiguous single-item forget operation executes directly. |
| Q18 | Save new explicit confirmations after enabling the feature. Do not automatically import historical thread aliases that lack confirmation provenance. |
| Q19 | Confirm the complete design and finalize the documents; implementation is the next stage. |

## Persistence ownership

Use the native Agent Server checkpointer and Store already supplied to `pnpm dev`. Add no separate SQLite database backend for this milestone. The exported server graph lets the server supply persistence; graph factories retain explicit saver/Store injection for isolated tests.

Checkpoint owns a thread's messages, request, pending clarification, focus, confirmed local aliases, four validated active workflow results, and native execution/interrupt state. Store owns cross-thread user-confirmed player memory. Source FM, Understat, and Reep databases remain external source datasets rather than conversation memory.

This private single-user instance uses one stable local-user namespace across threads. The model does not select the namespace. A future multi-user service would require authenticated user scoping and is a separate deployment decision.

## Memory data and authority

Persist two record kinds:

1. Player alias/source-group confirmation: original and normalized mention, canonical Reep ID when verified, exact provider player IDs, and explicit confirmation provenance.
2. Roster identity confirmation: exact API-Football player ID linked by the user to an exact FM player ID, with provenance and source-version information.

Records include a schema version, stable identity key, confirmation identifier, originating thread, and confirmation time. Store identity pointers and provenance, not historical CA/PA/performance values, team registration assertions, roster contents, or whole transcripts. An FM reference-profile selection for one recommendation remains task-specific.

Current thread aliases are not a safe import source: existing code adds them for both automatic unique/Reep resolution and user confirmation. Capture a new long-term write only at the actual successful user-confirmation boundary. Never create a global Reep link from a user memory record; distinct canonical Reep IDs remain distinct.

Use deterministic exact-key/field lookup without embeddings. Write a stable record for each alias/identity relationship or roster mapping so repeated node execution is idempotent and another identity for the same alias is not silently overwritten.

## Normal resolution flow

1. Reuse a compatible, already-confirmed local thread reference when available.
2. Otherwise consult the local user's shared memory.
3. Validate remembered IDs against current local source records and Reep identity constraints before automatic reuse. Preserve provenance on a confirmed source group without presenting it as a globally verified canonical identity.
4. If memory is absent, continue existing identity search/clarification. If remembered records are missing or conflicting, retain them and ask for confirmation rather than silently adopting or deleting them.
5. After successful explicit confirmation, keep the thread's resolved reference and attempt an idempotent memory write. If saving fails, continue the business request and clearly report that cross-thread memory was not saved.

For team recommendations, reuse validated user-confirmed API-Football-to-FM mappings during roster resolution. The link identifies a person across squad snapshots; it says nothing about whether that person still belongs to the old team.

## Graph and code shape

Keep the four scouting workflows and their validated State snapshots. Access the injected Store from the relevant existing entity-resolution, identity-clarification, and roster-resolution paths through a cohesive player-memory module.

Add one real business node, `manage_player_memory`, for conversational list/forget/correction/clear operations. `understand_request` recognizes explicit memory-management commands. Corrections requiring a target identity reuse the existing identity-resolution/clarification path before writing. Clear-all pauses with native `interrupt()` and resumes via `Command`.

Do not add separate graph nodes merely to load/save State or mirror the Store. Nodes return compact structured State patches; shared memory is accessed through the injected Store, not module-global mutation. Keep only the current memory command, typed pending clarification, and truthful operation outcome/notice in State rather than copying all shared memory into it.

## Management semantics

- List remembered aliases and roster mappings with display names, provider IDs, and validity/provenance.
- Forget an alias or a specific roster mapping only when the target is unambiguous; otherwise clarify which record.
- An ordinary new confirmation adds another possible identity. An explicit correction replaces earlier shared bindings only after the new target identity is resolved/confirmed.
- Clear all active player-memory records in the local user's namespace only after an explicit confirmation.
- Deleting shared memory does not rewrite old conversations or their already-confirmed local references. Thread deletion does not erase shared memory.
- Do not automatically expire active records. Revalidation controls usability; explicit forget/clear controls removal.
- A failed list/write/delete/clear operation returns an honest failure outcome. A failed write during a scouting task preserves its successful thread-local confirmation.

## Restart and compatibility

Normal restart restores state; it does not start new model/API calls automatically.

- Pending interrupt: continue waiting for a same-thread `Command({ resume })`.
- Unfinished execution caused by an unhandled error: user-triggered continuation resumes the latest checkpoint, not an arbitrary historical checkpoint.
- A handled provider failure that already reached END: start a new retry request; `invoke(null)` is not a retry of a completed failed outcome.
- A node interrupted during an external read may run again. Model/API reads may therefore repeat; use stable memory-write identifiers and do not claim exactly-once external execution.

Restored successful results remain dated historical evidence. New calculations validate current source identities and use the normal provider/cache rules. A changed dataset does not turn an old roster result into current registration data.

Use explicit State/memory schema versions and compatibility checks. If an old thread cannot safely execute, report the incompatibility and ask for a new thread without deleting readable history. Revalidate remembered identities using Q12; do not silently migrate incompatible records into authoritative mappings.

## Verification plan

Use deterministic fixtures and fake model/provider HTTP for the primary acceptance checks; no real model or provider call is required for persistence correctness.

- Run the actual development server in a temporary project/storage directory, stop normally, restart with the same storage, and inspect/resume the same thread through its API.
- Verify complete successful State recovery and interrupt/Command recovery after restart, including clear-all confirmation.
- Confirm an alias in thread A, resolve it in independent thread B, restart the service, and resolve it in thread C. Cover FM/Understat source groups and API-Football-to-FM roster mappings.
- Verify automatic Reep/unique resolution does not create user-confirmed memory.
- Exercise same-alias ambiguity, explicit correction, single-item forgetting, clear-all confirmation/cancellation, and independence from thread deletion.
- Verify old local thread context survives shared memory changes, namespace separation, obsolete/conflicting source IDs, Store failure notices, and idempotent repeated confirmation/resume.
- Keep existing deterministic workflow regressions green. The passed V43 evaluation remains historical baseline evidence; this design discussion does not trigger a new live evaluation campaign.

Tests use temporary storage and do not clear or copy the user's `.langgraph_api` conversation files.

## Accepted architecture decision

ADR-0011 supersedes only the in-memory/no-restart clauses of ADR-0001, ADR-0008, and ADR-0010 for the Dev Server path. Their graph, fault-tolerance, and validated-result decisions remain accepted. ADR-0004 is extended with user-scoped persistent confirmations; the canonical Reep registry remains unchanged. These accepted decisions are implemented in tickets 01–07.

## Verified runtime evidence

- Installed versions: LangGraph 1.5.2, checkpoint 1.2.1, CLI/API 1.5.5, core 1.3.0.
- `package.json:7` runs `langgraphjs dev`; `langgraph.json:5` exports the compiled `agent`.
- At design time, the standalone factory offered checkpointer injection and defaulted to `MemorySaver`; the managed Dev Server supplied its own checkpointer and Store. The implemented factory retains explicit in-memory injection for isolated SDK tests.
- Installed API `dist/graph/load.mjs:53–59` overrides both graph checkpointer and Store.
- Native server state files under `.langgraph_api`: `.langgraphjs_api.checkpointer.json`, `.langgraphjs_api.store.json`, `.langgraphjs_ops.json`; Git already ignores the directory.
- Installed API `dist/storage/persist.mjs:48–50` debounces writes for three seconds. Server cleanup flushes connections; CLI cleanup waits up to three seconds. This provides a normal-shutdown flush path, not strong crash consistency.
- Existing `conversationContextFromRequest()` also creates thread aliases on automatic resolution. Explicit identity resume/roster profile confirmation must supply long-term memory provenance.

Primary sources:
- https://docs.langchain.com/langsmith/agent-server
- https://docs.langchain.com/langsmith/local-dev-testing
- https://docs.langchain.com/oss/javascript/langgraph/stores
- https://docs.langchain.com/oss/javascript/langgraph/checkpointers#choose-how-to-continue-a-thread
- https://docs.langchain.com/oss/javascript/langgraph/interrupts
- https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance#retry-boundaries-and-idempotency
- https://github.com/langchain-ai/langgraphjs/tree/main/libs/checkpoint-sqlite
- https://github.com/langchain-ai/langgraphjs/tree/main/libs/checkpoint-postgres
