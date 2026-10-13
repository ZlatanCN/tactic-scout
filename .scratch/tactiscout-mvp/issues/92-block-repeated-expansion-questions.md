# Block repeated expansion questions and unsupported report claims

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Ensure a full LangGraph scouting conversation does not ask again for position-expansion approval the user already gave, and does not present an empty player-report search as retrieved evidence.

## Why now

A real Qwen 3.5 9B run over the curated Wyscout warehouse reached the candidate-expansion decision after the user had approved other forward positions. The Planner asked for the same approval again and described player reports despite a zero-hit report search. That left the conversation waiting for another answer instead of completing the agreed investigation.

## Acceptance criteria

- The graph records approval given in response to a deterministic empty-position question and resets that approval when a new user turn starts.
- During candidate expansion, a repeated position-broadening permission question is policy-blocked and handed to the constrained `expand_recovery` decision.
- If player-report retrieval ran and returned no player-report documents, an `ask_user` action cannot claim findings from retrieved reports.
- New questions that do not repeat position approval and do not assert nonexistent reports remain eligible for ordinary Agent policy review.
- A deterministic conversation-graph regression verifies the approved scope, empty report corpus, policy feedback, recovery decision and grounded final response.
- The full local-model run completes through the dataset, multi-turn LangGraph investigation, Reviewer and report, and passes all recorded Harness checks.

## Answer

Added `positionBroadeningApproved` to the case state and two policy checks at the Planner decision boundary. Repeated scope approval and claims based on a zero-hit player-report retrieval now route through `expand_recovery`, where the Planner can only continue at the exact next candidate cursor or finish a bounded report. This preserves ordinary clarifications outside those two failure conditions.

Validation:

- `node --import tsx --test tests/expansion-question-guard.test.ts`: 1/1 passed.
- `node --import tsx --test tests/recruitment-conversation.test.ts`: 33/33 passed.
- `pnpm build`: passed.
- Full local `qwen3.5:9b` run against the curated Wyscout 2017/18 warehouse: 26/26 Harness checks passed in 362.416 seconds. The same case used three user turns and two clarifications; the Planner's repeated expansion/report question was policy-blocked and the recovery decision completed the Reviewer-backed report. It evaluated 10 candidates from 40 read records, searched 601 matching historical records, retrieved two methodology chunks and zero player-report chunks.

This one run validates the conversation and evidence-boundary contract, not recommendation accuracy, current-player coverage or long-run model reliability. The dataset is historical and cannot establish current club, age or transfer feasibility.

## Comments

- 2026-10-08：真实全链路复现了“用户已同意扩围后再次问是否扩围”以及“球员报告 0 命中但 Planner 声称报告中有样本”。已在 LangGraph 策略边界增加确定性反馈，并由受约束的恢复决策收尾；完整 Wyscout/Qwen 链路 26/26 检查通过。
- 2026-10-09：`expand_recovery` 的压缩上下文现保留最近一次策略拒绝原因，避免恢复节点在隐藏关键反馈后重复提出被拒绝的问题；其他历史工具结果仍压缩。Planner-context 定向测试及当前 330 项完整套件通过。
