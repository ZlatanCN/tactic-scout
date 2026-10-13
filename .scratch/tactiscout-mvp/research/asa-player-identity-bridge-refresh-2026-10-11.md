# ASA 球员 ID 跨来源桥接复核

核查日期：2026-10-11。范围：是否有公开、可复核的精确 provider-ID crosswalk，可把 American Soccer Analysis（ASA）的球员 ID 接到 TactiScout 已用或正在评估的 Understat、FPL/Opta、Wyscout/Reep 身份。检查了 ASA 与 Reep 官方文档/代码仓库、当前公开 Reep release 页面及公开 FPL ID map；未调用需凭据的 API，未下载新数据，也未检查私人数据。

## 结论

**截至本次核查，没有找到 ASA player ID → Reep/Understat/FPL/Opta/Wyscout 的公开精确桥接。ASA 记录应继续按独立来源身份处理，不能用姓名、生日、球队或相似 ID 补桥。**

最强的候选桥接层 Reep 当前公开 release 为 `20261005T180536Z`（schema `public-bridge-register-v2`）。其 provider coverage 列有 Understat、Wyscout、Opta 和其他来源，但没有 ASA；项目已校验的同版 `bridges.csv.gz` 也按 `asa`、`american-soccer-analysis` 和 `american_soccer_analysis` 精确过滤为 **0 行**。最新网页仍列同一 release 和 provider 清单。[Reep coverage](https://www.reep.football/coverage/) · [Reep release 与 schema/许可说明](https://reep.football/data/) · [项目此前的 checksum 与 provider 行复核](current-provider-identity-bridge-2026-10-10.md)

Reep 的桥接键是 `(provider, namespace, external_id)`；ID 只有在 release 中确实存在对应 provider 行时才能连接。其公开 provider 列表明确列出 `understat`、`wyscout`、`opta`，但不列 ASA。这个结论限于本次 release 的公开文件，不推断 Reep 私有数据或未来版本的状态。[Reep provider namespaces 与桥接查询](https://reep.football/get-started/) · [Reep 当前 provider 清单](https://reep.football/)

## 来源逐项核对

| 路径 | 本次核对 | 是否满足精确桥接 |
| --- | --- | --- |
| **ASA → Reep → Understat/Wyscout/Opta** | 当前公开 Reep release 有后半段的来源 ID，但没有 ASA 的第一跳；checksum 对应的桥接 CSV 中 ASA provider 过滤为 0 行。 | **否**；无法从 ASA ID 启动解析。 |
| **ASA → FPL/Opta → Reep** | Reep 的 provider 表含 Opta；Reep Toolkit 文档还描述 FPL `code` 到 `opta_numeric` 的 Premier League player bridge。但 ASA→FPL/Opta 的第一跳仍缺失；而当前 Reep coverage 将 `opta_numeric` 列在经 Wikidata 提供的 overlay（633 行），不要据此承诺当前 release 有完整 FPL player bridge。 | **否**；也不能把 ASA ID 当成 FPL `code` 或 Opta ID。 |
| **ASA roster profile JSON → ASA ID** | ASA 发布的 MLS roster-profile 工具会从 MLS roster PDF 提取姓名，再按姓名映射到 ASA ID；README 说明只有“单一明显匹配”才自动匹配，多候选会要求操作者确认，并对不确定结果警告。公开 JSON 例子包含 ASA `id` 与姓名、合同/名册信息，但没有一个 MLS 外部 player ID。 | **不是跨 provider ID bridge**；可作来源标注明确的 MLS 名册上下文，不能转接到 Wyscout/FPL。 |
| **FPL-ID-Map → ASA** | 社区 FPL-ID-Map 明确连接 FPL、Opta、FBref、Transfermarkt、Understat、WhoScored，没有 ASA 列或 ASA source ID。 | **否**；即使该表能把 FPL 接到其他欧洲来源，也不能弥补缺失的 ASA 第一跳。 |

ASA 的官方接口和 `itscalledsoccer` 包把 `player_id` 用作 ASA 自身球员目录与统计表之间的 join key；ASA 官方文章展示了形如 `7VqGmob3Mv` 的原生 ID。材料没有声明这个值等于任何第三方 provider ID。[ASA API/package reference](https://american-soccer-analysis.github.io/itscalledsoccer/reference/) · [ASA 发布的 ID 示例](https://www.americansocceranalysis.com/home/2022/2/9/introducing-itscalledsoccer)

## 权利与可审计性边界

- Reep 当前下载 release 标注 CC0 1.0，允许复用其发布文件；Reep 同页同时说明 CC0 只能覆盖 Reep 自己持有的权利，**不会授予第三方源数据权利**。这不能为不存在的 ASA bridge 或 ASA 上游统计自动补许可。[Reep data/license](https://reep.football/data/)
- ASA 的 Shiny 项目要求使用公开数据时注明并链接 ASA；`itscalledsoccer` 仓库的 MIT license 是客户端代码许可。本次审阅没有找到覆盖 ASA 逐球员数据或新建映射表的独立数据许可，因此不能据代码许可推导任意留存、再分发或模型处理权。[ASA Shiny app attribution](https://github.com/American-Soccer-Analysis/asa-shiny-app) · [ASA client repository](https://github.com/American-Soccer-Analysis/itscalledsoccer)
- ASA 对 MLS roster PDF 的姓名映射是可追查的处理流程，不是上游 MLS player ID 到 ASA ID 的稳定 ID crosswalk；将它同其他 provider 的姓名匹配串起来仍是推断，不应包装成 exact match。[ASA parser README](https://github.com/American-Soccer-Analysis/mls-roster-profiles) · [ASA 发布说明](https://www.americansocceranalysis.com/home/2025/8/16/mls-roster-profile-releases-now-available-on-github)

## 建议

1. 维持当前身份规则：ASA 记录在没有唯一、可验证的 ASA bridge 时各自成组；不根据姓名/DOB/球队或 base62/数字格式猜测跨源同一人。
2. ASA 的 MLS roster-profile JSON 若用于产品，应作为**单独、带来源和日期的 ASA-linked 名册/合同上下文**呈现，并保留其姓名匹配和人工确认限制；它不应改变候选去重或评分身份。
3. 若未来需要 ASA↔Reep 精确桥接，等 ASA/Reep 发布包含两端原生 ID、provider namespace、版本与来源证据的映射，或只接受可审计的逐行人工核验表；收到后再按实际候选子集统计覆盖率。不要把“没有命中”转成姓名回退。

## 来源

- [Reep current coverage](https://www.reep.football/coverage/) · [Reep data/release/license](https://reep.football/data/) · [Reep get-started/namespaces](https://reep.football/get-started/)
- [Reep Toolkit Opta provider note: FPL `code` bridge boundaries](https://github.com/withqwerty/reep-toolkit/blob/main/docs/providers/opta.md)
- [ASA itscalledsoccer API reference](https://american-soccer-analysis.github.io/itscalledsoccer/reference/) · [ASA article with native player ID example](https://www.americansocceranalysis.com/home/2022/2/9/introducing-itscalledsoccer)
- [ASA MLS roster profile parser](https://github.com/American-Soccer-Analysis/mls-roster-profiles) · [ASA roster-profile release announcement](https://www.americansocceranalysis.com/home/2025/8/16/mls-roster-profile-releases-now-available-on-github)
- [Community FPL-ID-Map README](https://github.com/ChrisMusson/FPL-ID-Map)
