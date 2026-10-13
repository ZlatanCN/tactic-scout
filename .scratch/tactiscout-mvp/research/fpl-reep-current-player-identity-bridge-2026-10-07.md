# FPL 当前球员到 Wyscout 历史样本的 Reep 身份桥接

核查日期：2026-10-07。范围：验证当前 FPL 候选记录能否通过来源标识和 Reep 的精确 provider/namespace/external ID 桥接到本机 Wyscout 2017/18 表现样本，并观察该证据是否能进入同一案件的 LangGraph 报告。不是完整阵容、球员身份官方 schema 或推荐质量评估。

## 结论

当前可运行的链路为：

```text
FPL 当前赛季候选记录
  → FPL 原生球员 ID + 观测到的 opta_code
  → Reep (opta, person_numeric, 数字 ID)
  → Reep canonical identity
  → Reep (wyscout, player, Wyscout ID)
  → 本机 Wyscout Open Data 2017/18 比赛事件样本
  → 报告中的独立历史样本附录
```

FPL 的 `opta_code` 在实时 payload 中以 `p<数字>` 形式出现。TactiScout 只将有效格式中的前缀 `p` 去掉，并把剩余数字作为 Reep `opta/person_numeric` 的精确键；它保留 FPL 的原生 ID 和字段出处，不按姓名或数字相似度猜测。**FPL 官方没有发布此字段的 schema 或语义契约**，所以字段来源目前是实时 payload 的观察，不应表述为 FPL 官方保证的 Opta ID 定义。Reep 文档把精确查询键定义为 provider、namespace、external ID 三元组，并将 Opta numeric 形式对应到 `person_numeric` namespace；Reep 的 `opta_numeric` 与 `premier_league` 是 Wikidata overlays，不参与此链路。[FPL bootstrap endpoint](https://fantasy.premierleague.com/api/bootstrap-static/) · [Reep get started](https://reep.football/get-started/) · [Reep provider roles](https://reep.football/docs/) · [Reep coverage](https://reep.football/coverage/)

本机 2026-10-07 实时核验中，FPL 返回 667 名候选；667 条均有唯一、格式有效的 `opta_code`。按 Reep 官方 2026-10-05 release 精确查询，656 条解析到 656 个 Reep canonical identities，11 条未解析；这 656 条各自关联一个唯一 Wyscout player ID，没有姓名匹配或多身份择一。Reep 的 rung/upstream status 是来源元数据，缺值保持缺值，不将它解释为身份失败或另造证据。

Reep → Wyscout 身份映射也不等于可用表现样本。本机已有 106 个映射 ID 出现在 Wyscout `players.json` 球员目录；调用实际 Wyscout 历史档案仓库后，667 名当前 FPL 候选中只有 90 名产生了至少一条实际报告样本。球员目录存在只证明该 ID 出现在目录中，不证明本机所选赛事/赛季事件文件能产出有效表现记录。

## 最新 release 与可复现输入

Reep 官方当前 release 为 `20261005T180536Z`。官方 release 文件已下载到 Git 忽略的 `.data/reep/releases/20261005T180536Z/`，并核对官网 checksum：

| 文件 | SHA-256 |
|---|---|
| `bridges.csv.gz` | `ccfe36b94612890102d89159b82eb92f22245151b4b7ebbf2859e38f069d7731` |
| `redirects.csv.gz` | `1c78dad87f4d1be2714343c5d62a498cdf7c13b98d50cce6cbdc2660bb83d724` |

该 release 已导入 Git 忽略的 `.data/reep/identity.sqlite`：1,066,479 条受支持 bridge rows、2,012 条 redirect rows，metadata release stamp 为 `20261005T180536Z`。代码和研究记录可提交；源数据与 SQLite sidecar 不应加入 Git。

## 同案 LangGraph → 报告验收

以本机 Qwen 3.5 9B 和 FPL 当前数据仓库运行已登记的 Bayern / Kane replacement 场景：

- 首轮先搜索方法资料和宽泛前锋候选，再询问职责；两次用户补答均恢复同一案件。
- 通过 Reviewer 后，历史档案节点核验本轮 30 名已评估候选；30 人都能通过精确 Opta ID 映射到 Reep，4 人在本地 Wyscout 档案中找到 4 条样本。
- 该次运行 104.761 秒，Harness 全部场景检查通过。报告的历史附录保存了 FPL 原生 ID、Opta provider/namespace/外部 ID、来源字段、Reep ID/release、Wyscout ID、赛事、赛季、分钟、指标定义、授权归属与限制。
- 最终推荐球员本身没有 Wyscout 历史样本，因此 4 条记录显示在“已评估候选的历史样本参考”独立附录；它们不参与 LLM 决策、能力评分、Reviewer 或推荐顺序。最终推荐仍依据 FPL 当前赛季所提供的证据。

此次端到端运行验证的是当次工作流与数据链路，不证明候选排序准确率、FPL 官方字段语义、完整全球市场覆盖或长期稳定性。运行时历史展示/本机留存 gate 仅通过该条命令的临时环境变量开启，没有修改 `.env`。

## 实现边界

- 原生来源身份继续记录 `fantasy-premier-league` + FPL player ID；Opta 数字 ID 作为独立、带字段出处的 provider identifier。
- 身份解析使用精确 `opta/person_numeric` 桥；未命中、redirect tombstone、多实体冲突都不会回退到姓名搜索。
- 同一个候选若多个成功的 provider identifier 指向不同 Reep canonical identity，拒绝整条关联。
- 映射成功只是关联身份；只有本机历史档案实际返回的赛事/赛季球员样本才计入 `matchedCandidates`。
- 历史记录保留 Wyscout 2017/18 赛季、事件口径、样本分钟与 CC BY 4.0 署名；作为报告旁证，不作为现役效力、当前能力或全球排名的证据。
- 其他 Reep bridges、PlayerElo、FPL 字段语义、历史 archive 完整性及任何未在本次运行读到的样本覆盖都不由该验收背书。

## 一手来源

- Fantasy Premier League：[实时 bootstrap endpoint](https://fantasy.premierleague.com/api/bootstrap-static/)。本地于 2026-10-07 请求 HTTP 200；payload 观察，不是字段 schema 文档。
- Reep：[release/data](https://reep.football/data/) · [coverage 与发布角色](https://reep.football/coverage/) · [API provider roles](https://reep.football/docs/) · [Opta namespace 说明](https://reep.football/get-started/)。
- Wyscout 历史数据论文与来源：[Pappalardo et al., Scientific Data 2019](https://doi.org/10.1038/s41597-019-0247-7)；本机数据目录标示 CC BY 4.0，样本只覆盖本地保存的 2017/18 文件。
