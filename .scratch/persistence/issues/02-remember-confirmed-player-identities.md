# 02: Remember explicitly confirmed player identities across threads

Status: resolved
Blocked by: 01

Parent: [Managed persistence and user-confirmed player memory](../spec.md)

**What to build:** After a scout explicitly identifies a player or confirms an FM / Understat source group in one thread, another thread can reuse that confirmed identity, including after a normal restart. The agent retains ambiguity and tells the truth when shared memory cannot be read or saved.

## Acceptance criteria

- [x] An actual successful user identity confirmation saves the original and normalized mention, exact provider IDs, verified canonical identity when applicable, schema version, stable identity key, confirmation identifier, originating thread, time, and applicable source-version information through the native Store.
- [x] A cohesive player-memory capability owns the confirmation contract, deterministic retrieval, current-source validation, and idempotent writes. Extend the existing agent factory to accept an explicit Store; separate standalone agents remain isolated by default, and tests can deliberately share a Store across threads.
- [x] One trusted local-user namespace remains stable across threads and normal restarts. It is independent of thread IDs and cannot be selected by model output. Unrelated namespaces remain inaccessible to player-memory operations.
- [x] Confirm a Chinese name or nickname in thread A, reuse it in thread B, restart the server normally, and reuse it in thread C without another identity question when the memory remains unambiguous and valid. Assert the exact selected provider IDs, not just the display name.
- [x] The same journey works for an explicitly confirmed cross-provider source group. Preserve each record's provider and canonical-link status, keep provider data separate downstream, and never describe a personal confirmation as a globally verified Reep identity.
- [x] Reuse a compatible local thread reference first, then validated shared memory, then ordinary source search/clarification. A request that explicitly requires re-resolution can consult the latest shared record. Validate exact source IDs and current canonical constraints before adopting shared memory.
- [x] Automatic unique matches, Reep bridges, model suggestions, historical thread aliases without new confirmation provenance, and task-specific FM reference-profile choices do not create confirmed memory. Do not backfill old transcripts or mutate the shared Reep registry.
- [x] Permitted name/diacritic normalization broadens mention matching only. Same-name records with different canonical Reep IDs remain distinct. Multiple ordinary confirmations for one alias preserve the alternatives and prompt for the intended identity on later shared-memory use.
- [x] Missing or conflicting source records remain retained but cannot authorize automatic reuse; use the existing clarification flow to request a valid confirmation. Do not silently delete obsolete records or automatically expire valid confirmations.
- [x] Retrying or resuming the same confirmation keeps stable visible relationships and does not create duplicates or overwrite a different confirmed identity. Checkpoint and Store operations are not represented as one atomic transaction.
- [x] A Store read failure falls back to usable thread-local context or ordinary source resolution with a truthful notice. A Store write failure preserves the successful local confirmation and scouting task while stating that cross-thread saving failed. Neither case can claim that a failed save succeeded.
- [x] Memory contains identity pointers/provenance, not ability values, statistics, rosters, current club assertions, temporary scouting filters, preferences, or entire transcripts. Do not add embeddings, a generic model-controlled Store-write tool, or persistence-only graph nodes.
- [x] Deleting thread A through the managed API leaves its shared confirmation reusable in a new thread. Existing successful snapshots and normal workflow behavior remain intact.
- [x] Vitest covers real-server A → B → restart → C reuse and thread deletion through public APIs. Focused failures use the real compiled graph with independent in-memory saver/Store instances and an intentionally failing Store; confirm behavior from outcomes, selected source IDs, pending questions, and dependency calls. Keep the registry and source fixtures unchanged.

## Verification boundary

Reuse the managed-server harness from 01 and the existing compiled-agent factory. Inspect later resolution and observable graph outcomes instead of calling private memory helpers. Conversational listing is delivered by 04; this ticket is independently demoable through actual cross-thread scouting.

Specification coverage: user stories 10–11, 14–20, 30, 33, 36–37, 39–40, and 42–45. Source/schema-change restart journeys are extended by 07; explicit replacement of an earlier binding is delivered by 05.

## Comments

- 2026-11-07: Implemented cross-thread player identity memory through the managed Store and verified normal restart reuse, explicit cross-provider confirmation, stale source handling, Store failures, thread deletion independence, and isolated graph instances.
- 2026-11-08 review follow-up: Explicit re-resolution of a prior-context pronoun checks at most the eight most recent matching aliases, skips aliases without shared records, and uses the newest valid match. A newer stale or unavailable record prevents automatic adoption; the graph re-queries current sources and asks for confirmation. Added regression coverage for a newer unconfirmed alias ahead of an older confirmed alias, and for a deleted shared identity. Final verification passed: 39 Vitest files and 378 tests, TypeScript typecheck, and changed-file Ultracite checks; standards and specification reviews reported no remaining findings.
