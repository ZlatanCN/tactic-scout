# 54 · Calibrate v18 judge grounding

**What to build:** Validate the semantic judge grounding changes against the five v16 failure cases.

**Blocked by:** None.

**Status:** resolved

## Evidence

V16 baseline `4d1e807b-d119-40bf-953f-68608b6347d3` had a comparison trial whose required CA/xG values appeared in the answer tables but were marked missing. A team-recommendation judgment labeled stage counts contradictory while its own explanation stated the returned counts did not conflict. A lookup judgment also treated statements about returned records and omitted filters as unsupported.

## Acceptance

- Required facts include linked player names and user-facing field labels; the prompt explicitly counts equivalent values in Markdown tables.
- A contradiction explanation that says the answer agrees with evidence is rejected as an invalid judgment.
- Tool-input omissions and returned-record scope are judged using complete action inputs and current tool semantics.
- Invalid or transport-failed judgments remain separate from pass/fail semantic verdicts.
- A real-model smoke passes judge calibration and all five focused cases; keep held-out Agent cases untouched.

## Result

V17 adds player names and display labels to required-fact descriptions, explicit rules for Markdown tables, the actual search-tool filter surface, season-scoped team data, and numeric attribute comparisons. Per-turn node failures are passed to the judge as only `{node, category}` and appear in local reports. V18 clarifies that squad references are excluded from recommendation candidates while remaining available as comparison references; it also marks conditional or self-negating contradiction rationales as invalid.

V17 smoke `49801d11-82b8-4f03-b8ee-41556fbe5b96` ran five cases with 66/180 requests: Agent 29, calibration 32, and judge 5. Calibration passed 32/32, including validation 16/16. The comparison, both lookup, and player-recommendation cases passed; the team case exposed a false contradiction about excluded candidates listed as squad references.

V18 team-only smoke `05427dfa-9a24-4e10-a379-baefd4d1cc15` used 38/114 requests: Agent 5, calibration 32, and judge 1. Calibration passed 32/32, including validation 16/16. The team case passed deterministic and semantic review. Across the two runs, the five targeted cases all passed at least once, and the team case passed after the final v18 correction. Combined usage was 104/180 requests, with zero network failures and budget denials. Held-out Agent cases were untouched.

Offline regressions cover self-negating contradictions, structured required-fact labels, per-turn failure evidence, age-filter recovery, and valid lookup continuation. Typecheck, build, changed-file Ultracite, and the full Vitest suite passed.

The remaining measurement is the full v18 development baseline, tracked by issue 57; it needs a separate whole-run request allowance.
