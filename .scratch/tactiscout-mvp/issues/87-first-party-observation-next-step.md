# Offer a first-party observation as a next step when evidence is missing

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

When a completed investigation returns no recommendations because requested capability evidence is missing or incomplete, give the user a contextual next step to record a match-based first-party observation.

## Scope

- Show the action only for a completed report with no recommendations, evaluated candidates, and at least one requested capability with incomplete direct evidence.
- Open the existing player observation dialog through one callback; keep storage and AI/RAG consent in that dialog.
- Explain that an observation is human-authored and tied to match context, and can be considered by later investigations only if AI/RAG processing is separately allowed.
- Do not imply an observation fills objective metric gaps, guarantees a shortlist, or changes the current report.

## Acceptance criteria

- [x] A full conversation that reaches a zero-recommendation report with missing requested-capability coverage shows a clear observation-recording next step.
- [x] Activating the action opens the existing observation dialog and leaves both consent controls unchecked; no record is saved automatically.
- [x] Reports with recommendations, no evaluated candidates, or no requested-capability evidence gap do not show this action (verified against the rendering predicate).
- [x] At desktop and narrow viewport widths, the action and its explanation remain readable and keyboard accessible.

## Comments

- 2026-10-07：issue 86 的真实 FPL 对话显示，Agent 已能正确说明“推进/压迫”缺少直接指标并返回空名单，但报告只建议用户继续补充需求。为第一方比赛观察提供一个受限、可解释的后续入口。
- 2026-10-07：`pnpm build:web` 通过。完整浏览器链路使用阿森纳中场需求跑至 FPL → LangGraph → 报告：13 个阶段、298 条匹配、读取 60 条、评估 30 人；“推进”和“压迫”均为 0/30 直接证据，报告无推荐并显示入口。点击后打开现有观察弹窗，两个许可复选框均为未勾选，记录数仍为 0；关闭后焦点返回入口。390px 窄屏下 document/body 宽度均为 390px，入口 328px、单列布局，按钮高 40px，无横向溢出。

## Answer

在报告里增加了“记录第一方观察”入口。它只在调查已完成、没有推荐、已评估候选且用户点名的能力存在直接证据缺口时出现；追问或重新分析期间隐藏。入口复用既有观察记录弹窗，并说明主观观察不能替代客观指标；后续调查只有在本地保存和 AI/RAG 处理分别获准后才可能检索记录。

真实本机 Qwen/FPL 对话跑通仓库查询、LangGraph 规划与工具执行、候选评估、Reviewer 和最终报告。打开弹窗不会保存记录，也不会勾选许可；窄屏与键盘焦点返回已人工核对。该验收证明这条行为与 UI 链路可用，不证明球探观察能补齐缺失统计或提高候选排序准确性。
