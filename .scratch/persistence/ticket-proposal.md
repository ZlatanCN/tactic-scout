# Persistence ticket breakdown

Status: resolved
Review: approved by the user on 2026-11-06
Publication: seven implementation tickets published; implementation remains open

Based on the accepted [specification](spec.md) and ADR-0011. The user approved the seven slices and blocking edges on 2026-11-06. This document indexes the accepted breakdown; each implementation ticket is published separately with its own acceptance criteria. The parent specification is unchanged. The resolved status here records completion of breakdown approval and publication, not feature implementation.

## Approved vertical slices

1. **[01 — Resume complete conversations after a normal restart](issues/01-recover-managed-conversations.md).** Blocked by: None. Deliver the existing Studio conversation through the real managed-server API across a normal stop/restart, including all four successful workflow snapshots and pending player/roster questions. Verify explicit continuation of unfinished execution versus a new retry of a completed failure, and no scouting calls triggered by startup. Introduce the temporary-server test harness and only the runtime/factory prefactoring necessary for this behavior. No shared-memory feature is required for this slice.

2. **[02 — Remember explicitly confirmed player identities across threads](issues/02-remember-confirmed-player-identities.md).** Blocked by: 01. After a successful explicit player confirmation in thread A, reuse its alias or confirmed provider source group in thread B and after restart in thread C. This slice establishes the cohesive native Store capability, stable trusted namespace, versioned identity/provenance records, and independent in-memory Store injection for graph tests. Include exact source/Reep validation, ambiguity preservation, replay-safe writes, and honest Store read/write failure notices. Automatic resolution, historical aliases, and task-specific FM reference-profile choices must not become confirmed memory. Thread deletion must not erase the shared confirmation.

3. **[03 — Reuse user-confirmed roster FM profile mappings](issues/03-reuse-confirmed-roster-mappings.md).** Blocked by: 02. Persist an explicit API-Football-player-to-FM confirmation and reuse it in a later team recommendation after a restart. Validate exact IDs, retain provenance, handle competing or obsolete mappings without guessing, and preserve the local task on Store failure. The mapping never asserts current club membership; the latest applicable roster supplies that evidence.

4. **[04 — View and forget individual player memories in conversation](issues/04-view-and-forget-player-memory.md).** Blocked by: 03. Deliver conversational listing and targeted forgetting for both alias/source-group and roster records through the single management business node. Include identifiers, provenance, and validity in listing; clarify an ambiguous deletion target. Unambiguous alias forgetting removes its shared bindings, while roster forgetting identifies the exact relationship. Show Store failures honestly and demonstrate that old thread context remains intact while a fresh thread observes the deletion. This slice creates the memory-command routing and typed clarification foundation used by correction and clear-all.

5. **[05 — Correct a remembered player alias explicitly](issues/05-correct-remembered-player-aliases.md).** Blocked by: 04. Resolve the replacement player through the normal identity/clarification path before replacing shared alias bindings. Ordinary new confirmations still preserve alternative meanings. Cover cancellation, invalid or unresolved targets, interrupted/resumed correction, failed or partial writes, and repeat execution. New threads and explicit re-resolution use the corrected shared binding; existing confirmed local context and successful workflow snapshots remain historical.

6. **[06 — Confirm and clear all player memory in conversation](issues/06-confirm-and-clear-player-memory.md).** Blocked by: 04. A clear-all request shows its scope and waits for one native interrupt confirmation, including across normal restart. Approval clears only the local user's player-memory records; cancellation clears none. Preserve thread history, source data, canonical links, and unrelated namespaces. Report failed or partial deletion honestly and keep repeated resume from duplicating the operation's visible effect.

7. **[07 — Continue safely after source or schema changes](issues/07-handle-source-and-schema-changes.md).** Blocked by: 05, 06. Complete the upgrade journey across the finalized scouting and memory-command states: retain readable old history and confirmation provenance while refusing unsafe continuation or identity reuse. Missing source IDs, canonical conflicts, and incompatible memory records require re-confirmation; an incompatible thread requires a new thread. Verify the latest validated source data is used for new calculations and restored results retain their original dates. Earlier slices already validate current identities and handle their own faults; this slice extends that behavior to restart with changed source/schema fixtures and completes cross-feature regression verification and the local recovery instructions.

## Dependency rationale

- 01 supplies the managed-server restart acceptance harness required to demonstrate persistent behavior in later slices.
- 02 supplies the shared confirmation contract consumed by 03.
- 04 depends on 03 because its complete demo lists and forgets both real confirmation kinds, including a roster mapping created by the graph.
- 05 and 06 independently extend the management command/clarification path created by 04; neither blocks the other.
- 07 follows both 05 and 06 because its compatibility contract must cover the finalized correction and clear-all pending states as well as scouting state. Its other dependencies are transitive.
- No separate broad refactor ticket is warranted. Keep required prefactoring inside the first behavior that needs it, before that behavior is added, and preserve existing green callers.

## Coverage and verification rules

| Slice | Specification user stories | Main observable acceptance evidence |
| --- | --- | --- |
| 01 | 1–9, 41–45 | Managed API state before/after normal restart, same-thread resume, observed model/provider call counts. Clear-all interrupt coverage is completed by 06. |
| 02 | 10–11, 14–20, 30, 33, 36–37, 39–40, 42–45 | A → B → restart → C exact identity reuse, competing aliases require a choice, thread deletion independence, injected Store failures, no automatic/history-derived confirmation. |
| 03 | 12–13, 18–19, 33, 36–37, 39, 41–45 | Later team request uses the exact confirmed mapping, obtains membership from its applicable roster, and continues honestly on memory failure. |
| 04 | 22–26, 29–32, 34, 38, 42–45 | List and targeted-forget commands, ambiguous-target interruption, old-thread/new-thread differences, truthful failed operations. Correction-specific behavior is completed by 05. |
| 05 | 20–21, 26, 31–32, 38–39, 42–45 | Resolved replacement versus cancellation, no implicit overwrite, restart/resume, old local context versus updated shared binding. |
| 06 | 6, 27–29, 31–32, 38–39, 42–45 | Clear approval/cancellation before and after restart, namespace scope, no startup deletion, truthful failed/partial outcomes. |
| 07 | 23, 33–35, 41–45 | Changed-fixture restart with actionable re-confirmation/new-thread outcome, readable history and provenance, retained source dates. |

Every slice includes its own behavior tests and applicable failure cases. Primary persistence evidence uses the real Dev Server API with temporary storage and fake model/provider HTTP. Focused Store failures use the existing compiled-agent seam with explicitly isolated saver/Store instances. Do not rely on private persistence-file layouts, live user storage, or a paid evaluation campaign. Preserve existing fault-tolerance budgets and the repository's TypeScript conventions throughout.

Ticket 01 is resolved. The current frontier is [02](issues/02-remember-confirmed-player-identities.md); tickets 02–07 remain open with the `ready-for-agent` triage label and their listed blocking edges.
