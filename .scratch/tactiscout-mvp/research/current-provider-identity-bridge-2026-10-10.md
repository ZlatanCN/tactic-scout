# Understat 与 ASA 当前公开身份桥接核查

核查日期：2026-10-10。问题限定为：固定 Reep 公开身份 release 是否含 Understat 球员 ID 的精确桥接；同一 release 是否覆盖 American Soccer Analysis (ASA) 球员 ID，或官方资料是否证明 ASA 与 Understat 共用 ID namespace。此记录不验证球员排序、来源许可之外的再分发权，或 Reep 私有数据。

## 结论

- **Understat：有精确桥接。** Reep 当前公开 release `20261005T180536Z` 的 `bridges.csv.gz` 有 5,287 行 `provider=understat`，本地逐行核对全部为 `namespace=player`。行结构含 `provider, namespace, external_id, reep_id`；因此可按完整三元组 `(understat, player, 原样 external_id)` 精确解析到 Reep ID。Reep 的 coverage 页也将 Understat 列为 bridge-only provider（5,287 rows）。[Reep coverage](https://reep.football/coverage/) · [Reep bridge schema](https://data.reep.football/releases/20261005T180536Z/schema.json) · [该 release 校验和](https://data.reep.football/releases/20261005T180536Z/checksums.txt)
- **ASA：当前公开 release 未发现 ASA bridge。** 对同一份固定 `bridges.csv.gz` 按 provider 精确过滤，没有 `american-soccer-analysis`、`american_soccer_analysis` 或 `asa` provider 行；Reep 当前公开 provider 列表也没有列出 ASA。ASA 官方 API wrapper 确实暴露 ASA 自己的 player ID 字段/参数（如 Python 文档 `player_id`、JS wrapper `playerId`），但未找到 Reep 或 ASA 官方资料声明这些 ID 与 Understat ID 相同，或把 ASA 指向 Reep 的 Understat namespace。因此**没有官方依据把 ASA ID 当成 Understat ID 查桥**。[Reep coverage](https://reep.football/coverage/) · [ASA Python API reference](https://american-soccer-analysis.github.io/itscalledsoccer/reference/) · [ASA JavaScript wrapper](https://github.com/American-Soccer-Analysis/itscalledsoccer-js)
- **措辞边界：** 这是“该公开 release 未提供 ASA bridge”的结论，不是“Reep 私有数据中绝无 ASA”或“未来不会支持”的结论。Reep coverage 页明确说明，provider role 描述公开文件所展示的内容，不代表 Reep 私下持有哪些数据；公开 coverage 也不承诺对源头数据做全量覆盖。[Reep coverage caveats](https://reep.football/coverage/)

## 证据与复现范围

Reep 当前指针于本次核查时指向 `20261005T180536Z`（生成时间 2026-10-05 18:50:34Z）；Reep 的 data 页面将其标为 2026-10-05 release，并说明 CSV `bridges` 是完整公开 provider-ID crosswalk。官方 checksums 中 `csv/bridges.csv.gz` 的 SHA-256 为 `ccfe36b94612890102d89159b82eb92f22245151b4b7ebbf2859e38f069d7731`；工作区 `.data/reep/releases/20261005T180536Z/bridges.csv.gz` 与之相符。本地核对得到 5,287 条 Understat 行，namespace 集合只有 `player`；provider 精确查询得到 0 条 ASA 行。[Reep latest pointer](https://data.reep.football/releases/latest.json) · [Reep release/download说明](https://reep.football/data/) · [official checksums](https://data.reep.football/releases/20261005T180536Z/checksums.txt)

Reep 用 `(provider, namespace, external_id)` 作身份键，namespace 因 provider 而异，external ID 按文本保存。故即使两个来源的字段都叫 `player_id`，也不能推导它们属于同一 provider 或共享同一身份空间；字段名称相同不是跨来源链接证据。[Reep get-started: namespace 与桥接键](https://reep.football/get-started/) · [ASA Python API reference](https://american-soccer-analysis.github.io/itscalledsoccer/reference/)

## 2026-10-10 当前 release 复核

再次读取 Reep 官方 [coverage](https://www.reep.football/coverage/)、[首页](https://reep.football/)及 [get-started](https://reep.football/get-started/) 后，公开 latest 仍指向 `20261005T180536Z`（2026-10-05 18:05Z），Understat 仍列 5,287 bridge rows。ASA 仍不在已公开 bridge provider 列表中。官方 [Reep API 文档](https://reep.football/docs/)区分按版本发布的 public bridge 文件和需 key 的 hosted API；本项目继续使用已校验的本地 release，不依赖未授权的 API key 或假设 API 与文件版本相同。

Reep 当前网页/最新指针显示的 release 时间是 **2026-10-05 18:05Z**；这是有日期戳的静态 release，不是实时球员阵容。网页 coverage 会随 release 更新，且它公开的是汇总行数与 provider 角色。以后应重新核对最新指针及其 manifest，而不要把本结论视为永久覆盖保证。[Reep current coverage](https://reep.football/coverage/) · [Reep latest pointer](https://data.reep.football/releases/latest.json)

## 对候选去重的直接含义

TactiScout 可对 Understat 来源记录做精确 Reep 解析，但 ASA 来源记录在该 release 中没有对应的已证实跨 provider bridge。Understat 与 ASA 两路即使出现同名球员，也只能先保留各自来源身份；不得只凭姓名、相似数字 ID 或字段名合并。若未来要合并，需取得公开的 ASA bridge 或一条经过验证、带命名空间的身份 crosswalk。

## 2026-10-11 增量复核

查询时间：**2026-10-11 03:31 UTC**。本次只检查 Reep 官方网页、最新 release 指针、release manifest 和 coverage delta；没有下载或导入新数据，也没有运行代码或测试。

- **本次检查未发现更新。** 官方 [latest release 指针](https://data.reep.football/releases/latest.json)仍指向 `20261005T180536Z`，其 `manifest_url` 为 [`20261005T180536Z/release.json`](https://data.reep.football/releases/20261005T180536Z/release.json)，manifest SHA-256 为 `8e969c76fabfe84548f367a5c9f29596682787185673eec9c035d3f2001c14b5`。官方 [更新列表](https://reep.football/updates/)当前最新条目也是 2026-10-05；[数据页](https://reep.football/data/)和[coverage 页](https://reep.football/coverage/)显示同一 release stamp。上述页面在查询日可访问；这表示本次检查时官方公开页面未显示更新，不保证之后或非公开数据状态。
- **当前公开 release 没有新增 ASA bridge 的证据。** 该版 [release manifest](https://data.reep.football/releases/20261005T180536Z/release.json)将 bridges CSV 固定为 10,038,804 行、SHA-256 `ccfe36b94612890102d89159b82eb92f22245151b4b7ebbf2859e38f069d7731`，与本研究前文记录的已核验本地文件相同；官方 [coverage delta](https://data.reep.football/releases/20261005T180536Z/coverage_delta.json)列出 Understat `before=5287, after=5287, delta=0`，没有 `asa` 项；当前[公开 provider coverage](https://reep.football/coverage/)仍列出 Understat（5,287 rows），未列 ASA。此前对与该 checksum 相符的完整 bridges CSV 做过 provider 精确查询，未找到 ASA 行；本次依照要求没有重新下载或导入 CSV。

**对 issue 39/map 的判断：** 这次足以为研究记录和 issue 的当前状态补上“截至 2026-10-11 官方最新指针仍未前进、公开 ASA bridge 仍未验证”的时间戳；它不满足该 issue 对真实 Understat↔ASA bridge 覆盖的验收项，也不能作为关闭 issue 或宣称 ASA 永远不在 Reep 中的依据。下一版 release 发布后应再按新 stamp、manifest/checksum 和 provider 行复核。
