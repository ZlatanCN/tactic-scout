# 10: Keep comparison dimensions out of hard filters

**What to build:** Ordinary requests to compare FM ability and season performance reach the comparison tool without the extractor inventing an unsupported constraint.

**Blocked by:** 09: Measure and archive the development baseline. This provides the reproducible failures and fixed evidence.

**Status:** resolved
**Labels:** ready-for-agent

- [x] In `compare-haaland-foden-real-v1`, `compare-saka-foden-real-v1`, and `compare-saka-haaland-real-v1`, treat “FM ability” as a requested comparison dimension, not a hard filter named `attribute`.
- [x] Preserve the explicit `2026/27` season and `EPL` scope from the user request.
- [x] Invoke `compare_player_records` with the identities and source IDs already resolved by the graph; return the expected FM ability and Understat facts.
- [x] Keep explicit unsupported hard constraints safely rejected. Do not loosen validation for actual filters the comparison workflow cannot honor.
- [x] Add fake-gateway regressions through the public evaluation entry for explicit competition scope and the three prepared real comparison cases.

## Evidence

In run `ab3547a4-8cb7-4566-a837-eff62941357b`, all nine trials across the three cases ended with `outcomeStatus: unsupported_constraints`. The effective request included `attribute = FM ability`; no comparison action ran, despite the user asking only to compare 2026/27 EPL performance and FM ability.

- The extractor prompt now distinguishes season/competition scopes from metrics such as FM ability and xG. The graph passes an explicit competition to the comparison tool, which filters Understat rows while keeping FM profiles separate.
- Public evaluation-entry tests cover La Liga versus EPL evidence, competition inheritance, and rejection of unsupported filters. Prepared real-source comparison cases pass their deterministic contracts with the fake gateway.
- The full Vitest, typecheck, Ultracite, and evidence-inventory checks passed after implementation. No live-model smoke was run for this fix.
