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
- If agent behavior is tuned using held-out output, expose the pack and prepare another independent pack. Any scorer correction must be explicit, tested against known-identity examples, committed, and evaluated from a new frozen fingerprint.

## Progress

- V27 stopped after 32/48 trials and 117 requests with the stale FM-snapshot age failure. No judge calibration or semantic scoring ran; V27 is exposed.
- V28 stopped after its first trial and 5 requests. FM name “Alejandro Grimaldo” resolved only to FM ID `67153376`; the linked Understat ID `11866` was omitted because its display name is “Álex Grimaldo”. The local Reep registry contains both IDs under one canonical identity. No calibration or semantic scoring ran; V28 is exposed.
- Identity resolution now expands only source IDs explicitly linked to a resolved Reep identity, and reads the linked provider record. Regression tests cover display-name mismatch in both lookup directions.
- V29 stopped after its first trial and 4 requests. The repaired identity flow found all three EPL records, while the golden contract expected only two; V29 is exposed.
- V30 is exposed. Its run `757ba2b1-6bf4-4308-bf0b-c82941eeb42f` stopped after 37/48 trials and 126 requests, before calibration or semantic scoring. It found two golden-contract errors: the ambiguous “Josh King” case expected auto-resolution, and the high-potential case expected `resultLimit: 1` although its wording produced `2`.
- V31 is independent from V1–V30. Its fixed-source pack has 16 cases (12 real, 4 synthetic), including the linked-provider display-name mismatch and an assertion that every resolved provider ID reaches the corresponding tool action. Its first attempt was stopped after 5/48 trials and 20 requests, before calibration or semantic judging. The three failed repetitions were scorer false negatives for the accent-only variation `Nikola Krstović` / `Nikola Krstovic`; all expected identity and provider IDs matched. No agent prompt or workflow behavior was tuned from V31 output.
- Identity mention comparisons now ignore Unicode diacritics only. Candidate IDs, canonical Reep IDs, provider source IDs, and resolution statuses remain exact. A regression test verifies both acceptance of the accent-only spelling and rejection of a different identity ID.
- V31 evidence still previews 16/16 ready with 48 trials and 834 estimated requests. The corrected evaluator must use a new freeze fingerprint and rerun all trials from the start within the already authorized 900-request ceiling. No requests have been made with the corrected scorer yet.
- Offline validation after the scoring correction: 30 Vitest files / 294 tests passed with loopback enabled; typecheck passed; targeted Ultracite checks passed. The accent regression test went red before the scorer change and passes afterward. The full repository-wide `pnpm check` also scans installed `.agents` skill assets and reports unrelated existing issues there.
