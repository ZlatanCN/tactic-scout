# 06: 确定并保留一种上下文管理方案

**What to build:** 在相同完整图、模型、冻结证据数据和补答脚本下，对现有上下文管理模式进行配对比较。先用硬正确性门槛筛选，再比较报告质量、延迟、token 与复杂度，最终只保留一种默认行为并删除落败路径。

**Blocked by:** 03, 04

**Status:** resolved

**Labels:** ready-for-agent

- [x] 实验臂使用同一张已编译图，并使用显式 CLI 开关只改变待比较的上下文机制。
- [x] 硬门槛覆盖报告完成、最新条件覆盖、恢复连续、候选与证据保留、无重复副作用、无被拒身份泄漏。
- [x] 通过硬门槛后报告通过率、失败检查、p50/p95 延迟、模型调用和可用 token；缺失遥测保持未知。
- [x] 用现有 `pnpm eval:local-agent` 产出可复核的配对结果。
- [x] 选中一种默认上下文路径，删除落败模式、长期实验开关及专用死代码。
- [x] 完整测试和代表性本地案件验证赢家路径。

## Answer

采用 `projection`。同一完整图、`codex/gpt-6-luna`、冻结数据 SHA-256 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f` 和交错五组运行中，`projection` 与 `unified` 均通过全部硬门槛（5/5），并完成全部 20 个压力补答；`projection` 的 p50/p95 为 203020/244654ms，`unified` 为 279913/295157ms；模型请求为 123/195，可用输入 token 总量为 4232909/7435525。因而在通过门槛的臂中选择延迟、调用数和 token 都较低的 projection。两臂最终候选顺序并非逐组完全一致，因此结果不声称逐项输出等价或模型质量排名。

其余臂先按正确性门槛淘汰：`legacy` 3/5、`evidence` 2/5、`summarized` 4/5；摘要臂仅 4/5 运行实际接受经过验证的摘要，故该实验机制门槛失败。`evidence` 臂的输入 token 遥测不完整，保留为未知，不做估算。证据来自 [`context-management-full.log`](../results/context-management-full.log) 与 [`context-management-paired-summary.json`](../results/context-management-paired-summary.json)。实验后已删除其他模式、比较开关和专用测试；正常图只保留 projection。
