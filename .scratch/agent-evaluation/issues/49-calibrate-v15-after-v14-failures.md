# 49 · Calibrate v15 after the V14 baseline findings

**What to build:** Run a bounded v15 smoke over the V14 failure cases after the alias, season, attribute, result-limit, and empty-lookup fixes.

**Blocked by:** None.

**Status:** resolved

## Result

V15 smoke `ae7fe94a-2597-4474-9822-0c2c57511aa7` completed five targeted cases using 53/130 requests: Agent 16, Calibration 32, and Judge 5. All 16 reserved validation anchors passed, all five deterministic code checks passed, and four semantic trials passed. The remaining semantic failure was required-fact coverage: the judge did not map the answer's “当前能力 139” to `currentAbility=139`. There were no network failures or budget denials, and held-out cases remained untouched. Issue 50 fixes the judge label mapping.
