# 推荐功能的数据审计

Status: resolved
Labels: ready-for-agent

审计日期：2026-10-25。仅查询本地 SQLite，未调用模型或外部网络。以下为当前快照的观测结果。

## FM 画像

- 文件：`.data/fm/profiles-v2.sqlite`，约 291 MB。
- Manifest：`SELECT payload FROM manifest WHERE id = 1`。
- 102,708 条画像，`record_id` 全部唯一。
- 102,706 个非空且唯一的 `unique_id`，另有 2 条缺少 FM ID。
- 每条压缩 payload 都有相同的 156 个字段，全量解压解析失败数为 0。
- `inGameDate`：2025-11-23；`gameBuild`：26.3.2；`databaseVersion`：26.2.0；`parserVersion`：0.5.10。
- 导入时间：2026-10-16T14:01:21.656Z。导入时间和画像所处日期是不同概念。
- Manifest SHA256：`431eecb0a892bf7be8e056832a6fd9e553f461d1b629fdd080ea31e847bd85eb`。

现有查询 reader 暴露 10 项 raw 属性；候选推荐可读取完整的 52 项 `raw_attributes_*` 字段。raw 属性使用 1–100 尺度；对应的非 raw 属性使用 1–20 尺度。全位置 feature map 应只从 raw 字段中选择并固定尺度。

| 属性 | 当前库观测范围 |
| --- | --- |
| 加速 acceleration | 1–100 |
| 决策 decisions | 1–90 |
| 射门 finishing | 1–94 |
| 停球 first_touch | 1–99 |
| 无球跑动 off_the_ball | 1–97 |
| 速度 pace | 1–99 |
| 传球 passing | 1–94 |
| 强壮 strength | 1–100 |
| 技术 technique | 1–100 |
| 视野 vision | 1–99 |

全部 52 项 raw 属性名称：`acceleration`、`aerial_reach`、`aggression`、`agility`、`anticipation`、`balance`、`bravery`、`command_of_area`、`communication`、`composure`、`concentration`、`consistency`、`corners`、`crossing`、`decisions`、`determination`、`dirtiness`、`dribbling`、`eccentricity`、`finishing`、`first_touch`、`flair`、`free_kick_taking`、`handling`、`heading`、`important_matches`、`injury_proneness`、`jumping_reach`、`kicking`、`leadership`、`long_shots`、`long_throws`、`marking`、`natural_fitness`、`off_the_ball`、`one_on_ones`、`pace`、`passing`、`penalty_taking`、`positioning`、`punching`、`reflexes`、`rushing_out`、`stamina`、`strength`、`tackling`、`teamwork`、`technique`、`throwing`、`versatility`、`vision`、`work_rate`。这些字段在当前快照中完整。

CA 为 1–196，PA 为 1–200，均完整。`ability_potential_range_code` 全为空，不能据此恢复随机潜力范围。

## 位置和年龄

- `positions(position, rating, record_id)`：主键 `(position, record_id)`，索引 `(position, rating DESC)`。
- 位置代码：`amc/aml/amr/dc/dl/dm/dr/gk/mc/ml/mr/stc/sw/wbl/wbr`；`sw` 的评分恒为 1，没有可用候选。
- `natural_positions` 字段完整，以分号分隔位置代码（例如 `AMR;AML`），可用于参考球员自然位置交集；位置表评分用于候选/参考位置门槛。不要把 `rating=20` 当作 `natural_positions` 的等价字段。
- 当前 14 个有数据位置的画像数量如下。`rating=20` 和 `rating>=15` 是数值统计；推荐方案选择 `rating>=15` 作为明确门槛。

| 位置 | rating=20 | rating>=15 |
| --- | ---: | ---: |
| GK | 10,319 | 10,319 |
| DL | 6,758 | 11,363 |
| DC | 17,559 | 21,276 |
| DR | 7,307 | 11,956 |
| WBL | 1,077 | 6,790 |
| DM | 7,480 | 17,196 |
| WBR | 834 | 6,675 |
| ML | 1,629 | 8,786 |
| MC | 13,508 | 24,584 |
| MR | 2,085 | 9,713 |
| AML | 7,061 | 17,881 |
| AMC | 7,841 | 17,243 |
| AMR | 7,070 | 17,985 |
| STC | 15,410 | 21,120 |

- 位置评分门槛 `>=15` 是产品选择，不把它称为 FM 官方的“Competent”。SI 的 FM24 手册将 15–17 称为 Accomplished、18–20 称为 Natural；本地快照为 FM26 build 26.3.2，因此只把本项目规则表述为数值门槛，避免跨版本搬用界面标签。[FM24 官方位置评分说明](https://community.sports-interactive.com/sigames-manual/football-manager-2024/players-r4958/)
- 上表按位置表原始行计数；全位置实验另外要求有效 FM unique ID，因此会排除本地两条缺少 FM ID 的画像。具体每位置可读候选数和拟合、开发、测试样本量见实验报告。
- `players.birth_date` 和 `players.unique_id` 有索引。
- 出生日期和 `natural_positions` 完整。按快照日期计算年龄为 15–55 岁，其中 525 人年龄至少 40 岁。
- 没有现役/退役标志，也没有可用于判定球员是否仍在现实联赛踢球的字段。

单次本机观测：全库解压解析约 2.55 秒，先用位置索引筛 STC=20 再解析约 675 毫秒。此处只是一轮测量；实现阶段应记录冷/热启动的 p50/p95，再决定缓存策略。

## CA 与 PA 的高潜可行性

CA、PA 均有完整数值；`ability_potential_range_code` 为空，不能从本库还原 PA 区间或成长概率。PA 是 FM 潜力能力字段，不等于球员会达到的未来 CA。本功能将 PA 排序放在独立的高潜名单中，不和当前属性相似度混成一个分数。FM26 官方青训指南也把 Current Ability、Potential Ability、位置和年龄作为分别判断/设置的维度，而不是一个混合分数。[FM26 青训招募指南](https://www.footballmanager.com/the-dugout/top-tips-for-youth-recruitment-fm26)

基于 2025-11-23 快照年龄，在至少一个位置评分 `>=15` 且具有有效 FM unique ID 的画像中，年龄不超过 23 岁且 `PA>=160` 的画像有 264 个，其中 240 个 `CA<160`；将 PA 门槛提高至 180 后有 16 个，其中 15 个 `CA<180`；提高至 186 后只有 4 个。这些是跨位置可行性探查，不是每个位置都能保证相同数量，也不是已经选定的产品阈值。对 Kane 这类高 CA 参考，隐式要求 `PA >= reference CA` 会显著缩小年轻候选池，不应作为默认。

全位置公式和高潜名单实验已经运行并独立核验，结果见[实验报告](multi-position-report.md)。

FM26 的角色适配另依赖位置熟悉度和角色关键属性；本产品没有要求用户选择具体战术角色，所以只称位置级属性相似，不宣称战术角色适配。[FM26 位置与角色说明](https://www.footballmanager.com/fm26/features/possession-out-possession-fm26s-new-tactical-evolution)

## 可执行的过滤与当前缺口

可以直接执行：位置评分、出生日期/快照年龄、CA 下限、排除参考球员、TopK、属性差距排序。

当前画像没有当前俱乐部、合同、工资、身价、转会费、现役/退役字段。`home_grown_club_*` 是青训信息，不能当作当前球队。`role_scores` 虽有 10 个派生角色分数，但 manifest 没有可审计的评分公式来源。

## 跨来源覆盖

- 当前 FM 画像中，44,321 条有已确认的 Reep 链接，58,387 条没有。
- 当前 Understat 库有 2026/27 赛季的 5 份五大联赛 league 快照，包含 2,191 个球员 ID。
- 其中 1,132 个 Understat ID 在身份注册表中有链接。
- 当前 FM 画像与这些实际 Understat 快照通过已确认 canonical ID 相交后，得到 1,122 条画像。

因此，推荐候选可以来自有稳定 FM ID 的未关联画像。Understat 适合给已确认关联的候选补充比赛证据；数据缺失不应改变 FM 属性差值。FM 2025-11-23 画像与 Understat 2026/27 观测应分别标明时间。

## 审计查询依据

```sql
SELECT COUNT(*) AS playerRows,
       COUNT(DISTINCT record_id) AS recordIds
FROM players;

SELECT COUNT(DISTINCT unique_id) AS distinctIds,
       SUM(unique_id IS NULL OR unique_id = '') AS missingIds
FROM players;

SELECT position,
       SUM(rating = 20) AS rating20,
       SUM(rating >= 15) AS atLeast15
FROM positions
GROUP BY position;
```

跨源统计使用三个只读连接：FM 当前 `players.unique_id`；`.data/reep/identity-with-fm.sqlite` 的 `bridges`（`namespace='player'`、`redirect_status='resolved'`、provider 为 fm/understat）；以及 Understat `source_snapshots` 的 league payload。按实际 source ID → canonical Reep ID 的集合求交，未使用姓名连接。
