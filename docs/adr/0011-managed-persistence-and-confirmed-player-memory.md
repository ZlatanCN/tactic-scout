# ADR-0011: Use managed persistence and user-confirmed player memory

Status: accepted

Implementation: complete in persistence tickets 01–07 (2026-11-08). Confirmed by the user in Q19 on 2026-11-06; see [the accepted plan](../../.scratch/persistence/plan.md).

Use Agent Server's native checkpointer and Store for the local Dev Server/Studio entrypoint, accepting normal-stop/restart recovery. The installed server already injects both persistence services; changing the graph's standalone saver to SQLite would not change this server backend. Keep explicit in-memory injection for isolated SDK tests. This decision supersedes only the in-memory/no-process-recovery clauses of ADR-0001, ADR-0008, and ADR-0010 for the Dev Server path.

Persist complete thread State and pending interrupts through the native checkpointer. Persist user-confirmed player aliases/source groups and API-Football-to-FM identity mappings through the native Store under one stable local-user namespace. Capture only successful explicit user confirmations, validate exact source IDs before reuse, preserve ambiguity, and require an explicit correction to replace bindings. User memory does not change the shared canonical Reep registry or establish current team membership.

Shared memory has its own correction/deletion lifecycle, independent of thread deletion and existing threads' confirmed local context. Offer conversational management and native interrupt confirmation for clear-all. Memory I/O failures preserve the current scouting task with an honest notice. Use idempotent writes and user-triggered recovery; do not promise automatic startup execution, exactly-once external calls, hard-crash durability, or automatic migration of incompatible checkpoints. This extends the personal confirmation scope of ADR-0004 without changing its canonical identity rules.
