# 67 · Repair source identity expansion and pass a replacement quality gate

**Status:** claimed

**Label:** ready-for-agent

## Goal

Complete one independent, frozen held-out evaluation after repairing source-date semantics, linked-provider expansion, and recommendation result-list interpretation. Avoid additional live smoke runs.

## Frozen scope

- Use the independent pack `evals/replacements/v32/cases` and local evidence in `.data/evals/v32-evidence`.
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
- V31 is exposed. Its first attempt stopped after 5/48 trials and 20 requests on an accent-only scorer false negative for `Nikola Krstović` / `Nikola Krstovic`; all identity IDs matched. The scorer now ignores Unicode diacritics only and keeps exact selected IDs, canonical Reep IDs, source IDs, and resolution statuses.
- Identity mention comparisons now ignore Unicode diacritics only. Candidate IDs, canonical Reep IDs, provider source IDs, and resolution statuses remain exact. A regression test verifies both acceptance of the accent-only spelling and rejection of a different identity ID.
- V31's completed run `d7ee4ab1-9aa2-44c6-b630-0b5cad353d3b` used 246 requests, passed 45/48 trials, and passed judge calibration. It exposed three issues: the Samatta contract required unasked-for current CA; the team answer denied a ranking basis that existed in the top-level result; and one Moffi multi-turn trial produced an invalid judge contradiction with an unknown evidence ID.
- The team answer prompt and deterministic correction now explicitly map the top-level `rankingBasis` enum to the selected calculation method. Tests reproduce both the previous generic denial and the observed “these reference objects” wording. The deterministic correction prints the exact squad-position threshold and attribute-completeness rule.
- Evaluation preview now verifies each required Understat field value against the matching player in the fixed evidence bundle and rejects blank numeric values instead of coercing them to zero. Regression cases cover mismatched and blank golden xG; this caught and corrected V32 source-value typos before model dispatch.
- V32 is independent from V1–V31: 16 cases (12 real, 4 synthetic) with new case families, identities, source IDs, and synthetic team data. It limits Mert Kömür's required answer facts to the requested PA and appearances, and tests the CA-filter recommendation in one turn to avoid confusing the judge with a candidate shown before a later filter. Preview reports 16/16 bundles ready, 48 trials, and 816 estimated requests. The 900-request ceiling is already authorized; no V32 requests have started.
- Offline validation after the team-method correction and V32 authoring: 31 Vitest files / 305 tests passed with loopback enabled; typecheck and targeted Ultracite passed. The full repository-wide `pnpm check` still scans installed `.agents` skill assets and reports unrelated existing issues.
