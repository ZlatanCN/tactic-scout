# Label evidence-backed players as follow-up scouting leads

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Make the report distinguish evidence-backed players worth investigating from a complete recruitment recommendation, especially when key requested abilities have missing or partial evidence.

## Context

The live FPL report said it could not generate a complete recommendation because important dimensions were missing, then placed its evidence-backed players under the heading “候选推荐”. The body already limits these players to follow-up priority, but the heading makes the conclusion feel contradictory.

## Acceptance criteria

- [x] The player list is labelled “后续考察线索” when it describes candidates for human follow-up.
- [x] Supporting copy says the order is a research priority based on observed evidence, not an objective ability ranking or transfer decision.
- [x] Comparison controls remain understandable and keyboard accessible after the label change.
- [x] Web production build succeeds and the live report view shows consistent wording.

## Comments

- 2026-10-09：Issue 97 的真实浏览器验收暴露该文案冲突；本轮 FPL 报告只有进球/创造机会部分覆盖，射门终结/进攻接应缺失，Agent 明确表示无法生成完整推荐，但分区标题仍叫“候选推荐”。
- 2026-10-09：报告列表改标“后续考察线索”，并说明排序只代表建议优先核实的线索，不是能力排名或转会结论。Web 生产构建通过。在隔离 Vite 预览端口 5175 完成实时 FPL→LangGraph→报告验收：输入“为阿森纳找一个能进球也能创造机会的前锋”，报告正确显示部分/缺失能力证据和新标题；两名候选并排比较可用，原生复选框以空格键切换后比较表按选择显示/收起。当前两人仅有 29/71 分钟样本，界面保留小样本说明；此单轮演示不验证排序准确性。原有端口 5173 的 Vite 进程仍保留旧的运行时模块，本次没有中断它；新界面由 5175 预览提供。

## Answer

报告将证据支持但仍需人工复核的球员标为“后续考察线索”，并说明排序只表示建议的核查优先级，不代表客观能力排名或转会决定。Web 构建与隔离预览中的实时报告、两人比较和键盘操作均已验收；这次 UI 验收不评估候选排序准确性。
