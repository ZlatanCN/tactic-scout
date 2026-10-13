# Avoid policy-blocked follow-up questions after position expansion

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

After a user has answered the role and approved broader positions, avoid spending extra Planner calls proposing follow-up questions that LangGraph policy will reject. Preserve genuinely useful, policy-allowed clarification questions.

## Evidence

The Wyscout 2017/18 dataset-to-report acceptance run completed the three-turn investigation, Reviewer, and report, but Harness acceptance failed `noBlockedFollowUpQuestions`. The report was produced safely; the Planner proposed two follow-up questions after the user had already answered, and both were rejected by policy before being shown.

## Acceptance criteria

- [x] Safe trace records policy reason codes without recording question text or raw user input.
- [x] A deterministic same-case regression reproduces the blocked follow-up after position expansion; the focused test was red before the fix.
- [x] A policy-rejected, non-actionable follow-up during an approved expansion continues at the exact next candidate cursor; it does not interrupt the user or call the Planner merely to recover.
- [x] A distinct material question that is allowed by policy can still be asked when its answer changes the candidate direction.
- [x] The local Harness accepts the versioned dataset → LangGraph multi-turn investigation → Reviewer → report path without policy-blocked follow-up questions.
- [x] Full tests, API/Web production builds, and `git diff --check` pass.

## Answer

Resolved. After the user approves a position expansion, LangGraph now converts a policy-rejected follow-up question into a search using the exact next-page cursor and unchanged filters. Policy-allowed questions that materially change the candidate direction remain available. Decision trace includes safe reason codes such as `unspecified_competition_scope` and `unavailable_player_report_claim` without logging the Planner question.

The rebuilt curated Wyscout v2 snapshot → LangGraph multi-turn case → Reviewer → report completed in 236.212 seconds and passed all 28 Harness checks. It used three turns, two user answers, 12 tool calls and 60 progress events; 30 candidates were evaluated and one evidence-backed lead was returned. Two policy-rejected question proposals were redirected to exact next-page searches, with zero blocked questions reaching the user. Report coverage showed goals and chance creation for all 30 evaluated candidates; shot finishing and attacking link-up stayed missing and explicit. Ranking quality, current-player coverage and long-term reliability remain unmeasured.

Verification: `pnpm test` 285/285; `pnpm build`; `pnpm build:web`; `git diff --check`.

## Comments

- 2026-10-08: Started from the live `bayern-kane-replacement` run using the locally rebuilt curated snapshot. A deterministic reproducer and safe policy-reason trace are in progress.
- 2026-10-08: The initial 327.297-second Qwen 3.5 9B run reached Reviewer/report but failed only `noBlockedFollowUpQuestions`. The new deterministic reproducer failed in 60 ms with reason code `unspecified_competition_scope`. After routing policy-rejected questions to the exact next page, the live run passed 28/28 checks in 236.212 seconds. The trace recorded `unspecified_competition_scope` and `unavailable_player_report_claim` reason codes without storing the proposed question text; the two redirects led to 30 evaluated candidates and a report. Ranking quality and long-term reliability are not validated.
