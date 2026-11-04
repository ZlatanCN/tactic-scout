# 67 · Repair source identity expansion and pass a replacement quality gate

**Status:** claimed

**Label:** ready-for-agent

## Goal

Complete one independent, frozen held-out evaluation after repairing stale age semantics and source-linked Understat lookup. Avoid additional live smoke runs.

## Frozen scope

- Use the independent pack `evals/replacements/v29/cases` and local evidence in `.data/evals/v29-evidence`.
- FM supports fixed CA, PA, natural positions, and attributes. Understat supports only returned season-scoped performance. Current registration, injuries, availability, transfer status, and other time-sensitive claims require a source covering the requested period.
- Age is recalculated from birth date as of each case's fixed `ageAsOfDate`, separately from the FM snapshot date.
- A Reep canonical ID may connect provider source IDs even when display names differ. Names alone never establish identity.
- Preview must show all 16 evidence bundles ready and the exact fingerprint used by the run.
- Run 48 trials (three per case) with semantic judging, within the previously approved 900-request ceiling.

## Acceptance

- Judge calibration passes all 32 anchors, including 16 validation anchors.
- All 48 trials complete and pass deterministic and semantic review; all 16 cases pass all three repetitions.
- Contradictions, unsupported facts, false execution claims, and required-fact omissions are zero.
- No inconclusive, invalid, errored, unfinished, or denied trials.
- If a V29 finding changes the implementation or judge, mark V29 exposed and prepare another independent pack.

## Progress

- V27 stopped after 32/48 trials and 117 requests with the stale FM-snapshot age failure. No judge calibration or semantic scoring ran; V27 is exposed.
- V28 stopped after its first trial and 5 requests. FM name “Alejandro Grimaldo” resolved only to FM ID `67153376`; the linked Understat ID `11866` was omitted because its display name is “Álex Grimaldo”. The local Reep registry contains both IDs under one canonical identity. No calibration or semantic scoring ran; V28 is exposed.
- Identity resolution now expands only source IDs explicitly linked to a resolved Reep identity, and reads the linked provider record. Regression tests cover display-name mismatch in both lookup directions.
- V29 is prepared with 16 cases (12 real and 4 synthetic). Its pack test confirms independence from V1–V28 and includes an Understat display-name mismatch case. Preview reports 16/16 evidence ready and estimates 834 requests. No V29 model requests have started.
- Latest full offline validation: 28 test files / 280 Vitest tests passed; typecheck and targeted Ultracite checks passed. V29 is ready for the single frozen gate.
