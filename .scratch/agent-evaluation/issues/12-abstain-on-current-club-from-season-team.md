# 12: Do not infer current club from a season record

**What to build:** Player lookup responses distinguish a team's name in a historical or current-season performance row from verified current registration.

**Blocked by:** 09: Measure and archive the development baseline. The Saka case provides a repeated, source-grounded regression.

**Status:** resolved
**Labels:** ready-for-agent

- [x] When Understat provides `team = Arsenal` for a 2026/27 EPL performance row but FM and Understat provide no registration field, describe Arsenal only as the team listed in that season's row.
- [x] State that current club/registration cannot be determined from those sources, as required by the case contract.
- [x] Keep the factual answer grounded in delivered source records; do not infer a transfer or registration update.
- [x] Add a regression through the real lookup graph asserting the abstention and preserving the seasonal team fact separately.

## Evidence

The three `lookup-saka-real-v1` trials passed deterministic source/identity checks but all failed semantic review because the final answer stated Arsenal as Saka's current club. The 2026/27 Understat row identifies a team for that season; it does not establish current registration.

## Resolution

The lookup prompt now defines Understat's `team` as scoped to its competition-season performance row. When asked for a current club, the assistant can state that row's team separately and must say current registration is unknown unless a source explicitly provides it.

The full lookup graph regression uses fixed synthetic evidence matching the 2026/27 EPL + Arsenal shape, avoiding a dependency on private local Saka data. It checks that the Arsenal season fact is delivered and that the final response abstains on current registration. The targeted test passed without a live model call.
