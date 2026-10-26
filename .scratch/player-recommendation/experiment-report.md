# 中锋推荐公式对比与消融：离线实验报告

Status: resolved
Labels: ready-for-agent

**适用范围：仅 STC。** 本报告和 `selection.json` 中的 `rmse18` 是中锋实验的暂定工程结论，不是全位置默认。全位置、等权宏平均的后续实验尚未运行，见[全位置实验方案](experiments.md)。

运行日期：2026-10-25 18:28（Asia/Shanghai）。协议：`fm-stc-formulas-v1`。结果目录：`.data/recommendation-experiments/20261025-v1`。

结论状态：**provisional**。开发集预先选定 `rmse18`，测试集确认后默认保留 **`rmse18`**。没有独立替代相关性标签，本报告不宣称真实球员替代质量最优。

## 本轮实施决定

推荐工具后续先使用 **18 项 raw 属性、等权 RMSE**：`sqrt(sum((candidate-reference)^2)/18)`，展示为“均方根属性差”。候选仍需满足用户明确给出的年龄、位置、CA 等硬条件。

- 相对 MAE，测试 Top5 扰动稳定性提高 0.0717，配对95%区间为 [0.0390, 0.1038]；整体平均 CA 差变化 +0.0317。
- RMSE 的 18→10 属性消融使稳定性下降 0.102；这支持在本轮协议下保留18项，尚不能证明新增属性的现实替代相关性。
- 等组权重、完整相关性处理未提供足以替换简单默认值的工程证据。
- 标准化 RMSE 也是可保留的备选。RMSE 与它的测试稳定性差为 +0.0198，配对95%区间 [-0.0128, 0.0528]；该描述性比较未证明二者有可靠差异，仍遵守开发阶段冻结的选型。

选择记录见 `experiment/selection.json`。以下“复核补充”来自对冻结产物的独立检查，未修改运行配置或重选策略。

## 数据与实验隔离

- STC 且 `positions.rating=20` 的原始画像 15,410 条，共同有效实验域 15,409 条；排除原因 `{"missing_fm_id": 1}`。这里的 `rating=20` 是实验的数值筛选条件，不等于所有自然位置。
- FM 画像日期 `2025-11-23`；manifest SHA `431eecb0a892bf7be8e056832a6fd9e553f461d1b629fdd080ea31e847bd85eb`。
- 拟合身份 15,169，开发身份 120，测试身份 120；身份交集为零。候选目录固定，查询自身逐次排除。
- 标准化和收缩协方差只用拟合身份；同一查询与场景内，各算法使用相同候选池。21 个配置包含 7 个主公式、单因素消融和 2 个对照。
- 运行前配置 SHA `7196d034467a2f4909c29167dbb23bc122bfe475fe17206eb16b2fe044bed279`；数值检查 `{"passed": true, "checkCount": 19, "checks": {"mae_hand_computed": true, "rmse_hand_computed": true, "weighted_mae_hand_computed": true, "cosine_orthogonal": true, "cosine_positive_scale": true, "correlation_affine": true, "correlation_reversed": true, "centered_cosine_equals_correlation": true, "mae_l1_equivalence": true, "rmse_l2_equivalence": true, "undefined_norm_policy": true, "ledoit_wolf_official_example": true, "whitening_inverse_identity": true, "finite_shrinkage": true, "registered_strategy_count": true, "equal_feature_group_mass": true, "weights_frozen_before_feature_ablation": true, "diagonal_ablation_uses_same_shrunk_covariance": true, "all_strategies_finite_on_nonconstant_profiles": true}}`。
- 稳定性只用 open 场景、至少50名候选的查询选型。每个球员的扰动先合并，再按球员做2000次配对 bootstrap。
- 开发选型写入 dev-selection.json 并冻结后才开始测试。测试中其他公式仅作描述性对比，不用于重新选赢家。

## 七类公式与对照

J5±2 是 Top5 在固定 ±2 点随机属性扰动下的 Jaccard，越高越稳定；CA 差为 open 场景 Top5 与参考的平均绝对 CA 差。两者均不是独立推荐相关性分数。

| 配置 | 开发 J5±2 | 测试 J5±2 | 测试 CA 差 | 热查询 p95(ms) | 解释 |
| --- | ---: | ---: | ---: | ---: | --- |
| mae18 | 0.559 | 0.588 | 7.45 | 1.10 | 水平接近候选 |
| rmse18 | 0.669 | 0.659 | 7.48 | 1.23 | 水平接近候选 |
| cosine18 | 0.603 | 0.621 | 20.19 | 1.11 | 风格方向，水平不敏感 |
| correlation18 | 0.579 | 0.594 | 25.34 | 1.25 | 风格方向，水平不敏感 |
| zrmse18 | 0.658 | 0.639 | 7.31 | 1.23 | 水平接近候选 |
| mahalanobis18 | 0.584 | 0.620 | 13.52 | 1.18 | 水平接近候选 |
| weighted_mae18 | 0.572 | 0.562 | 7.81 | 1.19 | 水平接近候选 |
| ca_only | 1.000 | 1.000 | 0.17 | 0.72 | 负对照，不参与选型 |
| random | 1.000 | 1.000 | 37.60 | 1.06 | 负对照，不参与选型 |

随机和 CA-only 对属性扰动不敏感，因此可出现稳定性满分；这正是不能只按稳定性选择公式的对照。余弦类仍完整测量，按风格目标解释。

## 预注册选择与测试确认

工程门槛：J5±2 相对 MAE 至少 +0.02 且95%区间下界>0；平均 CA 差增加不超过5；p95<50ms；评分水平敏感且名单非退化。这些是工程选择阈值，不是足球质量阈值。

| 测试比较（候选−MAE） | J5差值 | 95%区间 | CA差距变化 | 通过工程门槛 |
| --- | ---: | --- | ---: | --- |
| rmse18 | 0.072 | [0.039, 0.104] | 0.03 | 是 |
| zrmse18 | 0.052 | [0.016, 0.087] | -0.14 | 是 |
| mahalanobis18 | 0.033 | [-0.004, 0.071] | 6.07 | 否 |
| weighted_mae18 | -0.026 | [-0.056, 0.005] | 0.36 | 否 |

开发候选：`rmse18`；只对该候选执行晋级确认。最终工程默认：`rmse18`。

## 能力分层限制

| 参考 CA 范围 | 测试球员数 | MAE Top5平均 CA 差 | RMSE Top5平均 CA 差 |
| --- | ---: | ---: | ---: |
| 小于80 | 37 | 8.13 | 8.05 |
| 80–119 | 40 | 5.98 | 5.73 |
| 120–159 | 38 | 7.17 | 7.38 |
| 至少160 | 5 | 16.40 | 18.08 |

高能力参考球员只有5名，证据有限；整体 CA 差变化很小，不能据此宣称精英参考群体也等价。凯恩、哈兰德案例应结合明确的 CA 下限解释资料覆盖，而不是承诺找到同能力替代者。

## 单因素消融

下表使用同一批测试身份，差值为变体减去父配置；仅作预注册消融描述，未根据测试结果重新组合默认策略。

| 变体 | 父配置 | J5±2变化（95%区间） | CA差变化 |
| --- | --- | --- | ---: |
| mae10 | mae18 | -0.121 [-0.158, -0.084] | 1.97 |
| rmse10 | rmse18 | -0.102 [-0.142, -0.062] | 1.29 |
| cosine10 | cosine18 | -0.088 [-0.128, -0.045] | 1.50 |
| correlation10 | correlation18 | -0.144 [-0.183, -0.103] | 3.61 |
| zrmse10 | zrmse18 | -0.089 [-0.132, -0.045] | 1.77 |
| mahalanobis10 | mahalanobis18 | -0.116 [-0.156, -0.076] | -1.70 |
| weighted_mae10 | weighted_mae18 | -0.087 [-0.124, -0.049] | 1.17 |
| zmae18 | mae18 | -0.016 [-0.039, 0.007] | -0.16 |
| mahalanobis_diag18 | mahalanobis18 | 0.019 [-0.019, 0.058] | -6.21 |
| mae_no_physical | mae18 | -0.060 [-0.096, -0.024] | 3.26 |
| mae_no_finishing | mae18 | -0.029 [-0.061, 0.004] | 1.39 |
| mae_no_link | mae18 | -0.097 [-0.130, -0.064] | 3.12 |

属性权重消融由 weighted_mae18 与 mae18 对比；权重按 physical/finishing/link 三组等总权重固定，各组内等权。10项变体保留原18项权重后取子集，避免同时改变两项因素。

## 条件覆盖与运行成本

正确性断言：`{"failures": 0, "developmentRankingChecks": 7560, "testRankingChecks": 7560, "determinismAndPermutationChecks": 57, "sourceIdentitiesDisjoint": true}`；位置、年龄、CA、本人排除、重复ID、有限距离、重复排名和候选排列一致性均检查。

独立的 `verify_results.py` 再次逐条检查15,120条排名，重算候选资格与CA差，核对各公式候选池、TopK长度、分数排序/并列、身份隔离及冻结文件SHA，全部通过。结果保存在 `verification.json`。

| 场景 | 测试查询数 | 最小候选池 | 空池 | 少于5人 | MAE CA差 |
| --- | ---: | ---: | ---: | ---: | ---: |
| open | 120 | 15408 | 0 | 0 | 7.45 |
| u25 | 120 | 10078 | 0 | 0 | 8.07 |
| u25_ca160 | 120 | 4 | 0 | 2 | 71.81 |

严格的“不超过25岁且CA至少160”在当前 STC 且 `rating=20` 的快照里只有5个候选身份；当参考球员本身也在集合中时只剩4人。因此生产工具应如实返回少于TopK的结果和过滤人数，保持用户的硬条件。

共同读取解压 1121.0ms；拟合和候选变换 9.7ms；整个实验 55.4s。进程峰值 RSS 约 198.3MiB（共享进程，非单公式独占）。
热查询基准为已有画像矩阵上的算分+稳定Top10排序，排除 SQLite/模型耗时；首次测量也不等于操作系统无缓存冷启动。各公式不宜仅凭毫秒级差异宣称显著更快。

## Understat 辅助切片

STC 且 `rating=20` 的画像关联覆盖：`{"0": 135, "90": 110, "450": 36, "900": 0}`；至少450分钟的联赛记录：`{"Bundesliga": 4, "EPL": 11, "La_liga": 8, "Ligue_1": 4, "Serie_A": 9}`。只对同联赛且至少6人的小集合做Top5诊断。

| 配置 | 查询记录/唯一球员 | npxG/90差 | xA/90差 | 射门/90差 | 关键传球/90差 |
| --- | ---: | ---: | ---: | ---: | ---: |
| mae18 | 28/28 | 0.212 | 0.093 | 0.941 | 0.451 |
| rmse18 | 28/28 | 0.207 | 0.092 | 0.932 | 0.464 |
| cosine18 | 28/28 | 0.220 | 0.093 | 0.956 | 0.475 |
| correlation18 | 28/28 | 0.236 | 0.097 | 0.932 | 0.459 |
| zrmse18 | 28/28 | 0.202 | 0.092 | 0.916 | 0.467 |
| mahalanobis18 | 28/28 | 0.215 | 0.093 | 0.946 | 0.471 |
| weighted_mae18 | 28/28 | 0.212 | 0.092 | 0.923 | 0.459 |

这些表现差只作探索性诊断：样本少、Top5几乎覆盖小候选池，且FM2025-11-23与比赛2026/27存在时点差。缺失资料没有作为负标签，此切片未参与默认选型。

## 真实参考球员案例

### Harry Kane（CA 186）

| 公式 | Top5（姓名／CA） |
| --- | --- |
| mae18 | Serhou Guirassy／160；Robert Lewandowski／156；Deniz Undav／153；Kai Havertz／157；Nick Woltemade／161 |
| rmse18 | Serhou Guirassy／160；Robert Lewandowski／156；Deniz Undav／153；Nick Woltemade／161；Kai Havertz／157 |
| cosine18 | Marvin Ducksch／116；Adrián Ramos／105；Ytalo／94；Ángelo Rodríguez／106；Mehdi Taremi／133 |
| correlation18 | Marvin Ducksch／116；Adrián Ramos／105；Carlos Bacca／105；Radamel Falcao／107；Fredy Montero／106 |
| zrmse18 | Serhou Guirassy／160；Robert Lewandowski／156；Deniz Undav／153；Nick Woltemade／161；Mehdi Taremi／133 |
| mahalanobis18 | Serhou Guirassy／160；Kasper Dolberg／138；Alexandr Sobolev／131；Mateo Cassierra／133；Deniz Undav／153 |
| weighted_mae18 | Serhou Guirassy／160；Robert Lewandowski／156；Deniz Undav／153；Patrik Schick／152；Kai Havertz／157 |

- Kylian Mbappe：当前 STC 且 `rating=20` 实验域未唯一定位。
### Erling Haaland（CA 187）

| 公式 | Top5（姓名／CA） |
| --- | --- |
| mae18 | Serhou Guirassy／160；Alexander Isak／170；Victor Osimhen／162；Mateo Retegui／157；Ferran Torres／163 |
| rmse18 | Serhou Guirassy／160；Victor Osimhen／162；Dušan Vlahović／154；Mateo Retegui／157；Franculino／147 |
| cosine18 | Erick Monteiro／87；Ikhsan Fandi／104；Budu Zivzivadze／122；Alessandro Corti／82；Felipe Vizeu／118 |
| correlation18 | Maelo Rentería／91；Mark Taga'i／32；Rudi Almeida／89；Tim Lemmen／68；Erick Monteiro／87 |
| zrmse18 | Victor Osimhen／162；Franculino／147；Alexander Isak／170；Dušan Vlahović／154；Mateo Retegui／157 |
| mahalanobis18 | Franculino／147；Darwin Núñez／147；Samu Aghehowa／149；Serhou Guirassy／160；Rwan Cruz／125 |
| weighted_mae18 | Serhou Guirassy／160；Victor Osimhen／162；Alexander Isak／170；Mateo Retegui／157；Marcus Thuram／167 |

### Troy Parrott（CA 138）

| 公式 | Top5（姓名／CA） |
| --- | --- |
| mae18 | Tommy Conway／128；Rodrigo Castillo／128；Lucas Stassin／133；Igor Jesus／138；Julián Carranza／130 |
| rmse18 | Tommy Conway／128；Igor Jesus／138；Lucas Stassin／133；Julián Carranza／130；Rodrigo Castillo／128 |
| cosine18 | Hamish McCabe／85；Ettore Gliozzi／118；Tommy Conway／128；Gonçalo Gregório／113；Chuma／95 |
| correlation18 | Marcus Antonsson／100；Róbert Polievka／112；Hamish McCabe／85；Antonio Morán／43；Jeff Crowe／34 |
| zrmse18 | Tommy Conway／128；Igor Jesus／138；Lucas Stassin／133；Julián Carranza／130；Josh Sargent／127 |
| mahalanobis18 | Tommy Conway／128；Rafa Mujica／132；Mattia Bortolussi／119；Romeo Vermant／125；John Posselt／105 |
| weighted_mae18 | Tommy Conway／128；Lucas Stassin／133；Igor Jesus／138；Julián Carranza／130；Tasos Douvikas／141 |

## 复现与结论边界

复现命令和环境见 experiment/README.md；原始排名、查询ID、拟合参数、配置锁和聚合保存在本次结果目录。summary.json包含完整分层指标与公式元数据。

本轮没有NDCG/Recall等真实相关性结果，因为没有独立替代标签。以MAE或其他参赛距离生成真值再比较会造成循环评测。工程默认属于可解释的暂定选择，未证明真实战术、转会或长期表现上的最佳替代效果。
