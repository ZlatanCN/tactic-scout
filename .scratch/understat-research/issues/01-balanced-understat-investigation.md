Type: task
Status: resolved
Labels: ready-for-agent
Blocked by:

# 平衡扩展 Understat 球探调查

## Outcome

让 Understat 的主要字段进入候选比较与证据解释，同时避免全库预抓逐场明细和向模型倾倒原始 JSON。

## Scope

- 五大联赛完整赛季目录作为跨联赛发现池；缺少软偏好证据不得淘汰候选。
- 候选组细查一次最多 12 人、并发不超过 4；用户明确要求或目录数据存在可由详情补足的证据缺口时，按需读取位置、赛季、近期和射门情境分布。
- 原始响应按本机 SQLite 快照缓存。最终报告给重点摘要和可展开档案；比赛/逐次射门和球队数据作为可选深查。
- 用同数据/模型/预算的消融评估目录搜索、固定档案包和 LangGraph 动态调查的增量作用。

## Acceptance

- Understat 来源 ID 限制、端点、SQLite 重启复用、刷新/取消/限流行为有回归覆盖。
- 替补 `S` 不再被当成前锋；位置拆分保留赛季及来源指标；未知值不伪装成 0。
- 候选组细查进入 LangGraph 状态与报告投影，UI 可读、默认不展开原始事件表。
- 消融固定快照、运行配置与预算，报告行为质量代理和成本；无球探金标准时不声称真实引援准确率。

## Answer

- 实现了 Understat 分组调查、SQLite 原始快照与解析版本重放，并把位置、赛季、近期和射门情境证据接入 LangGraph 评估与报告档案。只对明确用户意图或已发现的证据缺口读取详情。
- 修复了自适应调查在已找到候选尚未评估时就追问或结束的问题；整图回归确认会先评估所有待处理候选，再允许追问或结束。
- 使用相同冻结快照、本机模型和三组配对运行完成目录、固定资料、LangGraph 自适应三臂对照，并记录每组详情覆盖人数。固定和自适应在本登记场景没有改变推荐顺序或证据覆盖；自适应没有选取详情字段，因此字段规划增益尚未得到证明。结论与边界详见 `../spec.md` 的“实测结果”一节；最新原始汇总在 Git 忽略的 `.data/evaluations/understat-research-ablation-v5.log`。
- 验证：`pnpm test` 通过 508 项；`pnpm build` 通过；`git diff --check` 通过。目录组通过全部 Harness 检查；固定与自适应组均生成报告且完成证据复核，但各自三次只因通用 `usedMultipleModelActions` 检查未通过，因此 CLI 按预期以非零状态收尾。
- 产品决定：首轮使用目录统计；详情按需读取。该登记场景没有球探排序金标准，不能据此宣称真实引援准确率或动态字段选择优于固定流程。

## Comments

- Reopened during implementation review to align production Planner instructions with the measured decision to read details on demand; prompt and per-player coverage tracing are now implemented and verified.
