# 59 · Validate v19 rounded facts and player routing

**What to build:** Run a bounded v19 smoke for the baseline cases that exposed rounded required-fact omissions and player-reference routing.

**Blocked by:** None.

**Status:** resolved

## Evidence

V18 baseline `7e6fafe0-6da7-4e80-b7a5-ff5f517a2975` reported five semantic failures caused by numerically rounded display values being treated as missing (for example, `6.426...` displayed as `6.43`, and `0.471404...` displayed as `0.4714`). It also routed `recommend-smoke-synthetic-v1` trial 3 to team search after extraction echoed a player reference in `teams`.

V19 adds explicit rounding-equivalence guidance. Request normalization now clears a team field only when it exactly matches a non-excluded player mention in a player-based positional request. Offline regression tests cover the route and the v19 prompt rule.

## Acceptance

- Calibrate v19 and run these five development cases: `compare-haaland-foden-real-v1`, `compare-saka-bellingham-cross-scope-real-v1`, `recommend-smoke-synthetic-v1`, `team-rec-refine-synthetic-v1`, and `team-rec-synthetic-v1`.
- Required numeric facts shown with correct rounding are marked covered.
- Player-based recommendation does not call `api_football.search_teams`.
- No held-out Agent case was run.

## Result

V19 smoke `66c7f76e-e76e-45bc-b828-9cfd9cc845a4` used 49/90 requests: Agent 12, calibration 32, and judge 5. Calibration passed 32/32, including validation 16/16. All five cases passed code and semantic checks, and every required fact was covered. There were zero network failures and budget denials; the held-out Agent cases were untouched.

The subsequent v19 development baseline `24eb3bcf-ad26-43ad-a740-56e756994430` passed all 96 trials and had zero required-fact omissions.
