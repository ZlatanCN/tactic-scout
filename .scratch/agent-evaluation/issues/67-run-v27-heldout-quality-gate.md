# 67 · Freeze and run the V27 held-out quality gate

**Status:** claimed

**Label:** ready-for-agent

## Goal

Run one independent, frozen held-out evaluation after the accumulated evaluator and agent repairs. Avoid more live smoke runs that reveal the same static case-preparation defects.

## Frozen scope

- Use only `evals/replacements/v27/cases` and the matching local evidence in `.data/evals/v27-evidence`.
- Preserve the source boundary: the fixed FM snapshot supports CA, PA, natural positions, and attributes; Understat supports only the returned performance fields in its competition/season scope. Current registration, injuries, availability, transfer status, and other time-sensitive claims require a source covering that period.
- Preview must show 16/16 cases ready and the same frozen fingerprint used by the run.
- Run 48 trials (three per case) with calibrated semantic judging, within the already approved 900 physical-request ceiling. Save the full report and stop on budget exhaustion.

## Acceptance

- Judge calibration passes all 32 anchors, including 16 validation anchors.
- All 48 trials complete and pass deterministic and semantic review; every case passes all three repetitions.
- Confirmed contradictions, unsupported facts, false execution claims, and required-fact omissions are zero.
- No inconclusive, invalid, errored, unfinished, or denied trials.
- If any held-out result drives an implementation or judge change, mark V27 exposed and do not reuse it as a blind gate.

## Progress

- Local preview: 16/16 evidence bundles ready, 48 trials, estimated 834 requests. No live model requests have been started for V27.
- Offline validation: 270 Vitest tests, typecheck, and targeted Ultracite checks passed.
