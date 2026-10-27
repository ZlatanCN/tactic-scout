# 07: Run repeated evaluations with comparable reports

**What to build:** The maintainer can run selected scripted cases repeatedly under one allowance and compare honest local reports showing quality, stability, adjudication coverage, and runtime usage.

**Blocked by:** 02: Evaluate lookup conversations and execution evidence; 06: Calibrate a semantic judge and score scouting claims.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Deliver a demoable multi-case evaluation through the public entry: formal mode runs three state-isolated trials per case, and an explicit development/debug mode may run once.
- [x] Use the shared conversation/resume driver and calibrated scoring contract. Keep processes, environment, MemorySaver/thread, and provider caches independent across trials while preserving state within each scripted conversation.
- [x] Keep all repetitions and failures with stable case/trial identities. Do not automatically rerun an entire failed trial, select the best run, overwrite previous failures, or describe repetitions as independently sampled new questions.
- [x] Enforce one role-aware physical HTTP allowance across all trial processes, agent calls, judge scoring, reserved-anchor validation, retries, and repairs. Stop before request N+1 reaches the fake/real gateway when the limit is N; local retry allowances cannot bypass the global limit.
- [x] Preview selected cases/splits, repetitions, calibration work, preparation status, and estimated request bounds. Require explicit real-run allowances and record actual usage rather than guessing missing model metadata.
- [x] Support cancellation/exhaustion with stopped dispatch, retained observations, and partial reports that distinguish not-run, unfinished, errored, inconclusive, calibration-invalid, and judged work.
- [x] Merge deterministic and semantic findings using critical-failure precedence. A later infrastructure failure does not hide a known violation; invalid judging never erases code-proven failures or creates semantic passes.
- [x] Produce complete per-trial JSON plus readable aggregate Markdown showing expected/observed behavior, evidence/action references, source scope, all findings/statuses, timing, and model-request/available-token breakdown by agent, judge, and calibration.
- [x] Report contradiction, unsupported-fact, and execution-claim rates per complete case trial with an explicit evaluated denominator and adjudication coverage for each metric. Any confirmed relevant error in any user-visible turn makes the trial positive for that metric, even if the final turn corrects it; evaluating only the last answer is insufficient. Mark zero-adjudication metrics N/A; overlapping categories must not be summed into a disjoint total.
- [x] Always show planned, attempted, completed, adjudicated, inconclusive, errored, and unfinished counts, including known positive violations from later-interrupted work where adjudication is sufficient.
- [x] Show per-workflow results, task completion, required-fact omissions, and the number of cases whose three trials all pass. Appropriate refusal differs from failing to answer an answerable case.
- [x] Compare compatible case/evidence versions and display configuration/coverage changes alongside metric deltas. Record source/case/feature-map hashes, code and working-tree identity, dependency identity, prompts/rubric/anchor versions, actual available model IDs/settings, and run times.
- [x] Preserve local/private artifact handling, strip credentials, and avoid evaluator-specific graph State or bulk application-log payloads. Handle completed and interrupted writes so collected results remain inspectable.
- [x] Integrate offline evaluator/fixture/scoring validation with routine CI using controlled HTTP and synthetic real-format data. Real-model runs remain manually triggered and do not require provider credentials for ordinary tests.
- [x] Verify complete repeated-run and version-comparison reports through the public-entry seam, including multi-turn/native resume, exact fake-gateway request counts across roles/trials/recovery, isolation, partial runs, N/A/coverage, error precedence, and no best-run selection.
