# 23: Reuse the active lookup for season and source follow-ups

**What to build:** When a user asks about the season, league, or source of the most recent successful player lookup, answer from the saved result even if request understanding emits a `prior_context` player mention.

**Blocked by:** None.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Reproduce the baseline failure through the compiled graph with a repeated `thread_id`.
- [x] Recognize season, league, and source follow-ups when all extracted player references point to prior context.
- [x] Add a regression asserting the saved result is reused, no clarification is raised, and the search tool is not called again.
- [x] Run the full offline suite and record the final verification.

## Evidence

In corrected baseline `dc3c8927-7426-490a-b99b-abd19231554c`, two trials first completed a lookup for Elias Demo, then the model extracted `mention: "刚才查到的"` with `referenceScope: "prior_context"` for “刚才查到的是什么赛季？”. The graph failed to classify that as a saved-result follow-up and asked which player to look up.

## Resolution

The request-understanding node now treats a season/source follow-up as a saved-result request when the active lookup exists and all normalized player references are from prior context. Explicit current-turn player mentions continue through normal identity resolution. The targeted regression passes, as do all 134 Vitest tests, typechecking, and Ultracite checks. A live-model smoke was not run; the implementation is verified with the deterministic graph-level regression.
