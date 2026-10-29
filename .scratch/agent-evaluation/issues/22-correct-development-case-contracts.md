# 22: Correct development case contracts exposed by the baseline

**What to build:** Development evaluation contracts match the state channels and unambiguous user wording exercised by the graph.

**Blocked by:** None.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Express team CA/PA filters through `expectedTurnParameters` and `effectiveConditions`, not generic `request.constraints`.
- [x] Omit a target position from the youth request when the contract expects the graph to clarify between multiple natural positions.
- [x] Treat the accented and unaccented Mbappé lookup name forms as equivalent in the case expectation.
- [x] Validate the corrected 48-case benchmark and run the full offline suite.
- [x] Preserve the original post-fix report and record the corrected baseline as a separate run.

## Evidence

Post-fix development run `fe4f12b0-747c-46e9-90c0-854d2316c6c0` completed 96 trials with v8 validation 16/16. It exposed three deterministic contract mismatches: nine team-filter checks read a generic constraint channel instead of the observed filter condition; two youth trials expected a position clarification although the request said “前锋”; and three Mbappé trials compared accent-sensitive lookup-name strings.

## Resolution

Team filter expectations now use `expectedTurnParameters`; the youth case no longer specifies “前锋” while expecting a position interrupt; and identity lookup checks normalize accent-equivalent names while preserving Unicode letters. The real-source and team graph public-runner tests pass, as do the 48-case evidence inventory and full offline suite. Corrected baseline `dc3c8927-7426-490a-b99b-abd19231554c` completed separately from the original reports; issue 21 records its results. The youth case provenance string was corrected after this run to point to the actual earlier baseline ID; it is report metadata and was not sent to the agent or semantic judge. The report's case hash therefore records the pre-correction metadata, while the evaluated user turns, evidence, and expectations are unchanged.
