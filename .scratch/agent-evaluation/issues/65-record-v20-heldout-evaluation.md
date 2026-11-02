# 65 · Record the v20 held-out evaluation

**Blocked by:** 64

**Status:** resolved

## Run

- Run ID: `ce2e6728-6a2d-438b-9e20-32fb44a4880b`
- Evaluated revision: `840d530ceab9e3a064d92f0a6b7244d39f65ce64`
- Freeze fingerprint: `scouting-eval-v1-acca2d58751a0e3e6e1b89d5550fd64d6fcc459a3027cc29bfb6285c37de1eb7`
- Local report: `.data/evals/runs/ce2e6728-6a2d-438b-9e20-32fb44a4880b/report.md`
- Mode: 16 held-out cases × 3 trials; semantic judge enabled.
- Requests: 232/900 (155 agent, 32 calibration, 45 judge); no denied requests or network failures.
- Judge calibration: passed 32/32, including validation 16/16. Agent and judge both used `codex/gpt-6-luna`.

## Result

- The quality gate **did not pass**. All 48 trials ran; 37 passed and 11 failed. Eleven of 16 cases passed all three repetitions.
- Deterministic checks failed in seven trials: all three repetitions of `v20-compare-fuellkrug-budimir-no-common-scope`, all three repetitions of `v20-lookup-saved-season-followup`, and one `v20-team-ca-filter-refinement` trial.
- Semantic status: 38 passed, 6 failed, 1 inconclusive, and 3 not assessed. The three unassessed trials were the deterministic failures for `v20-compare-fuellkrug-budimir-no-common-scope`.
- Among 44 adjudicated trials, the judge reported two factual-contradiction trials (4.55%), one unsupported-fact trial (2.27%), and no false-execution claims. It reported 20 missing required facts across five trials.
- Confirmed answer issues included labeling a goals/minutes record as six appearances and saying the high-PA recommendation had no current-ability candidate when the fixed result included Ansu Fati.
- The report status is `partial` because semantic assessment did not complete for three trials. There were no runtime errors, unfinished trials, infrastructure errors, or budget denials.

## Exposure

The v20 pack has now been used for a formal held-out run and is exposed. Do not tune against these cases or reuse them as a blind held-out set. Any follow-up behavior changes must be evaluated on development data; before another held-out measurement, prepare and freeze a new independent split.
