# 全位置公式实验运行记录

Status: resolved
Labels: ready-for-agent

- `20261025-multiposition-v1`: 完成了公式排名和 RMSE 测试确认，但在高潜列表覆盖汇总阶段遇到报告生成异常；没有报告和独立核验，因此不作为结果。
- `20261025-multiposition-v2`: 修复汇总逻辑后从头完整重跑。该版本通过所有数值检查，生成 RMSE 全局暂定选择、潜力名单、属性组消融和独立逐条核验。执行的 runner 以 `run_experiment_frozen_v2.py` 字节级保存，lock 校验其哈希。具体证据见 [实验报告](../../multi-position-report.md) 和结果目录中的 `verification.json`。当前 `run_experiment.py` 另加测试前冻结屏障，供后续新 runId 复跑使用。

第一次尝试保留在被忽略的 `.data/recommendation-experiments/20261025-multiposition-v1/`，不覆盖、不参与选择。v2 的测试前冻结通过一次性监视器完成；本目录保存了供后续新 runId 使用的可复现冻结脚本。

报告公式表的 MAE 行已作纯文字更正：它是基线，不是对照；数据、选择和报告数值不变。
