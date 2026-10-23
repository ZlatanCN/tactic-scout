# 06: 本地专用重排模型与现有路径对照

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: 04: 自动生成带原文区间的检索基准。

## What to build

维护者能用同一冻结检索题包比较混合基线、当前网关排序和一个本地 Cross-Encoder，并根据质量和系统成本决定默认排序方式。

## Acceptance criteria

- [x] 本地模型权重、revision、精度、tokenizer、双句输入长度、评分规则和缓存签名可追溯；查询/片段窗口上限被校验，不静默截段。
- [x] 本地模型在调查开始前预加载；不能在本地原生推理时及时取消的迟到分数不得写入已完成调查。
- [x] 对比同一 query、完整候选池下的排序/事实组覆盖，另报冷/热启动、p50/p95、峰值内存、token/外呼和失败率。
- [x] 排序 logit 不被称为置信度；本地候选不执行低相关拒绝，因此没有未经校准的拒绝阈值；候选未经验收不能取得生产回退资格。
- [x] 即使本地候选无收益，该票仍交付可重复对照与有依据的模型选择结论；通过实验决定使用本地、网关或不重排。

## Answer

已固定本地 BGE Cross-Encoder 的模型 ID、revision、q8 精度、tokenizer 配对输入与 512 token 窗口；超窗拒绝而不截断，logit 只用于候选排序，没有实现或暗示置信度阈值。对 12 题开发样本，local 与 hybrid 的 evidence coverage 都为 1.00，但 local 的 MRR 约 0.905（hybrid 为 1.00），median ranking latency 约 3.1 秒（hybrid 约 27 ms）；gateway reranker 在该样本 coverage 约 0.714。以现有证据，保留 hybrid 作为检索基线，local 不取得生产资格。此对照仅是小型开发诊断；完整 Agent 验收未通过预算门而未运行。
