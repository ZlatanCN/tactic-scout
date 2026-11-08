# Local Studio session recovery

The local LangGraph Dev Server provides the checkpointer and Store used by the Studio graph. Run `pnpm dev` to start it. To preserve a conversation, stop the server normally with Ctrl+C, wait for it to exit, then run `pnpm dev` again and reopen the same thread in Studio.

A question that was waiting for an identity, roster mapping, or another clarification remains attached to that thread. Answer it in the same thread to continue the pending request. Service startup does not start new scouting work. If a handled failure already completed its run, send a new request to retry it; resuming a completed run does not retry the work.

In the Studio conversation, manage shared player memory with explicit requests such as “Show remembered player aliases and mappings”, “Forget alias 凯恩”, “Correct the remembered alias 凯恩 to Erling Haaland”, or “Clear all player memories”. Clear-all displays its scope and waits for “确认”; “取消” leaves the records intact. A corrected or forgotten shared alias affects new threads, while older threads keep their confirmed local references and saved results.

This local development setup supports recovery after a normal stop and restart. It does not guarantee recovery after forced process termination, power loss, or damaged local storage. A read-only model or provider call interrupted before completion can run again when the scout resumes, so external calls are not exactly-once.

## State and memory version changes

`src/state.ts` exports `agentStateSchemaVersion`; increment it when a change makes a serialized thread State unsafe to continue. An older or unsupported thread remains readable, but the graph reports that the thread cannot continue and asks you to create a new thread. Do not edit the Dev Server's private checkpoint files to make the old thread appear compatible.

`src/player-memory.ts` owns the shared record schema version. Unsupported memory records do not authorize automatic identity reuse and are not silently migrated. When a source snapshot changes, the agent rechecks remembered provider IDs and current Reep links. Missing or conflicting identities remain stored for inspection, but the agent asks for a fresh confirmation before using them. Use the in-conversation memory list to inspect validation status, correct an alias after resolving its replacement identity, or clear supported records after reviewing the scope.

After a compatibility notice, keep the old thread for history and create a new thread for scouting. Reconfirm any identity that the new thread cannot safely reuse. Existing successful snapshots keep their original dates; new calculations use the current local source files and provider cache rules.
