# Local Studio session recovery

The local LangGraph Dev Server provides the checkpointer and Store used by the Studio graph. Run `pnpm dev` to start it. To preserve a conversation, stop the server normally with Ctrl+C, wait for it to exit, then run `pnpm dev` again and reopen the same thread in Studio.

A question that was waiting for an identity, roster mapping, or another clarification remains attached to that thread. Answer it in the same thread to continue the pending request. Service startup does not start new scouting work. If a handled failure already completed its run, send a new request to retry it; resuming a completed run does not retry the work.

This local development setup supports recovery after a normal stop and restart. It does not guarantee recovery after forced process termination, power loss, or damaged local storage. A read-only model or provider call interrupted before completion can run again when the scout resumes, so external calls are not exactly-once.
