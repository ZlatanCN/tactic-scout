# Give the LangGraph Planner a structured capability coverage signal

Type: task
Status: resolved
Labels: ready-for-human

## Goal

Pass a compact, deterministic summary of requested capability evidence into constrained Planner decisions. The Planner should know which requested dimensions are observed, partially covered, or unavailable across the evaluated sample, then use that signal when deciding whether another candidate page is worth reading or whether to conclude with a disclosed gap.

## Why now

The Reviewer already rejects recommendations that cite unrelated measures when a relevant measure exists, and the report names missing dimensions. The Planner currently has to infer coverage from long tool history. This hides useful case state and makes it harder to explain or evaluate LangGraph's next-step decisions.

## Acceptance criteria

- [x] Capability intent recognizes additional dimensions only when the evaluation schema has a relevant metric; unsupported traits stay explicit gaps rather than being replaced with a nearby proxy.
- [x] Constrained Planner input contains requested dimensions, observed metric keys, evaluated-candidate counts, and a deterministic `missing` / `partial` / `observed` status.
- [x] Expansion guidance uses coverage as one decision signal, keeps user filters/cursors unchanged, and does not promise that more candidates will fill a gap.
- [x] The deterministic Harness rejects a report that omits an unsupported requested-trait limitation and accepts an explicit gap.
- [x] Graph-level tests prove the Planner receives correct coverage for both observed and unsupported requested traits.
- [x] Domain context, architecture README, this issue, and the issue map describe the same behavior.
- [x] Type checks and focused tests pass; no real-model result is implied by deterministic tests.

## Answer

LangGraph now computes requested capability coverage from actual evaluated evidence and includes it in constrained Planner context. Each requested dimension carries its candidate coverage count, observed metric keys, and `missing`, `partial`, or `observed` state. The expansion prompt allows one more page when a measurable user requirement is under-covered, while preventing extra searches for a trait with no corresponding metric in the current evaluation schema.

The evidence map covers progression, pressure events, chance creation, off-ball runs, defensive event participation, shot-opportunity quality, and high-intensity running. It deliberately does not treat pass completion as pressure-resistant possession, xG as finishing skill, or tracking distances as speed. Reports preserve these unsupported traits as data gaps. The Harness now checks that limitation, and a graph-level fake-Planner test proves coverage reaches the actual Planner seam.

Verification: 40 focused policy, prompt, and Harness tests plus 1 graph integration test passed; `pnpm build` and `git diff --check` passed. At implementation time, no real-model run had been performed; a later real-model revalidation is recorded below.

## Comments

- 2026-10-05：用户要求将工作重心放在 LangGraph、Agent、Harness 和 UI/UX。此次从能力覆盖决策信号入手，保持自然语言输入，不增加筛选表单。

### 2026-10-05 — 本机 Qwen 端到端复验

使用本机 `qwen3.5:9b` 对 `barcelona-under-23-midfielder` 运行一次真实 LangGraph 调查。Planner 连续决策并驱动候选分页、表现评估和球员报告检索；Reviewer 首轮要求补查，之后复核通过，整场 Harness 硬性行为检查 `allPassed: true`。安全 trace 显示候选分页按 offset 0、20、40 前进，没有跳过用户筛选条件。该结果验证一次真实执行能完成该链路，不代表长期稳定性、推荐排序准确性或历史数据的现役适用性。
