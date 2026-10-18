# 218 — 将预期追问暂停作为有效 Harness 终态

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Objective

让完整 Harness 能表达“这条需求应先向用户确认位置”的预期结果，并能验证用户回答后同案继续调查。正确暂停时，不应因尚未搜索而失败；回答后则应检查同案续跑、目标位置和完成态。

## Public seam

- 已确认的 Harness 公开接口 `evaluateLocalAgentScenario()`：验证预期位置澄清暂停，以及可选的同案补答后续跑。
- 现有本地 Harness CLI：通过自定义输入、`--expect-position-clarification` 和可选 `--answer`/`--expected-position`，重跑真实模型输入。

## Acceptance

- [x] 自定义场景可声明预期位置澄清暂停。
- [x] 正确的 `needs_input`、无报告、位置相关问题、零补答、无候选搜索/评估/Planner、等待用户进度会通过。
- [x] 未提问、问题主题不符、已错误进入候选/规划工作或状态与进度矛盾会失败。
- [x] 不把正常等待用户输入强制判成“候选搜索结果不明确”。
- [x] 带补答时必须确认同一案件继续运行、按确认位置检索并完成报告；首轮不能提前搜索，后续轮允许执行调查。
- [x] 原始 Qwen 输入的真实单轮暂停和同案补答续跑均由 Harness 通过；明确记录这些运行只验证需求理解与交互控制流，不评估候选排序质量。

## Answer

Harness 新增 `--expect-position-clarification`，并在 `evaluateLocalAgentScenario()` 验证暂停状态、问题主题、首轮没有候选/Planner 工作、等待进度；传入补答时，还验证同一案件续跑、目标位置搜索和报告完成。真实 Qwen 3.5 9B 原始输入单轮通过 1/1：6.2 秒，`needs_input`，一次追问，零工具调用和 Planner 决策。真实同案续跑也通过 1/1：首轮 `needs_input`，用户回答“那先看后卫，重点是参与出球和高位防守，年龄预算都不限”后，21.3 秒内完成 DEF 调查；4 次工具调用、1 次 Planner 决策，所有 Harness 检查通过。两次实验验证需求理解与交互控制流，不评估候选排序质量。

本地结果保存在 Git 忽略路径 `.data/evaluations/issue-211-live-qwen-clarification-pass-20261018.json` 和 `.data/evaluations/issue-218-live-position-resume-pass-20261018.json`。

## Comments

- 2026-10-18：真实 Qwen 已在 17.8 秒完成需求理解并进入 `needs_input`；无工具调用。Harness 失败仅由通用的“候选搜索结果必须明确”检查造成。此 issue 修复评测契约，不改变产品追问行为。
- 2026-10-18：位置追问场景已通过公开 Harness seam 的正向和反向验证。真实服务为 Ollama 0.35.1，模型 `tactiscout-qwen3.5:9b`，`reasoning_effort=none`、输出上限 8192；对话图单轮 6.2 秒完成理解并正确等待用户。适配器没有把原始 `finish_reason` 暴露给本 Harness，因此未记录该字段；真实行为未再出现长度上限错误。
- 2026-10-18：首轮位置追问 + 同案回答 + DEF 报告的真实续跑通过 1/1；此前失败的是 Harness 把“询问后继续调查”错误套用到“先询问再调查”的场景契约。修正后区分首轮与补答轮，定向 Harness/CLI 85/85、`pnpm build` 与 `git diff --check` 通过。未提交代码。
