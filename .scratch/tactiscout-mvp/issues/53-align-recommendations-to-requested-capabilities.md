# Keep recommendation evidence aligned with the requested abilities

Type: task
Status: resolved
Labels: ready-for-human

## Goal

Make each recommendation answer the player's role and capability needs expressed by the user. When the data exposes a relevant measure, prioritize it in the recommendation evidence; do not use unrelated available statistics as a substitute.

## Why now

A real Qwen 3.5 9B run completed the Barcelona under-23 midfielder case after three candidate batches. It recommended a 69-minute sample and cited pass completion and ground duels as the key evidence, while the user had explicitly asked for progression and pressing. The report did contain a progressive-passing metric for that player, but the recommendation did not cite it; the Harness correctly failed `requestedCapabilitiesGrounded`. The newly added sample-percentile invariant passed.

## Acceptance criteria

- [x] The conclusion Planner is explicitly instructed to connect each recommendation's cited evidence to the user's stated abilities and role.
- [x] A relevant observed metric may support further scouting even with a low sample, but the sample risk must remain explicit; a low-sample metric receives no percentile.
- [x] If requested abilities are unavailable, the report names those data gaps; unrelated metrics do not make the recommendation appear supported.
- [x] Deterministic Harness tests reject unrelated cited metrics when a requested metric is available, and accept directly aligned evidence or a clearly reported data gap.
- [x] A real local-model run is checked for the invariant; its result is not presented as ranking accuracy or a reliability guarantee.

## Answer

Recommendation review now maps the recognized progression and pressing requests to metrics available in the current evaluation schema. When a requested ability has relevant evidence, the LangGraph reviewer rejects a recommendation that cites unrelated evidence and feeds the exact available metric keys back for a retry. A relevant low-sample metric remains eligible as a limited scouting lead; the percentile policy suppresses its percentile and the report discloses the sample risk. When no relevant metric is available, report limitations and candidate tradeoffs name the gap.

The real local `qwen3.5:9b` run passed every Barcelona shortlist behavior check in 131.8 seconds. Its progress trace shows one evidence-review retry followed by a passing review. The sample percentile check also passed. This verifies one workflow run only; the Harness still marks recommendation ranking accuracy and RAG relevance as not evaluated.

## Comments

- 2026-10-05：以 `evaluateLocalAgentScenario` 作为公开行为 Harness seam、`conclusionInstructions` 作为 Planner prompt seam；这是本轮已授权的 agent/Harness 工作范围。
- 2026-10-05：真实 Wyscout 2017/18 数据中，本次推荐候选有渐进传球指标，但总样本仅 69 分钟；当前报告仍引用了不直接对应“推进/前场压迫”的传球成功率和地面防守对抗。需要让低样本直接相关指标以风险提示方式呈现，而不是替换为无关指标。
- 2026-10-05：仅靠 Planner prompt 未能改变真实 Qwen 结论。确定性结论复核现在识别用户明确提出的“推进”和“压迫”能力，并在已有对应指标却未引用时发起一次 LangGraph 重审；否定表达（如“压迫不是重点”）不作为能力要求。相关指标映射只覆盖当前可评估的推进与压迫维度，后续扩展能力词汇时需配套真实指标。
- 2026-10-05：Qwen 3.5 9B 本地 Barcelona Harness 实跑用时 131.8 秒，全场景行为检查通过；进度事件证明首轮证据审查触发重试，第二轮审查通过。此次结果不验证球员排序质量或重复运行可靠性。
