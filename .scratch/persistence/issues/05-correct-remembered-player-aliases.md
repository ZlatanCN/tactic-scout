# 05: Correct a remembered player alias explicitly

Status: resolved
Blocked by: 04

Parent: [Managed persistence and user-confirmed player memory](../spec.md)

**What to build:** A scout can explicitly correct a remembered player alias, resolve the intended replacement identity, and update future shared-memory use. An ordinary additional confirmation still preserves alternative meanings; a failed or cancelled correction does not silently erase the old binding.

## Acceptance criteria

- [x] Recognize explicit correction commands and process them through the existing management business node and native Store capability. Preserve the command's alias and replacement intent through any required clarification.
- [x] Clarify an ambiguous management target before editing it. Resolve the replacement through the normal identity-resolution/clarification paths and validate exact provider IDs and canonical constraints before changing earlier shared bindings.
- [x] Once a valid explicit correction is applied, new threads and explicit re-resolution use the replacement shared binding. An ordinary new identity confirmation continues to add a possible meaning rather than silently replacing an earlier identity.
- [x] Cancelling clarification, supplying an invalid answer, or failing to resolve a valid replacement leaves the earlier shared bindings intact. Different canonical Reep identities are not merged to satisfy a correction.
- [x] Existing threads retain previously confirmed local context and dated workflow results after a correction. Changing shared memory alone does not rerun scouting or retroactively edit historical results.
- [x] A correction waiting for identity confirmation survives normal restart; an explicit same-thread answer completes the original correction. Startup alone makes no correction or new scouting call.
- [x] Use stable confirmation/operation identifiers so repeated execution does not create duplicate replacement records or reinterpret an ordinary confirmation as a correction.
- [x] A Store failure yields an unsuccessful or explicitly partial management outcome. Never report complete replacement when writes/deletes did not complete, and do not promise an atomic transaction spanning checkpoint and Store operations.
- [x] Real-server tests demonstrate successful correction, cancellation, ambiguous replacement, restart/resume, and the difference between existing-thread context and fresh-thread resolution. Assert exact identity/source IDs and conversational memory visibility.
- [x] Focused compiled-graph tests inject correction failures and replay. Preserve successful workflow snapshots, existing identity constraints, and the relevant regression suites.

## Verification boundary

Reuse the management command path from 04 and the established identity resolution seam. Observe listing, subsequent resolution, State outcomes, and actual dependency calls instead of private helper sequencing. Ticket 06 is not a blocker.

Specification coverage: user stories 20–21, 26, 31–32, 38–39, and 42–45.
