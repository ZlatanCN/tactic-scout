# 09: Measure and archive the development baseline

**What to build:** The maintainer receives an explicitly budgeted real-gateway smoke result and a reproducible development-set baseline, with honest scores and a prepared path to the later frozen held-out evaluation.

**Blocked by:** 08: Freeze and validate the complete scouting benchmark.

**Status:** open
**Labels:** ready-for-agent

- [ ] Verify the completed benchmark, source preparation, model/source-processing configuration, evaluator offline checks, artifact destinations, and exact data/code/prompt/judge versions before any real-model execution.
- [ ] Produce the actual preparation/request-count estimate and use an explicit numeric whole-run model allowance. Honor any separately recorded bounded source-capture allowance; do not choose an unlimited default or hide retries/calibration usage.
- [ ] Run a small declared development smoke subset covering the four workflows and meaningful clarification behavior through the real gateway model, actual graph/readers/tools/algorithms, and frozen provider evidence.
- [ ] Record smoke exposure and results as development work. Preserve failures and source/configuration problems; never consume held-out cases to debug the initial run.
- [ ] Qualify the selected semantic judge against all 16 reserved validation anchors, matching verdicts and category labels. If validation is invalid/incomplete, preserve the artifacts/code results and state that semantic measurement is invalid rather than presenting trusted scores.
- [ ] Collect the formal 32-case development baseline with three fresh trials per case: 96 planned conversations. Retain every trial, budget/HTTP dispatch, judge/anchor request, state/evidence finding, and available usage/timing value.
- [ ] Produce local per-trial JSON and an inspectable Markdown baseline report with per-workflow completion, contradictions, unsupported additions, false execution claims, required-fact omissions, three-trial stability, each metric's denominator/coverage, and all inconclusive/error/unfinished work.
- [ ] Archive fixture/case/feature-map hashes, source identities/dates, code and dirty-working-tree identity, dependency and prompt versions, judge/rubric/anchor identities, model settings, actual available response metadata, and run timing.
- [ ] Preserve confirmed critical violations even if later work fails. Never turn missing adjudication, invalid calibration, zero evaluated cases, or a truncated run into a clean zero-error or passing result.
- [ ] Distinguish a fully accounted baseline from an allowance-exhausted or otherwise unfinished run. Retain partial output and its explicit incomplete status; do not claim the full development measurement completed until its planned work is accounted for.
- [ ] A poor agent score is a valid measured baseline, not an implementation failure to conceal. Do not alter gold, omit failed cases, rerun whole trials until they pass, or change application prompts/algorithms while calling the same run frozen.
- [ ] Present baseline evidence and the next threshold/freeze decision without inventing an aggregate accepted/not-accepted quality target. The later threshold choice and actual held-out run do not block this ticket's development-baseline delivery.
- [ ] Prepare and document the supported held-out operation over 16 cases with three trials each after explicit version/scoring freeze; record prior use if later results influence tuning. Do not run it prematurely or claim universal statistical/general scouting accuracy.
- [ ] Keep actual live work within the explicit allowances and local/private scope. Validate only new code changes when needed; the live baseline itself supplies quality evidence separately from deterministic Vitest correctness.
