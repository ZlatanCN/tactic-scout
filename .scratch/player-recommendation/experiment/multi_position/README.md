# 全位置公式实验复现

本目录包含独立于 STC-only 历史实验的全位置实现。

运行前提：本机已有 `.data/fm/profiles-v2.sqlite` 和 `position-feature-map.json`；实验只读数据库，不调用网关或网络。

```bash
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 \
/Users/zhujiayou/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -B \
.scratch/player-recommendation/experiment/multi_position/run_experiment.py
```

当前完整输出：`.data/recommendation-experiments/20261025-multiposition-v2/`。

复跑时先把 `config.json` 的 `runId` 改成尚未使用的目录名。先在终端 A 启动冻结监视器，再在终端 B 启动实验入口；入口在测试前留出开发选择冻结点。当前 v2 已完成，不能覆盖。

冻结监视器：

```bash
/Users/zhujiayou/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -B \
.scratch/player-recommendation/experiment/multi_position/freeze_test_artifacts.py
```

独立核验命令：

```bash
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 \
/Users/zhujiayou/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -B \
.scratch/player-recommendation/experiment/multi_position/verify_results.py \
--output .data/recommendation-experiments/20261025-multiposition-v2
```

每次复跑前先把 `config.json` 中的 `runId` 改成新的目录名。为确保测试集解封前锁住候选目录、查询集合和拟合参数，先在一个终端启动 `freeze_test_artifacts.py`，再在另一个终端启动实验入口。当前 `run_experiment.py` 会在开发选择后阻塞，直到冻结 helper 将候选目录、查询集合、拟合参数和开发选择哈希写入 `protocol-lock.json`。已完成的 v2 使用同等逻辑的一次性监视器；执行代码以 `run_experiment_frozen_v2.py` 保存。

首次尝试 `20261025-multiposition-v1` 在公式选择完成后因高潜覆盖汇总容器初始化错误而未生成完整报告和核验；它不作为结果使用。完整结果来自 `v2`。
