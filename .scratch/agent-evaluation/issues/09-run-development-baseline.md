# 09: Measure and archive the development baseline

**What to build:** The maintainer receives an explicitly budgeted real-gateway smoke result and a reproducible development-set baseline, with honest scores and a prepared path to the later frozen held-out evaluation.

**Blocked by:** 08: Freeze and validate the complete scouting benchmark.

**Status:** open
**Labels:** ready-for-agent

- [x] Verify the completed benchmark, source preparation, model/source-processing configuration, evaluator offline checks, artifact destinations, and exact data/code/prompt/judge versions before any real-model execution.
- [x] Produce the actual preparation/request-count estimate and use an explicit numeric whole-run model allowance. Honor any separately recorded bounded source-capture allowance; do not choose an unlimited default or hide retries/calibration usage.
- [x] Run a small declared development smoke subset covering the four workflows and meaningful clarification behavior through the real gateway model, actual graph/readers/tools/algorithms, and frozen provider evidence.
- [x] Record smoke exposure and results as development work. Preserve failures and source/configuration problems; never consume held-out cases to debug the initial run.
- [x] Qualify the selected semantic judge against all 16 reserved validation anchors, matching verdicts and category labels. If validation is invalid/incomplete, preserve the artifacts/code results and state that semantic measurement is invalid rather than presenting trusted scores.
- [ ] Collect the formal 32-case development baseline with three fresh trials per case: 96 planned conversations. Retain every trial, budget/HTTP dispatch, judge/anchor request, state/evidence finding, and available usage/timing value.
- [ ] Produce local per-trial JSON and an inspectable Markdown baseline report with per-workflow completion, contradictions, unsupported additions, false execution claims, required-fact omissions, three-trial stability, each metric's denominator/coverage, and all inconclusive/error/unfinished work.
- [ ] Archive fixture/case/feature-map hashes, source identities/dates, code and dirty-working-tree identity, dependency and prompt versions, judge/rubric/anchor identities, model settings, actual available response metadata, and run timing.
- [ ] Preserve confirmed critical violations even if later work fails. Never turn missing adjudication, invalid calibration, zero evaluated cases, or a truncated run into a clean zero-error or passing result.
- [ ] Distinguish a fully accounted baseline from an allowance-exhausted or otherwise unfinished run. Retain partial output and its explicit incomplete status; do not claim the full development measurement completed until its planned work is accounted for.
- [ ] A poor agent score is a valid measured baseline, not an implementation failure to conceal. Do not alter gold, omit failed cases, rerun whole trials until they pass, or change application prompts/algorithms while calling the same run frozen.
- [ ] Present baseline evidence and the next threshold/freeze decision without inventing an aggregate accepted/not-accepted quality target. The later threshold choice and actual held-out run do not block this ticket's development-baseline delivery.
- [ ] Prepare and document the supported held-out operation over 16 cases with three trials each after explicit version/scoring freeze; record prior use if later results influence tuning. Do not run it prematurely or claim universal statistical/general scouting accuracy.
- [ ] Keep actual live work within the explicit allowances and local/private scope. Validate only new code changes when needed; the live baseline itself supplies quality evidence separately from deterministic Vitest correctness.

## Comments

- The full local inventory is ready: 48 cases, 32 development, 16 held-out, 32 real and 16 synthetic; all evidence hashes validate. The bounded team snapshot capture used four API-Football requests.
- The four-workflow live smoke subset (`lookup-saka-real-v1`, `compare-add-third-synthetic-v1`, `recommend-add-refine-synthetic-v1`, `team-real-madrid-refine-dev-v1`) previews at 99 total gateway requests with judge calibration enabled. The full 32-case development preview estimates up to 1,235 requests.
- Smoke run `58b834ab-ba06-4c04-acc9-1ea55e8f67d3` completed with a 120-request cap and used 45 requests (agent 13, calibration 32, judge 0; no denied requests). The team safe-stop case passed deterministic checks. Lookup exposed an FM `unique_id`/`record_id` collision (`28122643` was returned beside `28122642`); the reader and fixture preparation now prefer exact `unique_id` matches, and the offline real-source integration passes. The comparison case's unsupported competition constraint was removed from the development scenario. Recommendation constraint normalization now recognizes the extracted `maximum_age` alias; its later identity-data fault remains a declared scenario.
- Judge v1 calibration passed 16/16 development anchors and 15/16 validation anchors. `unsupported-fact-08-v1` was classified as `false_execution_claim` instead of also reporting the unsupported fact, so semantic scores are unqualified and the judge did not score the smoke answers. Anchor pack v2 adds overlapping-category guidance and retires that validation anchor; it has not yet been live-calibrated. The v1 smoke report remains local at `.data/evals/runs/58b834ab-ba06-4c04-acc9-1ea55e8f67d3/report.md`.
- Anchor pack v2 also replaces the development overlap example and records the retired validation anchor IDs and prior exposure in its calibration report. The corrected source reader and age-alias handling have offline regression coverage, but neither has been rerun against the live model yet.
- After these fixes, the selected four-case v2 smoke still previews at 99 requests and all four evidence bundles are ready. No second live run has been made; its request cap requires separate approval from the first smoke allowance.
- The 32-case formal development baseline remains pending. Any follow-up live smoke to qualify judge v2 and check the fixes requires a new explicit request cap; the prior 120-request allowance covered only run 58b834ab.
