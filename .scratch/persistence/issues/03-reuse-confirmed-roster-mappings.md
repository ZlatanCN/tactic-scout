# 03: Reuse user-confirmed roster FM profile mappings

Status: resolved
Blocked by: 02

Parent: [Managed persistence and user-confirmed player memory](../spec.md)

**What to build:** When a scout explicitly confirms that an API-Football roster player corresponds to one exact FM player, later team recommendations can reuse that identity relationship across threads and normal service restarts without repeating the same question.

## Acceptance criteria

- [x] Capture a successful explicit roster identity confirmation at its actual user-confirmation boundary, retaining the exact API-Football player ID, exact FM player ID, schema/source-version information, stable relationship key, confirmation ID, origin thread, and time in the existing player-memory capability.
- [x] A Reep bridge, name match, model suggestion, or task-specific recommendation reference-profile selection alone does not create a user-confirmed roster mapping.
- [x] Confirm a mapping while completing a team recommendation in thread A. A later team request in thread B and another after normal restart reuse that validated relationship for the same provider player ID without another mapping question.
- [x] Validate the remembered FM source ID and current canonical constraints before use. Competing, missing, or conflicting mappings cannot silently select the first match or overwrite another relationship; pause using the normal roster clarification path and retain confirmation provenance.
- [x] The remembered relationship identifies a person across roster snapshots. Current team membership, roster retrieval time, and roster contents still come from the applicable provider roster. A later roster that omits the player does not regain them from shared memory.
- [x] Read current FM attributes from the selected exact profile during new computations. A restored team recommendation retains its original FM and roster dates, and current roster caching continues to follow the existing rules.
- [x] A Store read failure permits the existing roster-resolution path to continue with an honest notice. A failed confirmation write preserves the local mapping and can complete the current team recommendation while disclosing that cross-thread saving failed.
- [x] Repeated confirmation/resume is idempotent for the same relationship. Shared memory does not store a squad snapshot or create new canonical registry links.
- [x] The real-server acceptance journey completes the team recommendation using deterministic fixtures and fake provider/model HTTP before and after restart. Assert exact mapped IDs, mapping provenance, selected roster membership, source dates, and unchanged ranking/coverage rules.
- [x] Focused compiled-graph tests exercise Store failures, obsolete IDs, competing mappings, and automatic-bridge non-authority. Existing roster interruption and team recommendation regressions remain green.

## Verification boundary

Reuse the server harness from 01, native Store capability from 02, and existing graph factory for narrow fault injection. The actual team workflow and deterministic ranking run; a canned completed recommendation is not persistence evidence.

Specification coverage: user stories 12–13, 18–19, 33, 36–37, 39, and 41–45. Conversational inspection and forgetting of these mappings are delivered by 04.

## Comments

- 2026-11-08: Added validated cross-thread roster mapping lookup to the existing player-memory capability. Explicit user confirmation remains the only write boundary. Current exact FM IDs and current Reep bridge constraints are checked before reuse; competing or stale relationships require clarification. The real Dev Server journey verifies thread A → thread B → normal restart → thread C, current roster membership, source dates, ranking, coverage, and that a later empty roster does not restore the remembered player. Final verification passed: 39 Vitest files and 387 tests, TypeScript typecheck, changed-file Ultracite checks, and separate Standards/Spec reviews found no remaining issues.
