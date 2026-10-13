# Carry Wyscout attacking-duel evidence through the LangGraph report

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Make Wyscout ground attacking duels available as clearly bounded supplemental evidence in a full recruitment conversation, from the local data repository to the final LangGraph report and workbench.

## Acceptance criteria

- [x] The full public chain is covered: a Wyscout event fixture is built into the versioned dataset, loaded by `CuratedDatasetRepository`, and sent through `createRecruitmentConversation` and the compiled LangGraph into the final report.
- [x] Only `Duel` + `Ground attacking duel` events with exactly one result tag (701 lost, 702 neutral, or 703 won) contribute to the rate and share. An accurate tag (1801) does not stand in for a result.
- [x] The report includes recorded ground attacking duels per estimated 90 minutes and the explicitly-won share with 701, 702, and 703 all in the denominator; the classified duel count is visible with an accurate label.
- [x] Missing or contradictory result tags preserve missing-data semantics instead of creating a partial-looking metric.
- [x] An explicit request for attacking one-on-one evidence maps to these Wyscout metrics. The metrics do not add a weight to the deterministic role-fit score; the Agent can consider them as evidence in its conclusion.
- [x] Final report and workbench describe this as historical Wyscout evidence, not dribbles, progressive carries, or a current-player signal; source event fields and estimated-minute limits remain visible.
- [x] API and web production builds pass.

## Answer

Added two source-specific supplemental metrics: Ground attacking duel events per estimated 90 and the explicitly-won share. The share denominator is the count of classified 701/702/703 events, including neutral 702; 1801 accuracy cannot classify an outcome. Missing or contradictory outcome tags suppress both metrics for that player. The classified-event denominator and its label now survive dataset serialization, LangGraph evidence, report text, and the workbench. Explicit “进攻一对一对抗” requests are included in capability coverage. The metrics do not add a new numerical weight to the deterministic role-fit score; the Agent can cite them when forming its evidence-grounded conclusion.

The derivation ruleset is now `tactiscout-wyscout-events-v2`. The local snapshot was rebuilt at `.data/tactiscout-datasets/latest.json`; v1 remains alongside it. The real 2017/18 sample contains 2,682 player-season records across 1,826 matches: duel frequency is available for 2,682 records and the classified outcome share for 2,532. These are historical event observations, not current-player or transfer evidence.

Verification: the Wyscout repository-to-report test file passes 8/8, including no-outcome and contradictory-tag cases; `pnpm build`, `pnpm build:web`, a real `pnpm dataset:build`, and `git diff --check` pass. The real dataset build used the local raw sample and updated only the ignored local snapshot; no player records were sent to a model.

## Research

- [Wyscout v2 event documentation](https://support.wyscout.com/matches-wyid-events) identifies `Duel – Ground attacking duel` as a distinct event/subevent and defines the 701/702/703 result tags. The 1801 tag means accurate and is not an outcome tag.
- [Current player-data source admission review](../research/current-player-source-admission-refresh-2026-10-06.md) records why this historic-data slice is the honest path while no immediately usable current player source has passed access, coverage, and model-use checks.

## Comments

- 2026-10-06：用户确认以完整对话链路作为验收边界：数据仓库 → LangGraph → 最终报告。
- 2026-10-06：完成 Wyscout 数据集 v2 和能力证据报告链路；真实快照覆盖、缺失语义及验证结果见 Answer。
