# 15: Triage multi-turn comparison resume failures

**What to investigate:** Separate a golden-case ordering error from the repeated identity-data failures in `compare-season-resume-add-synthetic-v1`, then correct the case or application behavior based on the evidence.

**Blocked by:** 09: Measure and archive the development baseline. The repeated run traces and expected contract are available.

**Status:** resolved
**Labels:** needs-triage

- [x] Correct the active-comparison participant ordering in the golden contract: the third user turn says “Elias Demo and Synthetic Winger,” while the expected `active-result-values` currently reverses them.
- [x] Reproduce why trials 2 and 3 stop on the first turn with `identity_data_unavailable` before any comparison action, despite the fixed synthetic identity bundle.
- [x] Verify season inheritance through the “add Synthetic Winger” turn and that starting a new comparison resets the participants.
- [x] Keep each trial's failure visible; do not replace it with a rerun that passes.

## Evidence

All three baseline trials failed. Trial 1 completed its four comparison calls and returned the declared `no_comparable_data` outcome on the final cross-competition comparison; its remaining deterministic failure was the reversed golden participant order. Trials 2 and 3 returned `identity_data_unavailable` on the first turn with no comparison action, so that repeated failure needs separate diagnosis.

## Resolution

The golden contract now records the third turn in the order requested by the user: Elias Demo, then Synthetic Winger. The local fake extractor had instead returned its fixed fixture list order; the comparison test mode now follows mention order, keeping the regression faithful to the request.

The repeated identity failures came from `prepareEvaluationCases` sharing one SQLite path across all three trials. The case's declared turn fault removes the Understat database during trial 1, so trials 2 and 3 started against the deleted file. `runOneTrial` now copies the prepared FM, identity, and Understat databases into a per-trial directory before invoking the isolated worker. A development-mode regression reruns all three trials and verifies resolved identities, four comparison actions per trial, the inherited 2024/25 season, and the preserved participant order. The archived baseline report remains unchanged.
