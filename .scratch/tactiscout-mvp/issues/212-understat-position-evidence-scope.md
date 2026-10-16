# 212 — Understat 位置证据的赛事范围

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by:

## Objective

保留 Understat 球员页赛季位置分组的单人证据，同时避免把未提供赛事维度的分组误当成某个联赛内的指标、候选范围或百分位；报告清楚区分赛季位置记录与联赛表现记录。

## Acceptance

- [x] 回归验证 Understat `groups.position[season][code]` 的表现值可以展示，但不能生成同赛事百分位、候选间值域或参考球员比较。
- [x] 完整位置 crosswalk 测试逐项覆盖 33 条直接/相邻关系，并验证非映射标签不会晋升为直接命中。
- [x] 报告展示来源位置标签、样本分钟及“赛季位置汇总，赛事未拆分”范围；缺失范围不解释成能力不符。
- [x] API/Web 构建、细分位置整图回归及完整位置映射/provider 回归通过。
- [x] 更新领域词汇和 ADR；说明这证明的是来源范围处理，不声称真实推荐质量或真实数据整体覆盖。

## Evidence

- 官方 Understat 球员页提供 Season 与 Position 分组筛选，但未显示单人统计的联赛筛选：[球员页](https://understat.com/player/619)。
- 当前本地解析把球员 `groups.position` 投影为 season、position code 和统计字段，没有保存 competition；不能证明这些值属于候选目录里的单一赛事。
- 生产代码按球员来源记录、赛事、赛季和产品位置寻找 peer；位置组指标只有赛季与源位置代码，因此同赛事比较可能混用口径。

## Answer

Understat 位置证据现在显式标为赛季位置汇总。该值仍可作为单人来源记录展示，但不会生成同赛事百分位、候选间数值范围或参考球员对比；报告会说明来源未提供赛事维度。33 条位置代码 crosswalk 均有逐项回归，未映射代码不会被提升为直接命中。默认 Understat 与 `mosaic` 的 Understat 子集都沿用此范围保护；mosaic 里只有粗位置的 ASA 来源记录会保留为未核实项，不会被冒充为细分位置命中。这里验证的是来源范围处理、位置映射和来源路由契约，不验证真实推荐质量或整个市场覆盖。

## Comments
