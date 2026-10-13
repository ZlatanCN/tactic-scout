# Request foot.io access and clarify data-use permissions

Type: task
Status: open
Labels: ready-for-human
Blocked by: 111

## Goal

Find out whether foot.io can support a current-player data route that can safely power the complete TactiScout flow from the player data warehouse through LangGraph to a user-visible report.

## Human action

1. Submit the project through the [official foot.io waitlist](https://foot.io/signup). Public API keys are not being issued immediately; the page says access is invite-only during closed beta.
2. Once the waitlist confirmation arrives, email `hello@foot.io` with the questions below. Do not share API credentials in this issue or put them in the repository.
3. Attach the written answer here. Do not run a player-data smoke or enable a source until the rights and scope are clear.

## Questions for foot.io

- For the free key, which competitions and season IDs currently return `player_season_stats`, not just matches? For the leagues we name, how many player-season rows and distinct players are queryable, how are players joined to current clubs, and what are the null rates for position, date of birth, minutes, and performance fields?
- What retrieval/update timestamp or refresh cadence applies to those player-season rows? Is there any freshness SLA?
- For the exact upstream sources returned, may this non-commercial local portfolio app store the minimum player/profile/stat rows in a local database? If yes, what retention period and deletion requirements apply?
- May the app pass those rows to a local Ollama model for private inference? May it generate and retain local embeddings and retrieve them in a private RAG index?
- May the app derive candidate comparisons/rankings and display player-level facts, evidence, and scouting reports in a public portfolio demo? Which attribution must appear, and do answers differ by upstream source or field?
- Does the key expose provenance/source and the applicable permission for every returned player-season row, so the application can fail closed when rights are missing?
- What quota and request limits would apply to a bounded smoke and a small local demo? Is the documented free allowance currently available to invited waitlist users?

## Scope after human response

If access and rights are confirmed, create a separate agent ticket for a no-model, in-memory smoke capped at 20 player-season rows in one documented current competition. Record only schema, aggregate field completeness, source/provenance classes, and timestamps. Do not persist player data, call Ollama, create embeddings, derive rankings, or publish player facts in that smoke.

Only after a separate review of written permission should a later task connect an approved source to the data warehouse, LangGraph tools, Reviewer, and report, then rerun the complete data-to-report Harness. A source smoke is not acceptance of the full Agent chain.

## Context

- [Source-expansion research](../research/current-player-source-expansion-2026-10-09.md)
- [Source finding](111-current-player-source-expansion-research.md)
- The project's chosen technical acceptance boundary is the complete data-warehouse-to-LangGraph-report conversation chain, tracked in [the Agent Harness suite](14-agent-harness-evaluation-suite.md).
