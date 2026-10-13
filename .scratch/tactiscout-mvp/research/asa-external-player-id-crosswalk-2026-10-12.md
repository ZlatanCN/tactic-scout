# ASA / MLS 外部球员 ID 精确桥接复核

核查日期：2026-10-12。问题是：截至该日，是否有数据所有方或身份桥接发布方公开发布一条可审计、使用双方原生 ID 的精确映射，可将 ASA 的 MLS 球员记录连接到 Understat、Reep 或仓库已有的其他 provider？本次只核查官方文档、API 契约、源码仓库和已发布 release；没有申请凭证、调用 API、下载球员数据，也没有按姓名、生日或其他相似信号推断映射。

## 结论

**在已核查的公开材料中，没有找到 ASA/MLS → Understat、Reep 或其他现有 provider 的已发布精确 player-ID crosswalk。** ASA API 暴露自己的 `player_id`，但官方 wrapper/API 文档没有声明它与 Understat 或其他 provider 的 ID 相同。ASA 的 MLS roster-profile 工具明确通过 roster 名称查 ASA ID；这说明该工具输出可关联到 ASA 的 ID，但不能充当 MLS 原生 ID 到 ASA/其他 provider 原生 ID 的 crosswalk。

Reep 是当前最直接的公开身份桥接候选：其 v1 的键为 `(provider, namespace, external_id)`，而非无命名空间的数字或名称。2026-10-12 检查时，Reep 官方数据页仍标示 release `20261005T180536Z`（2026-10-05），其中 Understat 有公开 bridge；ASA 不在公开 provider coverage 中。对该 release 完整 bridge 文件的 checksum 核对与 ASA provider 精确过滤已记录在仓库既有核查中，结果为 0 条 ASA 行；本次未重新下载该文件。[既有 release 核查](asa-reep-current-bridge-check-2026-10-12.md)。

此结论限定于截至核查日期能检查到的公开资料和上述 Reep release；不表示 ASA、MLS 或 Reep 私下没有映射，也不表示未来不会发布。Reep coverage 是 provider 角色的汇总视图，单凭页面“未列出”不足以证明完整 release 文件的负面事实；精确过滤结论以已校验 release 文件的记录为准。

## 一手来源核查

| 来源 | 官方资料明确了什么 | 对精确桥接的判断 |
|---|---|---|
| ASA `itscalledsoccer` Python API wrapper 与 reference | wrapper 将球员实体字段映射为 `player_name` / `player_id`，并用 ASA `player_id` 过滤 ASA 球员统计；reference 定义 ASA 自己的球员实体与统计接口。[官方源码](https://github.com/American-Soccer-Analysis/itscalledsoccer/blob/main/itscalledsoccer/client.py) · [官方 API reference](https://american-soccer-analysis.github.io/itscalledsoccer/reference/) | 这是 ASA 命名空间里的球员 ID。所查公开契约未提供 `understat_id`、`reep_id`、Opta/Wyscout 等外部球员 ID 字段，也未声明 ASA ID 与它们等价。`player_id` 这个字段名本身不是跨源映射。 |
| ASA `itscalledsoccer` JavaScript wrapper | 官方 JS README 以 `getPlayers` 和 `playerId` 调用 ASA 数据，并指向 ASA Swagger/API 参数文档。[官方仓库](https://github.com/American-Soccer-Analysis/itscalledsoccer-js) | 与 Python wrapper 一致：公开表面是 ASA 自身 ID 参数；未找到双边 ID 映射契约。 |
| ASA MLS roster-profile parser | README 说明工具解析 MLS roster-profile PDF，再从 `itscalledsoccer` 获取 ASA IDs 并将球员/球队名称映射过去；单一明显候选自动选择，多候选要求人工确认。示例输出的 `id` 是 ASA 关联 ID，并列出姓名、合同及 roster 属性。[官方源码仓库](https://github.com/American-Soccer-Analysis/mls-roster-profiles) | 这条链路基于姓名解析，不发布 MLS 原生 player ID 与 ASA/其他 provider 原生 ID 的成对 crosswalk；有人工消歧也不等于源方 ID 桥接。不可将其作为本 issue 所需的精确桥。 |
| Reep v1 release 与 schema | 数据页说明完整公开发布包含 `bridges(provider, namespace, external_id, reep_id)`；截至核查日标示 stamp `20261005T180536Z`，版本化文件附 schema 与 checksum。[数据页](https://reep.football/data/) · [release pointer](https://data.reep.football/releases/latest.json) · [该版 schema](https://data.reep.football/releases/20261005T180536Z/schema.json) · [checksums](https://data.reep.football/releases/20261005T180536Z/checksums.txt) | 只有 bridge 表确有一条 ASA 原生 ID 行，才能把 ASA 记录接入 Reep；字段同名、相同数值或别名不够。仓库既有审计对 SHA-256 为 `ccfe36b94612890102d89159b82eb92f22245151b4b7ebbf2859e38f069d7731` 的该版完整 bridge 文件按 `asa`、`american-soccer-analysis`、`american_soccer_analysis` provider 精确过滤，均为 0 行。 |
| Reep v1 当前 release 与 provider coverage | 官方更新页列出 2026-10-05 release，并写明新增 SofaScore；数据页标出同日 stamp。coverage 汇总将 Understat 列为 bridge-only provider、5,287 行，未列 ASA。[release 更新页](https://reep.football/updates/) · [coverage](https://reep.football/coverage/) | 支持“Reep 公布了 Understat 桥、未公开声明 ASA provider 桥”的判断。coverage 页面 provider 清单未反映更新页写明的新 SofaScore，故该清单可能滞后；不能只靠 coverage 缺项推断 release 文件中不存在 ASA 行。应保留精确 release 文件检查作为版本化依据。 |
| Reep 身份键及名称 fallback 说明 | 官方指南规定 provider ID 按 `(provider, namespace, external_id)` 精确连接；找不到 provider ID 时，名称搜索只产生待人工确认的候选，不是答案。[Reep get-started](https://reep.football/get-started/) · [身份解析说明](https://reep.football/entity-resolution/) | 不应把 ASA 的 `player_id` 当成 Understat 的 `external_id`，也不应让模型、相似度或姓名命中把缺失 crosswalk 变成已验证身份。 |

### Reep 版本边界

- 官方数据页和 updates 页在 2026-10-12 仍显示最新发布日期为 2026-10-05、release stamp 为 `20261005T180536Z`；这是版本化快照，不是实时登记。[数据页](https://reep.football/data/) · [updates](https://reep.football/updates/)
- 该 release 的官方数据页称 bridge 表包含完整的公开可发布 provider-ID crosswalk。仓库先前已记录完整 bridge 文件 SHA-256 `ccfe36b94612890102d89159b82eb92f22245151b4b7ebbf2859e38f069d7731` 与官方 checksums 相符，并对该版做过 provider 精确检查；本次增量调查复用这条有版本和校验和边界的记录，没有重新下载文件。[官方 checksums](https://data.reep.football/releases/20261005T180536Z/checksums.txt) · [先前核查记录](asa-reep-current-bridge-check-2026-10-12.md)
- 官方 coverage 当前显示 5,287 条 Understat bridge；ASA 未出现在其 provider 汇总中。Reep 也声明 coverage 仅描述公开文件中所呈现的角色，不代表其私有持有情况。[coverage caveats](https://reep.football/coverage/)

## 对 issue 39 的工程建议

1. **保留 ASA 的来源身份，不做跨源合并。** 继续以有命名空间的来源键保存 ASA 记录（例如 `provider=asa`, `namespace=player`, `external_id=<ASA player_id>`）；无已验证 bridge 时将其作为独立来源记录/候选组。ASA 各统计端点之间可以用 ASA 自身 `player_id` 连接，但这不证明它和 Understat/其他 provider 是同一身份。
2. **不把 ASA ID 送入 Understat 或 Reep 的其他 provider namespace 查询。** 尤其不因 ASA ID 和某个外部数字 ID 数值相等、同名、相似生日或同队就合并。Reep `as_com`（若在 provider 列表中出现）是单独的 `as_com` overlay 名称，不应误认为 American Soccer Analysis。
3. **issue 39 的 ASA 精确桥验收保持未满足。** 合成 resolver fixture 只验证应用在“有精确 ID 时如何处理”的控制流，不能代替 ASA live bridge 覆盖证据；不要因为合成用例通过而关闭该项。
4. **只有出现可审计双边 ID 证据时才接入。** 可接受的新增证据包括：ASA/MLS 数据所有方文档直接给出双方 ID；或身份 crosswalk 发布方在有 stamp/schema/checksum 的 release 中发布 ASA 的 provider namespace 与 external ID。若未来 Reep release 加入 ASA，应以完整元组查询并记录 release stamp、checksum、唯一性/冲突和未命中情况，再做真实 resolver 与整图验证。
5. **允许的替代工作是来源内能力分析，而非身份猜测。** 如果 ASA 候选池本身有用，可以单独展示 ASA 的指标与范围；跨源证据只在已有确切 provider ID 或已验证 crosswalk 后加入。此安排保留 ASA 数据价值，同时避免重复提名与错误合并。

## 核查限制

本次未获取 ASA/MLS 凭证、未请求 ASA API、未抓取球员记录、未下载 Reep 球员数据，也未枚举任何个体的公开页面。ASA 文档本身无法证明其私有系统不存在未公开的 ID 映射；Reep 页面也明示公开 coverage 不披露私有数据。结论应表述为“截至指定 release/公开资料未找到”，而不是永久或全行业范围的“不存在”。
