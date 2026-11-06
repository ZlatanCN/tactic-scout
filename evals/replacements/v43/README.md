# V43 held-out replacement pack

Status: passed frozen held-out quality gate.

Run `81a665f6-61e2-44b0-9ab1-1b46a84a781d` used commit `0234e8cb` and freeze fingerprint `scouting-eval-v1-75bab6be6e8778af6d8441be2624debaad21673d677f9edfc94320edee3e208a`. It completed 48/48 trials in 218 requests: 138 Agent, 32 judge calibration, and 48 semantic judge. Calibration passed 32/32, including validation 16/16. All 48 trials passed; all 16 cases passed each of their three repetitions. Required-fact omissions, contradictions, unsupported facts, and false execution claims were zero. There were no inconclusive, invalid, errored, unfinished, or denied trials. Three transient network failures were recovered.

The pack contains 16 held-out cases: 12 real-source and 4 synthetic team-roster cases, with four cases for each workflow. It includes explicit result-limit extraction, accent-tolerant lookup, saved-result reuse, cross-scope comparison, recommendation filters, and team roster refinement. The evaluation identities and provider source IDs are independent of V1–V42; recommendation rankings use an independent calculation from the fixed FM feature lists and Reep-linked exclusions.

Detailed JSON and Markdown reports remain local under `.data/evals/v43-heldout-runs/81a665f6-61e2-44b0-9ab1-1b46a84a781d/`.
