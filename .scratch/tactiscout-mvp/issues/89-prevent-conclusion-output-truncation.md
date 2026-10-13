# Give the conclusion Planner enough output budget to finish structured reports

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Prevent a large but valid scouting investigation from failing at final synthesis because the local model's structured conclusion is truncated at the configured output-token ceiling.

## Acceptance criteria

- [x] Default code, `.env.example`, and local `.env` set the output budget to 8,192 tokens.
- [x] The user's local Ollama configuration uses the updated budget.
- [x] A deterministic config test covers default, explicit setting, and invalid values.
- [x] Conclusion prompts and report-observation schema bound unnecessary free text; length truncation returns a user-facing recovery message.
- [x] A full local-model run over non-empty player data completes from repository search through LangGraph, Reviewer, and report without `finish_reason=length`; a live-source network failure is not counted as a successful data-backed run.
- [x] Harness checks pass for observed candidate-search, evidence, progress, and report contracts; ranking quality remains unclaimed.

## Comments

- 2026-10-08：真实 Qwen 9B/FPL 链路成功读取 79 条匹配候选、分页评估 30 人并搜索获准的球员报告语料；最终 Planner 等待 168.2 秒后返回 5,437 字符不完整 JSON，诊断为 `invalid_json` 且 `finish_reason=length`。本机和示例环境将输出上限从 4,096 调到 8,192，并添加配置边界测试；仍需完整复验。
- 2026-10-08：后续两次 8,192 上限整链重跑均在最终综合前被对话轮次中断；没有把它们算作通过。结论 prompt 已要求简洁 JSON，检索观察摘要限制为 280 字、最多 3 条；长度截断现在会告诉用户如何调整服务端配置。仍需完整复验。
- 2026-10-08：新增输出精简与诊断后，模型/结论策略/Harness 定向测试 29/29，FPL provider + Harness 测试 55/55，LangGraph 早停回归 1/1，API/Web 生产构建和 diff 检查通过。最新 live-model 进程被对话轮次中断，故不勾选整链及 Harness 全通过项。
- 2026-10-08：真实 Qwen 3.5 9B 对本地 Wyscout 2017/18 仓库完成成功数据路径，最终报告正常完成，未触发长度错误；LangGraph 使用 5 次 Planner 决策和 10 次工具调用，读取 60 条、评估 30 人，Reviewer 通过，28/28 Harness 检查通过，耗时 230.384 秒。报告明确限定历史赛季与有限样本、指出压迫指标缺失，并说明球员报告语料 0 命中；该次不声称推荐排序质量。同期 FPL 在线查询持续遇网络错误，因此没有把 FPL 失败回退计作成功的数据丰富度验收。

## Answer

将模型输出预算默认值、示例环境和本机 `.env` 提高到 8,192，并压缩结论阶段的自由文本与观察摘要。新增的真实本地模型整链运行在非空 Wyscout 历史数据仓库上，成功完成候选发现、分页读取、表现评估、报告检索、结论生成及 Reviewer 复核；最终报告通过 28 项 Harness 检查，没有发生 `finish_reason=length`。FPL 在线源在本次验收时网络不稳定，因此它的失败回退单独记录，未作为数据丰富度成功证据。报告对历史样本、能力缺项和 RAG 零命中均作了明确说明，推荐准确率仍未评估。

### Comments

- 2026-10-08：后续从当前 FPL 工作台真实运行发现另一阶段仍可能出现 `finish_reason=length`：候选扩页后的第 5 次 Planner 决策在 10 人评估和 0 条球员报告命中后等待约 5 分钟并终止。此前本 issue 的成功验收只覆盖 Wyscout `curated` 场景的最终结论阶段。将扩页 Planner 提示词单独记录为 [issue 97](97-compact-expansion-planner-prompts.md)，不撤销本 issue 对最终结论输出的修复结论。
- 2026-10-08：按 issue 97 精简扩页提示后，同一工作台 FPL 需求在约 90 秒内到达 Reviewer 和报告，未再出现 `finish_reason=length`，说明扩页阶段单次复验通过。该报告仍因空球员报告库的检索/embedding 路径失败，并由重复动作保护器提前收束；后续修复和完整验收见 [issue 98](98-short-circuit-empty-rag-corpus.md)。
- 2026-10-08：修复空球员报告语料检索后，工作台读到方法资料、候选并评估 10 人，RAG 空命中正常结束；扩页决策又持续 6 分钟以上并被停止。扩页阶段新增独立、默认 1,024 token 的输出预算和专属恢复提示；该处理不改变本 issue 的 8,192 token 报告合成预算。
- 2026-10-08：在 [issue 97](97-compact-expansion-planner-prompts.md) 记录一次独立问题：小模型的扩页 JSON 可在 1,024 token 内被截断。最新本机 Wyscout Harness 已在 LangGraph 中按能力覆盖回退到精确下一页，并在 Reviewer 后完成报告（28/28 检查通过）；最终综合截断与扩页截断分别处理。
