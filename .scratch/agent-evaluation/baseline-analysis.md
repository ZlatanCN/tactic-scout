# Development baseline failure analysis

**Source run:** `ab3547a4-8cb7-4566-a837-eff62941357b`

**Report:** `.data/evals/runs/ab3547a4-8cb7-4566-a837-eff62941357b/report.md`
**Scope:** 32 development cases, three trials each; held-out cases were not run.

## What the run established

- All 96 trials were attempted and recorded. The run used 358/1,326 requests: agent 233, calibration 32, judge 93. There were no denied requests and two network failures.
- Judge v5 calibration passed 16/16. Trial adjudication was partial: 44 pass, 33 fail, 9 inconclusive, 7 invalid, and 3 not assessed. The three not-assessed trials had no visible assistant response.
- Deterministic code contracts passed 69/96 trials; 27 failed. Nine of 32 cases passed all three repetitions.
- Among the 77 adjudicated trials, the report measured 3 factual contradictions, 13 unsupported factual additions, and 8 false execution claims. These categories use trial-level denominators and are not a universal scouting-quality score.

## Failure clusters

| Cluster | Evidence from this run | Disposition at baseline analysis |
|---|---|---|
| Comparison extraction adds a hard filter | All three real comparisons of Haaland/Foden, Saka/Foden, and Saka/Haaland failed in all three repetitions. The extractor produced `attribute = FM ability`; the comparison node returned `unsupported_constraints` before calling the comparison tool. | Implementation follow-up: issue 10 |
| Ambiguous FM profile fixture cannot resume | All three `recommend-ambiguous-profile-synthetic-v1` trials interrupted on `fm_profile`, while the case only scripted `recommendation_role` followed by `fm_profile`. The driver did not resume, so there was no assistant answer or recommendation action. | Case-contract follow-up: issue 11 |
| Seasonal team stated as current club | The Saka lookup passed deterministic checks but failed semantic review in all three trials: Understat listed Arsenal for the 2026/27 season, while the answer presented Arsenal as his current club despite the required abstention. | Implementation follow-up: issue 12 |
| Failure copy overstates prior-result retention | Several failed extraction/data paths said earlier results remained preserved even when the thread had no prior completed result. | Implementation follow-up: issue 13 |
| Judge citations are invalid or incomplete | Seven trial judgments omitted evidence references for contradictions; one quote was absent from the answer; one Real Madrid judgment cited operation IDs as evidence IDs. Nine more trials were inconclusive because required evidence was not delivered. | Implementation follow-up: issue 14 |
| Comparison resume contract has mixed failures | `compare-season-resume-add-synthetic-v1` failed all three trials. One trial completed all four tool calls but the golden active-player order reversed the user's stated order. Two trials stopped before any tool call with `identity_data_unavailable`. | Triage follow-up: issue 15 |
| Team roster coverage count needs reconciliation | The answer reported 30 mapped and 8 without profiles. Frozen capture metadata supports that count, while trial action logs and judge explanations report different resolved/no-profile totals. Long action traces also contributed invalid evidence references. | Triage follow-up: issue 16 |

## Recommended sequence

1. Issue 10 is implemented and its fake-gateway/integration tests pass. A post-fix live smoke (`84a220c3-6229-425c-b9db-7feface802fd`) verified the three real comparison cases with no invented attribute filter; the baseline failures remain as historical evidence.
2. Issue 11 is fixed as a benchmark-script mismatch; next address the prior-result failure wording and the Saka current-club abstention (issues 12–13).
3. Audit judge evidence/action references and reconcile team roster coverage before trusting full semantic rates (issues 14 and 16).
4. Address the comparison resume identity failures and correct its golden participant ordering (issue 15).
5. Run small affected-case smokes under explicit allowances. Keep the 16 held-out cases untouched until implementation and scoring are frozen.

The report remains `partial` because semantic review was incomplete for 19 trials (9 inconclusive, 7 invalid, 3 not assessed), even though all 96 trial executions and their outcomes are present.

## Corrected development baseline

**Source run:** `dc3c8927-7426-490a-b99b-abd19231554c`

**Report:** `.data/evals/runs/dc3c8927-7426-490a-b99b-abd19231554c/report.md`
**Scope:** 32 corrected development cases, three trials each; held-out cases were not run.

The run completed all 96 trials using 399 of the 871 remaining authorized requests: agent 271, calibration 32, judge 96. Calibration v8 passed 16/16; there were no budget denials. The local evaluation proxy recorded seven upstream fetch failures without an HTTP response. The report cannot attribute those transport failures to the gateway service.

- 82 trials passed, 13 failed, and one had an invalid judge output. The judge semantically adjudicated 93 trials: 84 passed and 9 failed; two were inconclusive and one invalid.
- Across 93 adjudicated trials, the judge found one factual contradiction (1.08%), no unsupported factual additions, and no false execution claims. It reported 22 required-fact omissions. These are separate dimensions: missing required facts indicate incomplete answers, not hallucinations.
- Deterministic contracts passed 92/96 trials. Twenty-four of the 32 cases passed all three repetitions.

## New failure clusters

| Cluster | Evidence from the corrected run | Disposition |
|---|---|---|
| Follow-up loses active lookup focus | In two trials, the graph successfully looked up Elias Demo, then answered “刚才查到的是什么赛季？” with “请告诉我你要查询哪位球员。” instead of reusing the active lookup result. A third repetition had a transport failure before the lookup completed. | Fixed in issue 23. The graph-level regression passes. Live smoke `db57e292-9379-4051-80b3-d68d0d7fdaa5` used the saved lookup result to answer `2024/25` with all deterministic checks passing; semantic judging was disabled. The first live attempt `0ddc1a1b-7593-4af6-b2e4-17d3aeebf4dd` failed before the initial search and remains separately preserved. |
| Comparison overstates shared data scope | One of three “add a third player” trials said all three shared one Understat competition, although one player's record was La Liga and the others' records were EPL. | Fixed in issue 24. Live smoke `09af647c-d887-4216-911f-0fd87696ca91` passed deterministic and semantic review with calibrated v8; the answer correctly limited EPL to two of three players. The historical full-baseline failure remains recorded. |
| Recommendation-answer completeness and gold-contract scope | The earlier run reported 22 missing facts: six lookup facts occurred in two trials with no delivered lookup result, ten were internal team-reference CA/PA values that need not be recited, and six were relevant returned-candidate facts. Later runs exposed an inaccurate CA-empty explanation, a missing team-fit caveat, team filter-count conflation, and unsupported explanations of identity exclusions and reference-profile construction. | Issue 25 now requires all returned candidate rows, accurate stage counts, and the team-fit boundary; gold contracts require only user-visible facts. Final development baseline `1c235b12-2a69-475c-b254-0c5d34b070a5` was followed by a calibrated two-case smoke `727fd8c1-7858-44f9-9310-9282838b4295` that passed the two corrected prompt cases. |
| Transport failures disrupt lookups | Seven proxy-forwarding attempts had no HTTP response. Two lookup trials consequently lacked tool results/evidence; other requests continued successfully. | Keep separate from agent quality and do not attribute to the gateway without HTTP/error evidence. |
| Judge completeness has one invalid case | One Mbappé trial failed required-fact-coverage validation; two other trials were inconclusive. A later run also had one invalid judgment citing evidence IDs not present in the trial input. | Keep both runs visible; review the anchor/case pairing before relying on case-level semantic scores. |

## Revised development baseline attempt

Run `88ba4282-7042-4d27-9c1a-d3646358e5bc` attempted all 96 revised development trials using 394/1,245 requests: agent 267, calibration 32, judge 95. V8 validation passed 16/16, with zero denied requests and two transport failures. It remains `partial`: 89 trials passed, six failed, and one judgment was invalid. The six failed trials comprise one deterministic scripted-clarification mismatch and five semantic failures; the invalid judgment separately cited evidence IDs not present in its input. This run predates the latest filter-stage prompt and team-refine contract fixes, so its results remain historical diagnostic evidence rather than the final revised baseline. The report is local at `.data/evals/runs/88ba4282-7042-4d27-9c1a-d3646358e5bc/report.md`; held-out cases remain untouched.

The development baseline is complete as a measurement, but not an acceptance result. Do not set thresholds or run the held-out split yet. The active-lookup and comparison-scope fixes have successful targeted live smokes. Recommendation completeness has offline prompt/contract fixes, the completed development run in issue 26, and a post-fix calibrated smoke for the final grounding corrections.

## Interim revised development baseline

**Source run:** `da5005c7-f445-4ea0-bfb0-b8095dec47c3`

**Report:** `.data/evals/runs/da5005c7-f445-4ea0-bfb0-b8095dec47c3/report.md`
**Scope:** 32 development cases, three isolated trials each. Held-out cases were not run.

All 96 trials completed using 390/851 authorized requests: agent 262, v8 calibration 32, and judge 96. V8 validation passed 16/16. There were five gateway-proxy network failures and no denied requests. The report classified 85 trials as passed and 11 as failed; semantic review covered 89 trials (85 pass, four fail, seven inconclusive, zero invalid), with no unfinished trials. Twenty-five of 32 cases passed all three repetitions. Required-fact omissions totaled 14. Among the 89 adjudicated trials, the report recorded two factual contradictions (2.25%), one unsupported factual addition (1.12%), and one false execution claim (1.12%). These are distinct trial-level measures, not a combined score.

| Workflow | Code contract passed | Semantic passed |
|---|---:|---:|
| Player comparison | 24/24 | 24/24 |
| Player lookup | 18/24 | 15/24 |
| Player recommendation | 23/24 | 23/24 |
| Team recommendation | 24/24 | 23/24 |

The recommendation answers included all candidate facts required by the updated contracts. One team-refine trial nevertheless contradicted the evidence by confusing `afterCurrentAbility` (five, then four after a CA refinement), `afterIdentityExclusion` (two after that refinement), and `currentAttributeComplete` (one rankable profile). The shared recommendation prompt was updated to define each counter and warn that ranked lists are additionally constrained by `resultLimit`; this interim run did not evaluate that wording.

Other semantic failures in this interim run were two unsupported/false-execution claims in the identity-clarification case and one season-availability contradiction in the Mbappé lookup. Keep those findings separate from errors introduced by later prompt edits.

## Final development baseline and post-fix smoke

**Baseline run:** `1c235b12-2a69-475c-b254-0c5d34b070a5`

**Report:** `.data/evals/runs/1c235b12-2a69-475c-b254-0c5d34b070a5/report.md`
**Scope:** 32 development cases, three isolated trials each. Held-out cases were not run.

All 96 trials completed using 403/461 requests: agent 275, v8 calibration 32, and judge 96. V8 validation passed 16/16. There were six network failures and no denied requests. Trial status was 88 passed, seven failed, and one judge-invalid. The judge adjudicated 93 trials (89 passed, four failed), marked two inconclusive and one invalid, and reported four required-fact omissions. Case-trial rates were one factual contradiction (1/93), three unsupported additions (3/93), and zero false-execution claims (0/93). Twenty-five cases passed all three repetitions.

| Workflow | Code contract passed | Semantic passed |
|---|---:|---:|
| Player comparison | 23/24 | 24/24 |
| Player lookup | 23/24 | 20/24 |
| Player recommendation | 23/24 | 22/24 |
| Team recommendation | 24/24 | 23/24 |

The report exposed an unsupported inference in a player recommendation: it described identity exclusion as including team-roster players. It also exposed a team recommendation claim about reference-profile selection criteria that the structured result did not state. The prompts now describe identity exclusion generically and forbid inferring reference-profile construction unless the tool result provides it.

**Post-fix smoke:** `727fd8c1-7858-44f9-9310-9282838b4295` targeted `recommend-add-haaland-kane-real-v1` and `team-rec-synthetic-v1`. Both passed code and semantic checks; v8 validation passed 16/16. The smoke used 40/58 requests, with zero network failures and zero denied requests. The smoke is separate from and does not replace the full development baseline.

The baseline plus smoke remain within the user-approved total request ceiling. Do not set aggregate quality thresholds or run the held-out split until the current agent, evaluator, evidence, prompts, and judge configuration are frozen. Other baseline findings in the lookup and judge paths remain separate follow-up work.
