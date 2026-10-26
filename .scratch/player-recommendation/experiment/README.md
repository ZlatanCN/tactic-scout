# 本地公式实验入口

本目录现有入口、`config.json` 和 `selection.json` 是冻结的 **STC-only 历史实验**，不得覆盖或解释为全位置默认。全位置实验需要先冻结 position feature map，再按[新实验方案](../experiments.md)创建独立配置、入口和输出目录。

依赖 Python 3.12 和 NumPy 2.3.5；不安装新的项目依赖，不调用网关。应用的测试入口仍为 `pnpm test`（Vitest）。数值实验在此独立目录运行。

当前环境命令：

```bash
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 \
/Users/zhujiayou/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -B \
.scratch/player-recommendation/experiment/run_experiment.py \
--output .data/recommendation-experiments/20261025-v1
```

输出目录必须是新的 `.data/recommendation-experiments/` 子目录，避免覆盖已有实验。复跑时更换目录名。

完成后可用同一 Python 运行 `verify_results.py --output .data/recommendation-experiments/20261025-v1`，独立检查全部原始排名的硬条件、身份隔离、候选池、排序和冻结校验和；该入口不重跑选型。

## 运行前冻结的补充约定

- `config.json` 定义240个分层查询身份、开发/测试各120人、3个硬条件场景、19个数值配置和2个对照。全部身份与噪声种子可重现。
- 特征10/18完整且非零中心化范数的共同实验域固定在抽样前；若有记录因相关距离的定义域被排除，报告数量。该实验域规则不代表生产必须排除同样画像。
- 加权MAE按 physical/finishing/link 三组分配相等总质量；各组内部等权。它是预先冻结的假设，没有通过结果调参。
- 噪声来自统一的 ±1/±2 点均匀整数扰动（每级2次），以及3次相关属性组扰动；所有方法共享每个扰动。噪声恢复/稳定性不充当真实相关性标签。
- 拟合统计只使用未被选为查询的身份。检索目录本身固定，包含除当前自身外的查询身份作为其他查询的候选；这不提供测试标签给拟合阶段。
- 主要选型只在 open 场景、候选至少50人的查询上进行，按查询身份合并重复后bootstrap。条件场景和CA分层另行报告。
- 开发集只挑1个候选并先保存 `dev-selection.json`，测试集只确认这个冻结候选；其余测试结果属于描述性分析。若确认失败，保留MAE，不从测试结果再次挑选。
- 当前工程门槛预先固定为：±2扰动Top5 Jaccard平均提升至少0.02、95%配对区间下界大于0、CA平均差距增加不超过5、算分与Top10排序p95小于50ms，并通过数值/约束/非退化检查。门槛是工程假设，不是足球质量标签。
- 随机与CA-only为负对照；余弦与中心化余弦按风格方向目标展示，因为其缩放不敏感，不参与“绝对属性水平接近”的默认方案选型。
- Understat小样本按同联赛、至少450分钟且池内至少6人单列，报告4项per90差距，不参与选型；不计算伪NDCG。

## 输出

大规模原始画像、查询ID、逐查询排名、拟合参数、噪声结果和JSON汇总写入被忽略的 `.data/`。轻量可读报告写入上级 `experiment-report.md`，记录配置/脚本/数据校验和与环境。

数值入口在实际数据运行前检查手算例子、等价公式、常量向量，以及官方Ledoit–Wolf示例。源数据库均使用只读连接。

全位置实验的特征映射、配置、公式脚本和独立核验器位于 [`multi_position/`](multi_position/README.md)；已完成结果见[全位置报告](../multi-position-report.md)。
