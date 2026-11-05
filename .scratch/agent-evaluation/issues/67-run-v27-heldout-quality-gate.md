# 67 · Repair source identity expansion and pass a replacement quality gate

**Status:** claimed

**Label:** ready-for-agent

## Goal

Complete one independent, frozen held-out evaluation after repairing source-date semantics, linked-provider expansion, and recommendation result-list interpretation. Avoid additional live smoke runs.

## Frozen scope

- Use the independent pack `evals/replacements/v31/cases` and local evidence in `.data/evals/v31-evidence`.
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
- If a V30 finding changes the implementation or judge, mark V30 exposed and prepare another independent pack.

## Progress

- V27 stopped after 32/48 trials and 117 requests with the stale FM-snapshot age failure. No judge calibration or semantic scoring ran; V27 is exposed.
- V28 stopped after its first trial and 5 requests. FM name “Alejandro Grimaldo” resolved only to FM ID `67153376`; the linked Understat ID `11866` was omitted because its display name is “Álex Grimaldo”. The local Reep registry contains both IDs under one canonical identity. No calibration or semantic scoring ran; V28 is exposed.
- Identity resolution now expands only source IDs explicitly linked to a resolved Reep identity, and reads the linked provider record. Regression tests cover display-name mismatch in both lookup directions.
- V29 stopped after its first trial and 4 requests. The repaired identity flow found all three EPL records, while the golden contract expected only two; V29 is exposed.
- V30 is exposed. Its run `757ba2b1-6bf4-4308-bf0b-c82941eeb42f` stopped after 37/48 trials and 126 requests, before calibration or semantic scoring. It found two golden-contract errors: the ambiguous “Josh King” case expected auto-resolution, and the high-potential case expected `resultLimit: 1` although its wording produced `2`.
- V31 replaces those cases and is independent from V1–V30. Its fixed-source pack has 16 cases (12 real, 4 synthetic), including the linked-provider display-name mismatch and an assertion that every resolved provider ID reaches the corresponding tool action. Preview reports 16/16 evidence ready, 48 trials, and 834 estimated requests. The 900-request ceiling is already authorized; no V31 model requests have started.
- Offline validation: 30 Vitest files / 292 tests passed with loopback enabled; typecheck passed; targeted Ultracite checks passed. The full repository-wide `pnpm check` also scanned installed `.agents` skill assets and reported unrelated existing issues there, so this task uses targeted checks for the touched source and eval files.
