# Evaluate attacking one-on-one evidence in the local Agent Harness

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Add a real-model Harness case that checks whether a natural-language attacking one-on-one request is investigated and reported using the new Wyscout ground-attacking-duel evidence.

## Acceptance criteria

- [x] The fixed scenario asks for an under-23 Barcelona forward with attacking one-on-one evidence, without prescribing a named player or ranking.
- [x] The evaluator checks the requested capability coverage maps to the Wyscout ground-attacking-duel rate and explicitly-won share.
- [x] If a recommendation has those metrics, the recommendation cites at least one relevant metric; if no metric is available, the final report explains the data gap.
- [x] The ordinary Harness trace exposes only safe tool/progress data and evidence keys, not prompts, model reasoning, or player names.
- [x] The registered scenario runs through `pnpm eval:local-agent -- --scenario barcelona-attacking-one-on-one-forward` against the configured local model and v2 Wyscout snapshot.
- [x] Record the real local run result and time without describing one run as a ranking-quality or reliability result.

## Research and design

- [Wyscout v2 event documentation](https://support.wyscout.com/matches-wyid-events) distinguishes Ground attacking duel from other duel types and defines result tags 701/702/703.
- [issue 69](69-wyscout-attacking-duel-evidence.md) carries those metrics from the local dataset through LangGraph into the structured report.
- The existing public Harness seam is `pnpm eval:local-agent`; ranking accuracy remains unmeasured because the project has no trusted scout-label dataset.

## Comments

- 2026-10-06：用户持续目标要求继续完善 LangGraph/Agent Harness；本切片检验真实模型能否使用 issue 69 新增的能力证据。
- 2026-10-06：新增真实场景和确定性评估已完成。定向 Harness 31/31、Wyscout→`CuratedDatasetRepository`→LangGraph→报告集成 2/2、完整 `pnpm test` 177/177 通过，`pnpm build` 通过。
- 2026-10-06：本机 Qwen 3.5 9B 验收未能进入 Planner/工具阶段。Ollama 0.35.1 两次在模型加载时因 Metal default device 为空、command queue/context 创建失败而返回 HTTP 500；设备报告 24 GiB 总内存、6–8 GiB 可用，CPU 侧模型缓冲约 5.2 GB。设置 `OLLAMA_LLM_LIBRARY=cpu` 及单请求 `num_gpu: 0` 均未绕过该加载失败。Harness 两次分别在 1.63 秒和 1.58 秒退出，工具调用数均为 0。通过 LaunchServices 打开 `/Applications/Ollama.app` 也失败（`kLSNoExecutableErr`）。需要从 Codex 外的 macOS Terminal 启动/修复 Ollama 并确认 `qwen3.5:9b` 能完成一次简短对话后，再重跑本场景；该结果是本机运行环境阻塞，不是 LangGraph 链路或推荐质量结论。
- 2026-10-06：后续只读检查确认 Ollama 已可用，并对固定场景进行一次完整真实运行。数据集版本 2、模型 `qwen3.5:9b`；耗时 108.93 秒，首批 20 人后按游标再查两页，总计评估 30 名候选；两项进攻一对一能力指标均被覆盖（30/30），经历方法检索、候选搜索、评估、球员报告检索、综合和 Reviewer，Harness 24 项检查全部通过（1/1）。本次运行修复了此前的本机模型加载阻塞；单次通过不证明推荐排序准确率或运行可靠性。
