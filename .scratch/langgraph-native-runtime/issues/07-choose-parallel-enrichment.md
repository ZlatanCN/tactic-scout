# 07: 决定并行 enrichment 去留

**What to build:** 对外部信号与历史档案 enrichment 做串行和并行配对比较，确认并行不会改变核心候选、报告证据、来源覆盖或失败语义，并确认有稳定延迟收益时才保留；否则删除并行实现。

**Blocked by:** 04, 06

**Status:** resolved

**Labels:** ready-for-agent

- [x] 冻结响应下，串行与并行臂的候选顺序、核心报告和证据身份一致。
- [x] 每支 enrichment 拥有独立超时、重试和失败覆盖语义。
- [x] 单个可选分支失败时仍能交付核心报告，并明确记录覆盖不可用。
- [x] 配对评测报告可复现的延迟收益；未达到门槛时删除并行分支和开关。
- [x] 采用后正常组合只保留一条 enrichment 执行路径。

## Answer

采用并行。5 组完整图冻结响应配对的报告、候选顺序和来源覆盖完全相同。每支加入 120ms 的冻结 I/O 延迟后，串行 p50/p95 为 280/326ms，并行为 158/163ms；5/5 组并行更快。历史档案分支失败时，核心报告仍完成，档案覆盖为 `failed`，PlayerElo 覆盖保持 `complete`。结果见 [`parallel-enrichment-paired.json`](../results/parallel-enrichment-paired.json)。

实现删除串行路由、重复节点和实验开关，只保留 LangGraph `Send` 并行 fan-out 与 join。`parallel-enrichment.test.ts` 另验证一支 5ms 失败、另一支延迟 100ms 的情况下，图会等待并保留成功覆盖后再交付报告。测得的是受控 I/O 延迟下的调度收益，不将其外推为实时供应商延迟预测。
