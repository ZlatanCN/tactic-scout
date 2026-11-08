# 06: Confirm and clear all player memory in conversation

Status: resolved
Blocked by: 04

Parent: [Managed persistence and user-confirmed player memory](../spec.md)

**What to build:** A scout can request that all shared player memory be cleared, review the scope in one native confirmation question, and approve or cancel it. That decision remains pending across a normal restart and never deletes conversations or unrelated data.

## Acceptance criteria

- [x] Recognize an explicit clear-all player-memory command and route it through the existing management business node. Show the affected scope and pause with a native interrupt before deletion.
- [x] One explicit confirmation applies the operation to the current user's player-memory records, including alias/source-group and roster relationships. Cancellation leaves all of them available.
- [x] An absent, malformed, ambiguous, or negative response is not approval. Reuse the typed pending clarification and supported Command-answer handling rather than a separate pending-operation lifecycle.
- [x] A clear-all question survives a normal managed-server stop/restart with its command and scope intact. Startup performs no deletion or fresh scouting work; an explicit same-thread resume answer is required.
- [x] Scope deletion to the trusted local-user player-memory namespace. Preserve unrelated Store records, source datasets, shared canonical registry links, thread histories, checkpoints, and existing threads' confirmed local references and successful workflow results.
- [x] After successful clearing, a fresh thread or an explicit re-resolution request follows the current shared state and normal identity resolution. Listing reports the actual remaining records; older thread context stays coherent.
- [x] Repeated execution/resume of the same operation does not duplicate its visible effect or silently broaden its scope. Do not claim exactly-once or atomic bulk deletion across multiple Store operations.
- [x] Store deletion failures are reported as unsuccessful or partial operations with honest remaining-memory visibility. Never report a completed clear when records could not be removed.
- [x] Real-server tests cover approval, cancellation, normal restart while awaiting approval, namespace protection, and the old-thread/fresh-thread distinction using both graph-created record kinds. Assert no deletion before confirmation.
- [x] Focused compiled-graph tests exercise malformed answers, failed/partial deletion, and replay. Relevant clarification, memory-management, and scouting regressions remain green.

## Verification boundary

Use conversational requests, managed API state/resume, later memory listing, and later identity resolution. For focused storage failure cases, use explicit isolated saver/Store instances through the compiled graph. Ticket 05 is not a blocker.

Specification coverage: user stories 6, 27–29, 31–32, 38–39, and 42–45.
