# Issue 160: Keep FPL game records distinct from verified current rosters

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Ensure `inspect_team` does not tell the Planner that Fantasy Premier League game-directory records verify a club's current registered roster.

## Context

The FPL provider marks its player records as current-season records, but its documented project scope is a fantasy-game directory, not a complete club registration list. `teamHistory` currently treats every current-season provider except a short exclusion list as `currentRosterVerified`, which makes FPL appear verified. The Planner's source rule only allows Sportmonks records with `isCurrentSeason=true` to describe that source's current-season roster.

## Scope

- Preserve FPL current-season records as useful team context while clearly identifying them as a fantasy-game directory sample.
- Set the roster-verification signal only for current-season Sportmonks records, consistent with the Planner policy.
- Preserve Sportmonks' source-limited meaning; it does not imply full league or transfer-market coverage.
- Verify behavior through `createRecruitmentConversation.turn`, inspecting the public Planner history after `inspect_team`; do not test the private `teamHistory` helper.

## Acceptance criteria

- [x] A current-season FPL team sample is not marked as a verified roster and says that it is a game-directory sample, not a complete registered roster.
- [x] A current-season Sportmonks sample remains eligible for the source-limited roster-verification signal.
- [x] A historical Sportmonks sample is not marked as a current roster.
- [x] Existing LangGraph report and team-context behavior remains unchanged beyond this evidence-boundary correction.

## Answer

The `inspect_team` result now marks current roster evidence only when the repository is Sportmonks and the returned record is explicitly tagged as current season. FPL results are described as entries from the Fantasy Premier League current-season game directory and explicitly stated not to represent a complete registered squad.

The regression exercises `createRecruitmentConversation.turn` and inspects the tool result received by the Planner. It covers current-season FPL, current-season Sportmonks, and historical Sportmonks records.

Verification: the new test failed before the fix on FPL's `currentRosterVerified: true`, then passed after the fix. `pnpm test` passed 392/392; `pnpm build` and `pnpm build:web` passed.

## Comments

- 2026-10-12：开始处理。测试 seam 为已采用的公开整图入口 `createRecruitmentConversation.turn`；断言 Planner 收到的 `inspect_team` 工具结果，不触碰私有 helper。
