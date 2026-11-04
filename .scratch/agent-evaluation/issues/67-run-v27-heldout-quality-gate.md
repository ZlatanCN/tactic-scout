# 67 · Fix stale age and run a replacement held-out quality gate

**Status:** claimed

**Label:** ready-for-agent

## Goal

Run one independent, frozen held-out evaluation after repairing the stale-age defect. Avoid more live smoke runs that reveal static case-preparation defects.

## Frozen scope

- Use the independent replacement pack `evals/replacements/v28/cases` and matching local evidence in `.data/evals/v28-evidence`.
- Preserve the source boundary: the fixed FM snapshot supports CA, PA, natural positions, and attributes; Understat supports only the returned performance fields in its competition/season scope. Current registration, injuries, availability, transfer status, and other time-sensitive claims require a source covering that period.
- Compute age from the stable birth date as of the case's fixed `ageAsOfDate`; report that date separately from the FM snapshot date.
- Preview must show 16/16 cases ready and the same frozen fingerprint used by the run.
- Run 48 trials (three per case) with calibrated semantic judging, within the already approved 900 physical-request ceiling. Save the full report and stop on budget exhaustion.

## Acceptance

- Judge calibration passes all 32 anchors, including 16 validation anchors.
- All 48 trials complete and pass deterministic and semantic review; every case passes all three repetitions.
- Confirmed contradictions, unsupported facts, false execution claims, and required-fact omissions are zero.
- No inconclusive, invalid, errored, unfinished, or denied trials.
- If any held-out result drives an implementation or judge change, mark V28 exposed and prepare another independent pack.

## Progress

- V27 attempt `4c70f3d1-9067-474b-a1d7-bb8687dbd5d1` stopped after all three repetitions of `v27-recommend-berenguer-refine-age-ca` failed. It used 117/900 requests, with 32/48 trials started; no calibration or semantic scoring ran. V27 is exposed.
- The failure showed that age filters used the 2025-11-23 FM snapshot date even when the request asked for current age. `recommendPlayers` now calculates age from birth date as of a separate date and reports `ageAsOfDate`; the evaluation runner fixes this date per case.
- V28 is prepared with 16 cases, 12 real and 4 synthetic. Local preview reports 16/16 evidence bundles ready and estimates 834 requests. No V28 model requests have started.
- Run the full offline suite after the final V28 data-pack changes, then commit/freeze and run V28 once.
