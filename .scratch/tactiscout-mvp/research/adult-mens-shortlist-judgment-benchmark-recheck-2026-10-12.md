# 成年男子足球引援短名单：人工判断基准增量复核

研究日期：2026-10-12。范围：复核此前审计之后的一手研究，判断是否出现可直接评测 TactiScout 的、按具体球队需求（team brief）定义的球探判断基准。核对大学机构论文页、可公开论文文本、出版方论文页及作者公开代码库；未下载数据、未访问受限全文，也未检查 OSF 数据文件或其逐项许可。既有公开标签审计见[前次审计](public-scout-judgment-dataset-search-2026-10-11.md)。

## 结论

**NO-GO：本轮未发现可直接替代项目本地评审的 team-brief 球探判断基准。** 最接近的是一项职业足球球探对 50 名中卫资料共同打分的研究；它有真实球探标签和固定评价问题，但不是针对特定球队的招募简报，也没有在可核文本中明确逐人报告成年男子资格。另有一项可复现的 EPL 前锋算法排序研究，但作者说明研究不涉及人类受试者，没有球探判断标签。两者均不能为 TactiScout 的具体需求 shortlist 提供可用 qrels。

## 两项相邻研究

| 可核事实（来源陈述） | 适用边界（推断） |
|---|---|
| Peringa 等（2025）的 Lens Model 实例中，18 名荷兰职业俱乐部球探各自评价同一组 50 份中卫球员画像；画像基于 FIFA 2022 数据。统一问题是“这名中卫有多大价值？”，采用 1–10 分；研究以球员市场价值作为表现标准的代理指标。论文称数据文件可经文中 OSF 链接获取，论文版本为 CC BY。[论文全文及方法](https://pure.rug.nl/ws/portalfiles/portal/1209238803/1-s2.0-S1469029224001432-main.pdf)、[格罗宁根大学论文记录](https://research.rug.nl/en/publications/a-uniform-approach-for-advancing-athlete-assessment-a-tutorial-on/) | 这是**最接近的公开球探判断基准**，可为“相同中卫资料上的一般价值判断”提供 Lens Model/评分聚合方法参考。但问题不是依某队、预算、阵型或补强缺口形成的 team brief；市场价值也不等同于队伍适配。论文可见部分未逐人核实画像的年龄及性别，故不能确认它满足本题限定的成年男子样本。论文 CC BY 不自动证明 FIFA 来源字段或 OSF 数据文件允许本项目复用；本轮未检查 OSF 文件及许可。**因此可作方法参考，不能作为 TactiScout team-fit 排名真值。** |
| JeddouBen Jeddou、Ati 与 Bouchet（2026）用 CRITIC–TOPSIS 对 2022–2025 赛季 123 个 EPL 前锋球员赛季样本排序，使用七项进攻指标，并做敏感性、时间及 Transfermarkt 数据外部验证；Springer 页面称数据和代码通过作者 GitHub 仓库及 Zenodo 开放。论文声明研究未涉及人类受试者。[出版方论文页](https://link.springer.com/article/10.1007/s43069-026-00692-5)、[公开代码与数据说明](https://github.com/benjeddourokaya-maker/CRITIC-TOPSIS-EPL-Forwards) | 这是**可复现的算法排序/数值代理验证**，不是人类球探或专家判断基准。排名由统计指标计算，外部验证也不构成 team brief 相关性标签；不能据此声称系统更符合球探或球队需求。可参考其可复现报告与稳健性检查，但不能解除 `not_evaluable`。 |

## 对 TactiScout 的建议

**下一步：**选定一条真实成年男子引援需求，冻结原始 team brief、完整候选池、证据快照和各系统排名；先核实球员材料的评审、保存及展示权限，并取得评审者同意。然后使用现有盲评与裁决流程，由至少两名独立评审者在不见系统身份和名次的情况下，对全体候选按 0–3/`unknown` rubric 打分并完成裁决。仅当候选池完整且每张卡都有数值裁决时，才计算该 query 的 nDCG@5；任一候选仍为 `unknown` 或标签缺失，就维持 `not_evaluable`，不得把 `unknown` 当 0。该分数只说明这条需求和冻结的候选池。

**NO-GO 条件：**若候选池不完整、材料权限不足、评审同意缺失，或没有完整的双评与数值裁决真值，不以以上论文/开放数据替代标签，不计算 shortlist 质量分。现有评审闭环已由 [issue 119](../issues/119-human-labeled-shortlist-benchmark.md) 和 [issue 124](../issues/124-close-the-human-shortlist-evaluation-loop.md) 跟踪。
