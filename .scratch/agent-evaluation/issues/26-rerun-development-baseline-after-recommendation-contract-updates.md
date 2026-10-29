# 26: Rerun the development baseline after recommendation contract updates

**What to build:** Run a 32-case development baseline after the candidate-completeness and filter-stage contract changes, then run a bounded smoke for prompt corrections discovered by that baseline.

**Blocked by:** 25: Complete recommendation answers with user-relevant candidate facts.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Verify all 48 cases and evidence bundles remain valid; preview the current request estimate.
- [x] Run all 96 development trials and complete v8 calibration under the remaining authorized request cap.
- [x] Preserve earlier partial/full reports as separate runs; do not overwrite or cherry-pick trials.
- [x] Record deterministic and semantic outcomes, request counts, network errors, and calibration status.
- [x] Keep held-out cases untouched.

## Evidence

The recommendation case contracts changed after corrected baseline `dc3c8927-7426-490a-b99b-abd19231554c`, so its 96 trials are historical for the earlier facts. Revised attempt `88ba4282-7042-4d27-9c1a-d3646358e5bc` completed all 96 Agent trials and passed v8 calibration, but its report remained partial; it predates the filter-stage, team-fit, team-refine, and CA-empty corrections.

The current preview estimates 1,235 requests. The user previously approved a 1,500-request total for this revised baseline family. Runs `36b4075a-0dcc-4c21-af4d-69479136d40a` (255 requests) and `88ba4282-7042-4d27-9c1a-d3646358e5bc` (394 requests) used 649 total, leaving a hard cap of 851 for this rerun. Stop and preserve a partial report if that remaining cap is reached. The held-out split remains untouched.

Final baseline `1c235b12-2a69-475c-b254-0c5d34b070a5` completed all 96 trials using 403/461 requests: 275 agent, 32 calibration, and 96 judge. V8 validation passed 16/16; there were no budget denials and six network failures. The report records 88 passed trials, seven failed trials, and one invalid judge result. Semantic review covered 93 trials (89 pass, four fail), with two inconclusive and one invalid. It reports four required-fact omissions, one factual contradiction, three unsupported additions, and zero false execution claims on the 93-trial denominator; 25 cases passed all three repetitions. The four workflows were included, and held-out cases remain untouched.

The final baseline exposed two prompt-level grounding errors: a player recommendation answer described identity exclusions as including team roster players, and a team recommendation answer asserted an internal reference-profile construction method not present in its structured result. Both prompts were corrected. Calibrated targeted smoke `727fd8c1-7858-44f9-9310-9282838b4295` then passed both affected cases (player recommendation and team recommendation) with v8 validation 16/16, 40/58 requests, no semantic findings, no denied requests, and no network failures. This smoke was run after the full baseline and does not replace or overwrite it.

The baseline report remains at `.data/evals/runs/1c235b12-2a69-475c-b254-0c5d34b070a5/report.md`; the targeted report is `.data/evals/runs/727fd8c1-7858-44f9-9310-9282838b4295/report.md`. Combined with prior runs, the authorization used 1,482/1,500 requests, leaving 18 unused. The held-out split remains untouched.
