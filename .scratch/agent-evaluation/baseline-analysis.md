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
