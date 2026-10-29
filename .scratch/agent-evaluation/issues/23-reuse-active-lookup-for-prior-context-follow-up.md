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

The request-understanding node now treats a season/source follow-up as a saved-result request when the active lookup exists and all normalized player references are from prior context. Explicit current-turn player mentions continue through normal identity resolution. The targeted regression passes, as do all 134 Vitest tests, typechecking, and Ultracite checks. Live-model verification is recorded below.

## Live-model verification

Smoke `db57e292-9379-4051-80b3-d68d0d7fdaa5` used 8 requests under the approved 60-request total. The actual model completed the lookup, answered the season follow-up with `2024/25`, and the observation recorded `saved_lookup_result` without a second search. All deterministic code checks passed; semantic judging was disabled. The earlier separate smoke `0ddc1a1b-7593-4af6-b2e4-17d3aeebf4dd` used 4 requests but failed before completing the initial lookup, so it did not reach the regression behavior and remains preserved as a separate report.
