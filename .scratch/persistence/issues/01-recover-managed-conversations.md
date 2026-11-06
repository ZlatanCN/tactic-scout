# 01: Resume complete conversations after a normal restart

Status: resolved
Blocked by: None (can start immediately)

Parent: [Managed persistence and user-confirmed player memory](../spec.md)

**What to build:** A scout can stop the local Dev Server normally, restart it, reopen the same Studio thread, and continue with the correct identities, conditions, successful results, and pending questions. Recovery waits for the user's action. This first slice demonstrates the actual managed persistence entrypoint and supplies a reusable temporary-server acceptance harness for later tickets.

## Acceptance criteria

- [x] The exported application graph uses the native server's checkpointer and Store ownership. Required runtime/factory prefactoring preserves existing standalone agent callers and isolated in-memory test behavior; it does not introduce another persistence backend.
- [x] Through the real managed-server API, create representative successful lookup, comparison, player recommendation, and team recommendation states. After a normal stop/restart, the same threads retain messages, resolved references, local aliases, focus, effective conditions, outcomes, and complete validated workflow snapshots. Demonstrate that multiple successful snapshots in one thread remain independent.
- [x] A compatible follow-up after restart uses the intended snapshot. Saved-result reuse is distinguishable from a fresh execution, retains source dates, and does not make an unnecessary provider read or ranking call.
- [x] Pending player-identity and roster-to-FM questions survive normal restart as native interrupts. An explicit same-thread Command answer continues the original request with its pending conditions intact.
- [x] Startup alone makes no new model/provider scouting request and does not answer an interrupt. Confirm this through observed dependency calls rather than an arbitrary fixed sleep.
- [x] User-triggered continuation of unfinished execution resumes the latest checkpoint. A handled provider failure that already reached the end remains a completed failed outcome until a new retry request. Failed or interrupted work preserves prior successful snapshots and existing retry limits.
- [x] A stopped or resumed node may repeat an unfinished read-only request; tests and documentation do not claim exactly-once external execution or recovery from forced termination, power failure, or corrupt storage.
- [x] Vitest acceptance tests launch the real development server against temporary storage, fake model/provider HTTP, and small deterministic source fixtures. They observe public thread/run/state/resume behavior and cleanly stop test processes. They do not inspect private persistence-file layouts or use the user's actual conversation storage.
- [x] Relevant existing graph, interrupt, and workflow regressions remain green. Record the normal-stop/manual-resume demonstration and its limits for subsequent tickets; no paid evaluation run is needed.

## Verification boundary

Use the managed Dev Server API as the primary seam. Reuse the existing compiled-agent factory only for focused execution-failure setup when necessary. Introduce no public private-helper test seam. Clear-all interrupt recovery is delivered by ticket 06, once that operation exists.

Specification coverage: user stories 1–9 and 41–45, with clear-all-specific coverage completed by 06. Follow ADR-0011 and retain existing canonical identity, validated-result, and fault-tolerance contracts.

## Comments

- 2026-11-07: Verified the existing Dev Server owns graph checkpointer/Store injection and flushes managed storage on normal shutdown. No separate persistence backend or application runtime change was needed for this slice. Added a reusable temporary-server test fixture, real API restart/resume coverage, and local recovery instructions. The full Vitest suite passed: 38 files and 365 tests. Typecheck and Ultracite check for the changed TypeScript files passed.
