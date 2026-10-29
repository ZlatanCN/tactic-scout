# 27: Ground player lookups in the requested scope and identity result

**What to build:** Make explicitly formatted four-digit-start-year Understat season ranges (`YYYY/YY`, `YYYY/YYYY`, `YYYY-YY`, or `YYYY-YYYY`) reach lookup deterministically, prevent answers from inventing provider IDs or overstating an identity lookup failure, and expose identity lookup outcomes to semantic evaluation. Do not infer a century from a two-digit shorthand or treat a year-only mention as a season range.

**Blocked by:** None.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Preserve a user-requested four-digit-start-year season range for `player_lookup` and pass its start year to `search_player_records`, even when the model omits or changes the tool argument.
- [x] When the user omits a supported season range or uses an ambiguous shorthand/year-only mention, discard any model- or extractor-inferred `seasonStartYear` and ask for an explicit range rather than presenting latest-snapshot data as the requested season.
- [x] Include the requested Understat season in the returned search result; on a completed `found`/`not_found` result, `null` means the tool used the latest snapshot, an absent field means Understat was not requested, and `unavailable` means no season result was obtained.
- [x] Instruct lookup answers to use provider IDs only when they appear in the returned data; do not quote an ID from model memory.
- [x] Keep `identity_data_unavailable` explanations scoped to the current player mention instead of claiming the entire local identity store is unreadable.
- [x] Supply the per-turn identity lookup outcome to semantic judging so a local `data_unavailable` result is not treated as unsupported merely because no player search ran.
- [x] Add regression coverage at the existing graph and evaluation-runner test seams.
- [x] Run the full offline suite, typecheck, and lint; do not spend another real-model request without a new allowance.

## Evidence

Development baseline `1c235b12-2a69-475c-b254-0c5d34b070a5` found a repeated lookup-answer issue. In the Mbappé case, the identity resolver selected Understat ID `3423`, but one answer named `2370`; the actual search input in that trial omitted `seasonStartYear`, even though the user asked for 2024/25. Another repetition passed `seasonStartYear: 2024`, showing that the lookup scope was not deterministic.

The same baseline's identity-failure case received a genuine per-mention `data_unavailable` result after the Reep bridge fault. The fixed answer generalized this to “local identity data cannot be read.” The semantic judge did not receive the identity lookup events, so it could not distinguish a local identity failure from an unsupported global claim.

The primary implementation/test seam remained the existing public graph/evaluation-runner boundary with fixed local evidence and a fake gateway. The graph regression forces the model to request the wrong source ID and 2025 while the user explicitly asks for 2024/25; the executed search receives the resolved IDs and 2024. A second regression makes both the extractor and tool-call model invent a year when the user gave none; the search receives no year and uses the latest snapshot. The result records `requestedUnderstatSeasonStartYear=2024` for explicit queries. The lookup prompt forbids inventing IDs in prose. Identity-failure responses now identify only the unresolved mention, and evaluation judge input includes the per-turn `resolve_player_identity` result.

Validation: all 141 Vitest tests pass; typecheck, Ultracite, and 48-case/evidence validation pass. Graph regressions cover explicit four-digit seasons, model/extractor-inferred years when omitted, and identity failure copy. A local fake-gateway integration test verifies identity-resolution evidence reaches the judge. No real model request was made: only 18 requests remain in the previously approved allowance, below the 32-call v9 judge calibration cost. The v9 prompt therefore requires live calibration under a new allowance before semantic scores are used.
