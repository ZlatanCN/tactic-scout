# 206 — 诊断规划等待与扩围输出截断

Type: task
Status: resolved
Labels: ready-for-agent

## Objective

按 diagnosing-bugs skill，复现 issue 205 手测中的扩围规划等待和“后续扩围未完成”，先测量并最小化，再验证单变量修复。保留原模型、输入、预算和 LangGraph 调查策略。

## Feedback loops

- 固定实际 checkpoint：2026-10-14 08:54:29 UTC，20 名候选已评估，已批准 ATT 扩展，下一页游标可用。输入保存在 Git 忽略的 `.data/evaluations/planner-diagnosis/input.json`。
- 原始真实模型命令：`DIAGNOSIS_BUDGET_MS=65000 node --import tsx .data/evaluations/planner-diagnosis/probe.ts`。检查是否产出可解析、符合真实 Planner schema 的动作；仅记录请求参数、用量、结束原因和 JSON 边界，无凭据和隐藏推理正文。
- 15 秒诊断窗口中原输入两次超时；去掉历史、减至一名候选、去掉能力覆盖仍超时；去掉最后一名候选约 9.3 秒完成。15 秒是缩短反馈周期的诊断预算，不是产品 SLA，也不能单独作为模型正确性判据。
- 1 名候选的小输入放宽诊断窗口后 18.4 秒完成；完整原输入 59.3 秒以 `length` 截断，无法产生动作。
- 快速回归：`node --import tsx --test tests/planner-output-bounds.test.ts`。从公开 Planner.decide 发真实本机 HTTP 请求检查线上 schema；修复前约 30ms 报 `undefined !== 10`，修复后通过。它验证结构约束，不模拟模型性能。

## Hypotheses

1. 含候选的输出结构使生成复杂且出现重复；约束输出结构应让相同输入完成。
2. 输出预算不足，实际输出被截断；真实结束原因应为 length。
3. 4096 本机上下文窗口使可输出 token 少于配置；prompt + completion 应达到窗口上限。
4. 本机解码速度是主要延迟来源；时间应随生成 token 增长。

## Evidence and causal probe

原完整请求：prompt 3338 token、completion 758 token、total 4096；输出配置上限仍为 1024。返回 `finish_reason=length`，没有推理正文，动作 JSON 未闭合。尾部的 limitationKeys 反复生成 contract / injury / market_value。

输出 schema 的 limitationKeys 数组没有 maxItems。它让结构化解码继续重复合法枚举项，最终耗尽本机上下文窗口；本机解码速度使重复生成同时表现为长等待。不能将所有延迟归因于历史或候选数。

只给实际 HTTP 请求的该数组增加 10 项上限，模型、提示词、候选、max_tokens 和请求模式均不变：21.6 秒完成，completion 365、total 3703，finish_reason=stop，动作有效。生产修复后再重放：23.3 秒完成，同为 365 个输出 token。

同一真实 checkpoint 进入原 createPlanningNode：21.6 秒选择 finish、3 名考察线索、policyBlocked=false、无 plannerFallback。说明原阶段不再因为此截断而输出“扩围未完成”。这里的 expand 是模型选择翻页/追问/收束的阶段，选择 finish 本身是合法行为，不要求读取全部市场。

## Fix

FinishActionSchema 的 limitationKeys 增加 `.max(10)`，与允许的十种限制枚举相符。此约束进入调查、扩围和结论请求的 JSON schema，也限制不遵守供应商约束的返回值。没有增加节点、模型调用、重试或上下文预算。

## Verification

- 真实 Planner HTTP 回归：红→绿。
- 全量 `pnpm test`：468/468 通过；`pnpm build` 通过。
- 原实际输入和原规划节点均使用生产修复通过；没有实验请求改写。
- 源码没有新增 DEBUG 日志；原始数据/临时探针均位于明确标识的 Git 忽略诊断目录，删除了最初没有到达正确阶段的捕获草稿。
- 暖缓存反向对照：仅移除新增上限后，44.1 秒再次返回 length、不完整动作 JSON、758 输出 token、总用量 4096；cached_tokens=3334 与修复组相同。因此不能把全部改善归于预热。

## Limits

仅固定本机 Qwen 3.5 9B、一次真实状态，不能据两次完成耗时推断一般 p95 或所有需求都不会超时。4096 上下文容量仍可能限制更大请求。修复不评价排序质量，也不把此次 finish 说成已覆盖全部市场。

## Commit message

fix(agent): bound limitation keys to stop repeated JSON generation exhausting local context

## Answer

已定位并修复原扩围阶段失败：无界 limitationKeys 允许重复枚举生成，耗尽本机上下文并使用户等待后收到兜底说明。单变量开/关和暖缓存反向对照均支持限制数组大小的因果作用；生产重放和原节点不再走截断兜底。正常本机生成仍约二十秒，其他超时/数据范围/推荐质量问题不在本次结论中。

## Sources

- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)：核对结构化输出与 reasoning_effort 字段；本次是否有推理正文以实际响应为准。
