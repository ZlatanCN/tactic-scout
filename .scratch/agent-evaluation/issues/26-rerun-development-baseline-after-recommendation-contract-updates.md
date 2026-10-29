# 26: Rerun the development baseline after recommendation contract updates

**What to build:** Run the current 32-case development split against the final recommendation prompts and gold contracts, with three isolated trials per case and calibrated v8 semantic scoring.

**Blocked by:** 25: Complete recommendation answers with user-relevant candidate facts.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Verify all 48 cases and evidence bundles remain valid; preview the current request estimate.
- [x] Run all 96 development trials and complete v8 calibration under the remaining authorized request cap.
- [x] Preserve earlier partial/full reports as separate runs; do not overwrite or cherry-pick trials.
- [x] Record deterministic and semantic outcomes, request counts, network errors, and calibration status.
- [x] Keep held-out cases untouched.

## Evidence

The recommendation case contracts changed after corrected baseline `dc3c8927-7426-490a-b99b-abd19231554c`, so its 96 trials are historical for the earlier facts. Revised attempt `88ba4282-7042-4d27-9c1a-d3646358e5bc` completed all 96 Agent trials and passed v8 calibration, but its report remained partial; it predates the final filter-stage, team-fit, team-refine, and CA-empty corrections.

The current preview estimates 1,235 requests. The user previously approved a 1,500-request total for this revised baseline family. Runs `36b4075a-0dcc-4c21-af4d-69479136d40a` (255 requests) and `88ba4282-7042-4d27-9c1a-d3646358e5bc` (394 requests) used 649 total, leaving a hard cap of 851 for this rerun. Stop and preserve a partial report if that remaining cap is reached. The held-out split remains untouched.

Final run `da5005c7-f445-4ea0-bfb0-b8095dec47c3` completed all 96 trials using 390/851 requests: 262 agent, 32 calibration, and 96 judge. V8 validation passed 16/16; there were no budget denials and five network failures. Outcomes were 85 passed trials and 11 failed trials; of the 96, 89 received semantic judgments (85 pass, four fail), seven were inconclusive, and none were invalid. The judge reported 14 required-fact omissions within inconclusive trials where required evidence was not delivered, two contradictions, one unsupported addition, and one false execution claim using the report's 89-trial adjudicated denominator. Twenty-five cases passed all three repetitions. All four workflows were included, and the held-out split remains untouched.

The report remains preserved at `.data/evals/runs/da5005c7-f445-4ea0-bfb0-b8095dec47c3/report.md`. It predates a final prompt clarification made after analysis: a team-refine trial had conflated filter stages. That correction is covered by graph-level prompt tests, typecheck, Ultracite, and the full offline suite, but has not had a new live smoke.
