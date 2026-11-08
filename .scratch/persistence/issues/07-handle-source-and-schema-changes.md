# 07: Continue safely after source or schema changes

Status: resolved
Blocked by: 05, 06

Parent: [Managed persistence and user-confirmed player memory](../spec.md)

**What to build:** After local source data or application State/memory structures change, a scout can still read prior history and understand which identities need fresh confirmation or which conversation needs a new thread. New work uses validated current sources, while restored results keep their original dates and meaning.

## Acceptance criteria

- [x] Apply explicit State and memory schema versions with compatibility validation at the existing execution and memory-use boundaries. Cover all finalized scouting and management request/clarification forms, including correction and clear-all, without adding load/save-only graph nodes.
- [x] A compatible normal restart continues to recover the full conversation and its pending questions. An incompatible thread preserves readable history, reports an actionable incompatibility, asks for a new thread, and does not proceed with unsafe scouting execution or memory mutation.
- [x] Unsupported or unusable shared-memory records cannot authorize automatic identity reuse. Preserve their original confirmation record/provenance and require a valid new confirmation rather than silently migrating them into authoritative mappings or deleting them.
- [x] After restart with changed source fixtures, missing exact provider IDs or new canonical Reep conflicts suspend automatic reuse for aliases/source groups and roster mappings. The agent asks for confirmation and retains the old record for inspection or explicit forgetting.
- [x] When exact remembered identities remain valid, new calculations read the applicable current source data. Shared identity memory does not supply old CA/PA, performance values, roster membership, or a task-specific reference-profile preference.
- [x] Restored successful lookup/comparison/recommendation results keep their original source dates. A saved roster snapshot is not relabeled as freshly retrieved, and normal provider-cache rules remain in effect for new requests.
- [x] Existing local references remain historical context when shared records change, subject to compatibility/current-source safety checks before new execution. Failed re-confirmation, incompatible continuation, or failed new work does not overwrite a successful workflow snapshot.
- [x] Existing memory read/write/list/delete/correction/clear failure handling continues to produce truthful outcomes after restart. Compatibility checks must not turn unrecognized data into a false successful memory operation.
- [x] Managed-server acceptance tests restart with changed deterministic data and compatible/incompatible application fixtures through public APIs. Verify readable history, actionable notices or pending questions, exact source-ID use, retained dates, and no unsafe side effects. Do not depend on editing the server's private persistence files.
- [x] Run the relevant existing and new Vitest regressions, type checking, and repository lint checks for the completed persistence feature. Reuse fake HTTP and temporary storage; no new paid-model quality-gate campaign is part of acceptance.
- [x] Record reproducible local instructions for normal stop/restart, reopening the same thread, answering an interrupt, retrying a completed failure, managing shared memory, and opening a new thread after incompatibility. State the normal-stop guarantee and the absence of forced-crash, automatic migration, automatic startup execution, or exactly-once promises.

## Implementation result

- Added `stateSchemaVersion` checks before request extraction and resumed clarification handling. Incompatible threads retain history and stop before scouting or memory mutations.
- Versioned shared memory and revalidate exact player source IDs and current Reep links before reusing identities. Stale and conflicting records remain inspectable and require confirmation; valid roster mappings use the current FM snapshot for new calculations.
- Updated the local recovery guide and ADR implementation status.
- Verification: all 411 Vitest tests pass; `pnpm typecheck` passes; lint and format checks pass for all changed files. The repository-wide `pnpm check` still reports errors in unrelated bundled `.agents/skills/technical-drawing` files.

## Verification boundary

Use the real managed-server API for source/schema-change restart journeys and the existing compiled-agent factory for focused unsupported-record or Store-failure injection. Assert public behavior and exact evidence; retain the existing passed evaluation as historical baseline evidence. Do not inspect or clear the user's conversation storage.

Specification coverage: user stories 23, 33–35, and 41–45, plus compatibility and recovery behavior across the completed earlier slices. Both 05 and 06 are blockers because their finalized pending states and management outcomes are included in the compatibility contract; other dependencies are transitive.
