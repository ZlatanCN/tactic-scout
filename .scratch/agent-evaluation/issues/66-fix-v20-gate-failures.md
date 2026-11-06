# 66 · Fix the exposed v20 failure patterns and re-establish the gate

**Blocked by:** 65

**Status:** resolved

**Label:** ready-for-human

## Goal

Use the v20 report as diagnostic input and the development set as the repair set. The v20 split is exposed and cannot be the acceptance gate after tuning. Prepare a new independent v21 held-out pack after the behavior and evaluation contracts stabilize.

## Failure clusters

- Understat `games` was discarded; answers fabricated appearance counts from goals or minutes and sometimes omitted the available metrics.
- A collective `their` in a comparison sentence became a third player mention and failed identity resolution.
- A team CA-filter follow-up could fail structured-output parsing even though the numeric refinement was explicit.
- A recommendation answer could say a nonempty `currentCandidates` list was empty.
- The v20 saved-season case expected identity status `resolved` after the graph correctly reused the saved result; its required answer evidence also included FM values the user did not ask for.

## Acceptance

- Keep fast regression tests at the Understat result, request-normalization, request-extraction, and answer-output seams.
- Run the real `createAgent` diagnostic cases on fixed development/synthetic data; record requests, calibration, and failures.
- Re-run the full development set and fix confirmed code or case-contract defects there.
- Build a replacement held-out pack with new case families, names, source IDs, and evidence groups; do not use v20 as a pass/fail gate.
- Run the complete replacement gate after freezing the source revision, data, model, judge, and rubric. All planned trials must pass, semantic calibration must pass, and all critical hallucination/omission/execution metrics must be zero.

## Progress

- Understat mapping now preserves raw `games` as `appearances` and returns explicit `null` when absent; the lookup prompt forbids deriving appearances from goals or minutes and asks for relevant available metrics. The first adapter regression test went red before the code change.
- A minimal one-turn diagnostic with only minutes, no `games`, and no FM profile reproduced an unsupported appearance claim in one of three trials before the prompt/data-contract change; the original and two reduced diagnostic variants passed 9/9 after it.
- Request normalization now drops a collective plural pronoun when two explicit players are already present. The exact `their respective` regression test went red before the change, and a full-graph synthetic comparison passed 3/3 afterward.
- Explicit CA minimum refinements on a saved team result now use a deterministic text path. A fake invalid model response previously made the request-understanding test fail; the new regression passes without invoking the model.
- Recommendation output checks structured candidate arrays and replaces a false empty-list claim with a deterministic list derived from the tool result. A full StateGraph answer-node regression went red before the guard.
- Full development repair remains open. The latest run 9 agent phase completed 96 trials, but gateway 429 `Codex: The usage limit has been reached` caused 27 code trials to fail before their planned interaction could complete; judge calibration stopped on its first anchor for the same quota response. Do not treat this report as an acceptance run.
- Run 9 also exposed duplicate identical search tool calls in one model response. The executor now calls the provider once and returns the same result for each duplicate call ID; the existing three-call guard still counts proposed calls. A regression test covers this.
- Other confirmed repair work includes: treating literal `null`/`undefined` lookup-name placeholders as absent, grounding team recommendation reference-method wording in `rankingBasis`, correcting false missing-birth-date statements from FM records, parsing numeric values under Markdown column headers, validating citations to evidence visible in earlier turns, and using the documented missing-distance count when judging recommendation explanations.
- Model Graph nodes now allow the full three-request budget (plus retry waits) to complete; each individual model request remains capped at 59 seconds. A repeat evaluation is needed to verify timeout recovery.
- Run 9 was interrupted by the gateway's temporary usage limit. A later single-case smoke succeeded in 3 model requests, so run 10 proceeded.
- Run 10 completed all 96 Agent trials with zero denied requests and passed judge calibration 32/32. Semantic scoring found 95/96 passing; the remaining team refinement case contained two judge false positives. The action input lists the two mapped roster FM IDs, the result lists different candidate IDs, and its explicit `rankingBasis` names the equal-weight squad method.
- Deterministic answer correction now uses `rankingBasis` to replace claims that the method was omitted, including text-block model output. Judge validation now checks mapped roster IDs against both candidate lists before accepting an exclusion contradiction. Regression tests cover matching and counterexample results.
- Identical search calls in one model response now share one provider execution, while the turn limit still counts every proposed call. This fixes the duplicated search observed in run 9.
- Run 12 completed the 32-case development split: 96/96 trials passed; 32/32 judge anchors passed (16/16 validation); semantic coverage was 96/96, with zero contradictions, unsupported facts, false execution claims, or required-fact omissions. It used 411 requests (283 Agent, 32 calibration, 96 judge); three transient network errors were recorded and recovered, with no quota denials. The working tree was dirty, so this is a passed development baseline, not the frozen held-out gate.
- Offline verification passes: 21 test files / 242 tests, TypeScript typecheck, and Ultracite over all changed TypeScript. The remaining acceptance work is code review, commit/freeze, and the independent v22 held-out run.
- V22 was then used as a held-out attempt and is exposed. Run `060b307e-a485-40dc-a438-fe31fb785024` completed 48 trials: 23 passed, 25 failed code contracts, and the semantic judge found one unsupported fact. Calibration passed 32/32. The failures included stale case-to-provider identity expectations and an answer calling FM natural positions current positions; neither this run nor v22 is an acceptance gate.
- Fixed the confirmed player-reference bug where a singular pronoun in the same message as an explicit player name was treated as another player, and corrected comparison output that labeled FM natural positions as current positions. Added direct regressions for both behaviors.
- Authored an independent v23 held-out pack with 16 cases (4 per workflow), new player/source IDs and synthetic team evidence. Real evidence is prepared locally; preview reports all 16 cases ready and estimates 834 requests. Local recommendation calculations match the candidate IDs recorded in the v23 contracts.
- Full offline suite passes: 22 test files / 248 tests, typecheck, and Ultracite. Run `615ed820-7097-465a-b35d-6ef74c71d5f5` completed the 32-case development split: all 96/96 trials passed code and semantic checks; calibration passed 32/32 including validation 16/16. Required-fact omissions, factual contradictions, unsupported facts, and false execution claims were zero. It used 402 requests (269 Agent, 32 calibration, 101 judge), recorded two recovered transient network failures, and had no denied requests. Its working tree was dirty; commit the frozen files and run the independent v23 held-out gate before resolving this ticket.
- V23 confirmed the competition input and saved-result case contracts were wrong, and a newly added recommendation reference was sorted ahead of the existing reference by canonical ID. The partial v23 run was stopped at 34/48 trials and 119 requests after those failure modes were reproduced. V23 is exposed and cannot be reused as an acceptance gate.
- Fixed recommendation reference ordering by preserving state insertion order, and added a graph-level regression that adds a second reference whose canonical ID sorts before the existing reference. Updated two existing development case contracts to assert that order. The graph regression passes.
- Authored a new v24 replacement pack with new real player records and synthetic team IDs. Its comparison contracts use the observed `La Liga` input while keeping `La_liga` in source evidence metadata; saved-result contracts expect `resolved` on turn one and `saved_result_reuse` on turn two. Preview reports all 16 cases ready and estimates 834 requests.
- Post-fix offline verification passes: 23 test files / 253 tests, TypeScript typecheck, Ultracite, and `git diff --check`. The last full real-model development baseline was run 13 immediately before the small recommendation-order fix; the post-fix graph regression and full offline suite pass.
- The v24 held-out attempt was stopped at 27/48 trials and 97 requests after one trial failed on “What xA did Understat report?”: request extraction treated the provider name as a player and the saved-result matcher still consumed the unsanitized mention. V24 is exposed and cannot be reused.
- Fixed saved lookup matching to normalize and filter player mentions before comparing against the active lookup. Request normalization now discards known data-source names, and saved lookup follow-up detection includes stat-field questions. Added a direct extraction regression and a full-graph regression proving the xA follow-up reuses the saved result without another search.
- Authored v25 with new real identities/source IDs and a new synthetic roster fixture. The exact provider-name follow-up is included. Preview reports all 16 cases ready and estimates 834 requests; local recommendation output IDs match the fixture contracts.
- V25 was stopped at 17/48 trials after 55 requests: two Understat rows in case contracts had the wrong competition in their source scope. V25 is exposed. A new preview preflight now rejects required Understat evidence unless the exact player ID exists in the declared competition and season; a Vitest regression covers the failure.
- Lookup guidance assigns season-scoped performance statistics to Understat and fixed CA/PA/positions/attributes to the FM snapshot. The user clarified that FM must never support strongly time-sensitive claims; the prompt and `CONTEXT.md` now require a source that covers the requested time period, and otherwise abstention. Regression assertions enforce the prompt boundary and the new pack checks performance evidence provenance.
- V25–V29 are exposed and cannot be acceptance gates. V27 identified that recommendation age was tied to the FM snapshot date; V28 identified that Reep-linked Understat IDs were omitted when display names differed; V29 exposed an outdated comparison contract after that link was restored.
- Recommendation age is now computed from birth date as of a fixed per-case date, separate from the FM attribute snapshot. V30 is prepared with 16 independent cases, 12 real and 4 synthetic; preview shows 16/16 evidence ready and estimates 834 requests.
- Final offline validation after the identity-expansion repair: 28 test files / 280 tests passed, typecheck passed, and Ultracite passed on all changed TypeScript and JSON files.
- V30 is exposed after a partial held-out run found two case-contract errors. Issue 67 now tracks the final attempt using independent V31 cases; V31 has 16/16 evidence bundles ready and an 834-request estimate under the previously approved 900-request ceiling. Do not reuse V30 or tune against V31 after the frozen gate starts.


## Completion

The independent frozen held-out objective was completed by V43, not by reusing v20. V43 passed all 48 trials, judge calibration 32/32, and all critical hallucination and omission metrics were zero. See [issue 67](67-run-v27-heldout-quality-gate.md) and [the V43 report summary](../../evals/replacements/v43/README.md).
