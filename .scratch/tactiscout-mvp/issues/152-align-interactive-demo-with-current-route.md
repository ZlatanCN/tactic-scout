# Align the interactive demo with the current Understat route

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the portfolio's interactive demo instructions match the current men-only Understat route and the latest recorded end-to-end Harness run.

## Acceptance criteria

- [x] The interview walkthrough recommends the current single-source Understat route, with `demo` identified as the offline/fictional fallback.
- [x] README no longer describes the disabled FPL run as the latest full-chain result.
- [x] The latest Harness summary matches the sanitized 2026-10-11 evidence and states the sample/metric limitations and unmeasured ranking quality.
- [x] Understat's unverified collection, retention, model-processing, display permissions and missing age coverage remain explicit.
- [x] Root `CONTEXT.md` records the men's-football product scope.
- [x] Local Markdown links resolve and `git diff --check` passes.

## Answer

Updated `docs/demo-walkthrough.md` to use the current `understat` single-source route and retain fictional `demo` as the offline fallback. The walkthrough now states the men's five-league scope, missing age field, incomplete market coverage and unverified source-use permissions. Updated the README's latest full-chain result from the no-longer-current FPL run to the sanitized 2026-10-11 Understat run: 31/31 Harness checks, 3 model requests, 6 tool calls, 151.976 seconds, 654 query matches, 20 evaluated candidates, 3 follow-up leads, and 220/340 observed expected metric values; all 20 were low-minute samples. The text explicitly says this does not measure ranking quality or prove long-term reliability. Added the men's-football data boundary to root `CONTEXT.md` so future source pools, evaluation samples and showcases use the same scope.

Verification: local Markdown targets in the README, walkthrough, issue and map all resolve; `git diff --check` passes. No application code or runtime configuration changed, so no application build or tests were run.

## Comments

- 2026-10-11 follow-up：对抗性复核发现 README 曾把 `mosaic` 与 Understat 并列展示为同级当前数据模式，削弱了单一当前路线的产品叙事。现明确 Understat 为互动演示主线、`demo` 为离线虚构回退、`curated` 为历史复现，并把 `mosaic` 标为非默认实验路线；数据源实现本身未变。

