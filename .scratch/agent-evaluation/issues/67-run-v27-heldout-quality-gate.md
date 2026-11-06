# 67 · Repair source identity expansion and pass a replacement quality gate

**Status:** claimed

**Label:** ready-for-agent

## Goal

Complete one independent, frozen held-out evaluation after repairing source-date semantics, linked-provider expansion, and recommendation result-list interpretation. Avoid additional live smoke runs.

## Frozen scope

- Use the next independent pack `evals/replacements/v40/cases` and local evidence in `.data/evals/v40-evidence`. V33–V39 are exposed and must not be reused.
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
- V32 run `d98eeaa0-bab4-4fbd-9a92-5b7e28d03094` completed 48 Agent trials, passed all 32 calibration anchors, and used 232 requests. It passed 47/48 trials; its one failure omitted the reference player's CA and PA even though the result contained them. The answer node now deterministically restores missing reference details. V32 is exposed.
- V33 was run as `090c0264-3023-466e-944e-9d7780e7cb08`: 218 requests, 35 passed, 3 failed, 10 not assessed. All three failures came from the add-reference case's incorrect candidate-list contract. The pack was corrected afterward and is exposed; it is not an acceptance result.
- V34 is independent from V1–V33: 16 cases (12 real, 4 synthetic), with new case families, names, canonical identities, source IDs, and synthetic team data. It covers lookup and saved-result reuse, same-scope/cross-scope comparison and participant addition, position/age/CA recommendations, adding a second reference, and team-roster refinement. Exact Understat evidence preflight passes; preview reports 16/16 bundles ready, 48 trials, and 816 estimated requests. The existing 900-request ceiling is authorized; no V34 model requests have started.
- V34 run `7d7c2273-7fd3-43bf-aac9-6e86076d8df4` completed 48/48 trials in 225 requests. Calibration passed 32/32 (including validation 16/16); 44/48 trials passed. Three failures were false identity-continuity failures because a pronoun was recorded as unresolved despite correct saved-result reuse. One semantic judgment missed Eric Martel CA/PA 140/150 displayed in the answer table. Two transient network failures were recovered; no requests were denied. V34 is exposed.
- The judge now decodes text blocks before semantic judgment and visible-table evidence checks. A regression reproduces the serialized-content format from the failed V34 trial. V35 uses a neutral saved-result follow-up wording to test result reuse without introducing an unresolved pronoun as a separate identity-resolution requirement.
- V35 is prepared as a new independent 16-case pack with 12 real-source and 4 synthetic cases. Preview reports 16/16 evidence bundles ready, 48 trials, and 798 estimated requests. The 900-request ceiling is authorized. No V35 requests have started.
- V35 partial run `23c127d1-645b-4cd8-bef9-7bf1007c9746` used 72 requests and recorded 24 trials: 2 failed and 22 unfinished. Both failures were the same identity-resolution failure: the model returned “Janik Haberer's” including a possessive suffix, which did not match the canonical name. No judge/calibration ran, and there were no network failures or budget denials. V35 is exposed.
- The request normalizer now strips terminal English possessive suffixes from extracted mentions and lookup-name overrides. Vitest covers both straight and curly apostrophes. V36 must use fresh identities and include a possessive-name query to verify the fix end to end.
- V36 run `b39c7477-6e47-432a-8953-c93e805c4039` completed in 222 requests; judge calibration passed 32/32, but 45/48 trials passed. Three semantic failures exposed cross-turn fact coverage gaps and a wrong team-roster retrieval date. V36 is exposed.
- The evaluator now verifies visible fact values against delivered source values for the exact provider/source, resolves candidate names through returned tool results, and recognizes labeled prose as well as tables across turns. Team recommendations correct roster dates from `retrievedAt` and correct reference-profile counts from the tool's returned reference list.
- V37 run `4e55b236-4cfc-4477-9d01-51d0961da245` completed in 215 requests, passed calibration 32/32 and 47/48 trials. One failure caught a false team-reference count. The deterministic correction was changed during the run, so V37 did not use a single frozen revision and is exposed.
- V38 was stopped after 16/48 trials and 44 model requests because its saved-result follow-up accidentally contained “his”; the case contract expected pronoun-free reuse. One trial failed identity checks and the other 15 were unassessed. Calibration did not start; there were no network failures or budget denials. V38 is exposed.
- V39 was stopped after 12/48 trials and 30 Agent requests because the EPL comparison case retained a Bundesliga expected condition from its template. Three trials failed that contract; nine trials were unassessed. Judge calibration did not start, and there were no network failures or denials. V39 is exposed.
- V40 uses new identities/source IDs compared with V1–V39, a neutral saved-result follow-up, an accent-insensitive lookup spelling, explicitly checked league constraints, and independently calculated recommendation order. Preview reports 16/16 evidence bundles ready, 48 trials, and 753 estimated requests. The 900-request ceiling is authorized; no V40 model request has started.
- Offline validation after the reference-detail correction: 37 Vitest files / 360 tests passed; typecheck and targeted Ultracite passed. The full repository-wide `pnpm check` still scans installed `.agents` skill assets and reports unrelated existing issues.
