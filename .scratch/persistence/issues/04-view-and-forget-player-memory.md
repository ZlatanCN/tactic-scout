# 04: View and forget individual player memories in conversation

Status: resolved
Blocked by: 03

Parent: [Managed persistence and user-confirmed player memory](../spec.md)

**What to build:** A scout can ask what player identities the agent remembers, forget an alias, or forget one exact roster-to-FM relationship in the existing Studio conversation. The operation shows what it changed, asks when its target is ambiguous, and leaves historical conversations coherent.

## Acceptance criteria

- [x] Extend structured request understanding and graph routing for conversational list and targeted-forget operations. Add the one business node `manage_player_memory` and reuse the cohesive native Store capability. Keep validation, selection, deletion, and State changes deterministic.
- [x] A listing shows both alias/source-group confirmations and actual user-confirmed roster mappings, with readable identities, exact provider IDs, confirmation context, and current validation status. Obsolete/conflicting records remain inspectable and are not described as verified current identities.
- [x] An explicit, unambiguous request to forget an alias directly removes that alias's shared bindings. An exact roster-mapping request directly removes the selected relationship without clearing unrelated alias or roster records.
- [x] An ambiguous forget target pauses for native clarification before deletion. The pending command survives same-thread Command recovery and normal restart; invalid answers or cancellation do not delete an arbitrary record.
- [x] Management operations are restricted to the trusted local-user player-memory namespace. Deletion does not alter source datasets, canonical Reep links, unrelated Store records, thread history, or checkpoints.
- [x] A fresh thread or an explicit re-resolution request observes a successful deletion. An older thread retains its already-confirmed local reference, focus, effective conditions, and successful workflow results; do not retroactively rewrite them.
- [x] Keep only the current management request, pending clarification when needed, and operation outcome/notice in State. The listing is an intentional result, not a permanent copy of all shared memory in every thread.
- [x] A failed list or delete returns a truthful unsuccessful management outcome. Report partial deletion if relevant and never claim that an uncompleted deletion succeeded. A later successful operation does not inherit a stale failure or success claim.
- [x] Replaying an already-applied management step does not produce duplicate visible effects or silently broaden its deletion scope. Preserve the existing scouting routing and successful workflow snapshots when management runs.
- [x] Through the managed API, create both record kinds using real graph confirmations, list them, forget each kind selectively, and verify later resolution plus old-thread behavior. Cover the ambiguous-target restart/resume journey and unrelated-namespace protection.
- [x] Use the existing compiled-agent seam to inject list/delete failures and inspect outcomes. Relevant request-understanding, identity, continuation, and team regressions remain green.

## Verification boundary

Use the existing conversation and graph/API entrypoints. Test memory visibility through conversational listing and subsequent identity use. Do not add a generic persistence management API or a model tool that can write arbitrary Store keys.

Specification coverage: user stories 22–26, 29–32, 34, 38, and 42–45. Correction is completed by 05; bulk clearing is completed by 06. This ticket depends on 03 because its end-to-end acceptance manages both confirmation kinds created by the graph.
