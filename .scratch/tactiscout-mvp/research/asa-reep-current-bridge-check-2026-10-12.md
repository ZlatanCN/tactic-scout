# ASA / MLS 当前精确身份桥接增量复核

核查日期：2026-10-12。只复核是否出现了比 2026-10-11 记录更新的 Reep 公共 release，或 ASA 官方页面/API/代码中是否新增可将 ASA / MLS 原生记录精确接到 Understat 等球员来源的 ID 字段或 crosswalk。未下载或导入球员数据，未调用 API，未联系数据方，也未修改应用代码。

## 结论

**未发现会改变 issue 39 身份桥接阻塞项的新证据。** Reep 官方数据页在本次检查时仍把 `20261005T180536Z`（2026-10-05）标为当前 release；官方更新页最近发布也是该日期，列出的新增 provider 是 SofaScore。ASA 官方接口仍将 `player_id` 用作 ASA 球员实体/统计的连接键；ASA 的 MLS roster-profile parser 输出 ASA 自有 `id` 与姓名，并通过姓名将 MLS PDF 记录关联到 ASA ID，没有公布 MLS/ASA→Understat、Reep 或其他 provider 的精确 ID crosswalk。

Reep `bridges` 的正式键仍是 `(provider, namespace, external_id) → reep_id`。上一份记录对当前同一 release 的完整桥接文件按 ASA provider 名称精确查询为零行；本轮的官方最新指针没有前进，因此该检查仍指向当前版本。新增 SofaScore 桥接不能弥补 ASA→Reep 的第一跳。

## 新增证据与版本边界

- Reep 官方[数据页](https://www.reep.football/data/)当前显示 release `20261005T180536Z`、schema `public-bridge-register-v2`、10,038,804 条桥接，并称按周发布；同页说明 `bridges` 列为 `provider, namespace, external_id, reep_id`。官方[更新记录](https://www.reep.football/updates/)目前最新条目为 2026-10-05，写明该次增加 SofaScore。官方[最新指针](https://data.reep.football/releases/latest.json)链接也由数据页指向。
- Reep[覆盖页](https://www.reep.football/coverage/)显示的是 2026-10-03 release（9,033,344 条桥接），比数据页/更新页的 release 落后；因此不要把覆盖页的日期或 provider 总数当作 2026-10-05 完整 release 的清单。对 2026-10-05 桥接文件的精确 ASA 过滤结果沿用 [2026-10-11 复核记录](asa-player-identity-bridge-refresh-2026-10-11.md)：该次校验记录了 release checksum 和零 ASA 行。本轮没有重新下载或导入文件。
- 最新公开发布说明明确新增 SofaScore，但没有 ASA。该事实本身不能证明 Reep 内部或非公开数据绝无 ASA；结论只涉及当前公开 release 和本次核对到的 ASA 官方接口/项目。

## ASA / MLS 官方字段核对

| 一手来源 | 官方公开的 ID / 字段 | 对精确桥接的意义与限制 |
| --- | --- | --- |
| ASA [`itscalledsoccer` Python API reference](https://american-soccer-analysis.github.io/itscalledsoccer/reference/) 与 [官方客户端源码](https://github.com/American-Soccer-Analysis/itscalledsoccer) | 客户端使用 `https://app.americansocceranalysis.com/api/v1/`；按联赛读取 `/{league}/players`，球员名字段为 `player_name`，原生 ID 字段为 `player_id`，统计筛选也将 `player_ids` 转成 API 参数 `player_id`。支持 `mls` 等 ASA 联赛 slug。 | 这是 ASA API 内部实体/统计的 ID。已检查文档和客户端接口没有说明该 ID 等同 Understat ID、Reep ID 或任何第三方 player ID；没有公开 ID crosswalk。字段同名或 ID 外观相似不构成映射。文档没有列出底层响应的完整 schema，因此结论限定为公开文档化的契约。 |
| ASA [`mls-roster-profiles` README 和示例输出](https://github.com/American-Soccer-Analysis/mls-roster-profiles) | 示例 JSON 的 release 有 `release_date`；球队含 ASA `id`、`name`、阵容/工资帽上下文；球员含 ASA `id`、`name`、roster slot/designation、status、contract through、option years 等字段。README 说明工具从 MLS roster-profile PDF 提取，再从 `itscalledsoccer` 取得 ASA IDs；单一明显姓名匹配自动映射，多个候选要求人工确认。 | 输出的 `id` 是 parser 关联到的 ASA ID；没有展示源 MLS player ID、Understat ID 或 Reep ID。它是姓名解析后的 ASA 关联结果，不是精确 provider-ID bridge；歧义确认也不能提升为源方发布的稳定 crosswalk。示例 PDF 为 2025-05-01，不代表当前 roster 新鲜度。 |
| Reep [release/data schema说明](https://www.reep.football/data/) 和[覆盖/角色页](https://www.reep.football/coverage/) | provider 身份桥接采用 provider、namespace、external ID 三段式键；2026-10-05 release notes 新增 SofaScore。Reep 将 Understat列为既有 bridge-only provider；ASA 未出现在已核对的当前公开桥接数据或官方 provider 清单证据中。 | 即使 ASA roster profile JSON 中有 `id`，也不能不经 ASA provider bridge 直接查 Understat、SofaScore、Opta 或 Reep。当前 release 未提供已验证的 ASA→Reep 第一跳。 |

## 对 issue 39 的判断

**阻塞不变。** 继续把 ASA / MLS 记录保留为独立来源身份；未有明确 `asa` provider namespace 的公开 Reep bridge 或 ASA 发布的、可审计的双端 ID 表之前，不跨源去重，不以姓名、出生日期、球队、裸数字或编码格式回退匹配。2026-10-05 的新增 SofaScore 只扩展 Reep 的另一 provider 侧，不改变 ASA 覆盖缺口。

## 直接一手来源

- Reep：[当前数据/release 页](https://www.reep.football/data/) · [release 更新列表](https://www.reep.football/updates/) · [coverage 页](https://www.reep.football/coverage/) · [latest 指针](https://data.reep.football/releases/latest.json)
- ASA：[API reference](https://american-soccer-analysis.github.io/itscalledsoccer/reference/) · [官方 Python client repository](https://github.com/American-Soccer-Analysis/itscalledsoccer) · [MLS roster profile parser repository/README](https://github.com/American-Soccer-Analysis/mls-roster-profiles)
