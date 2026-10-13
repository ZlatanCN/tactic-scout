# Distinguish dataset format and metric ruleset versions

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Show the dataset snapshot format and the derived metric ruleset as separate version details in the workbench and recruitment report.

## Acceptance criteria

- [x] A Wyscout dataset ID with schema v1 and event rules v2 is displayed with both versions, without presenting schema v1 as the only dataset version.
- [x] A v1 event ruleset remains correctly visible for older snapshots.
- [x] Existing data-to-LangGraph-report integration still passes.

## Root cause

The dataset ID encodes both a snapshot schema version (`...-v1-...`) and a derived metric ruleset (`...-events-v2`). The UI shortened the ID by selecting the first version token, which hides the metric ruleset used by the current curated snapshot. The open browser tab was also showing a previously loaded snapshot while the local web/API servers were stopped.

## Answer

The version label now presents the snapshot format and event-derived metric ruleset separately, along with the stable source fingerprint. This keeps the format at v1 while correctly showing that the active metric rules are v2. Older v1 rulesets remain distinguishable.

The current workbench was reconnected to the local API and displayed `格式 v1 · 指标规则 events v2 · 401a88b80cc2`, built October 6. The local Wyscout snapshot has 2,682 player-season records across 1,826 matches.

Verification: the focused dataset-label and Wyscout data-to-LangGraph-report tests pass 11/11; `pnpm build`, `pnpm build:web`, and `git diff --check` pass.

## Comments

- 2026-10-06：开始修复工作台与报告中的版本信息展示，并复验 Wyscout 数据集到 LangGraph 报告的链路。
- 2026-10-06：版本信息改为分别呈现快照格式和派生规则；工作台已连到当前服务并显示 Wyscout events v2。定向验证 11/11、前后端构建通过。
