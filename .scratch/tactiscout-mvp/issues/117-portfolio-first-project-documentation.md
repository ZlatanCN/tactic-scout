# Make the project README portfolio-first

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the repository's first read useful to a hiring manager or project reviewer: explain the user problem, why LangGraph is used, how to run the project, and what the latest evaluation proves, while keeping detailed source and operations notes available.

## Acceptance criteria

- [x] The README leads with product purpose, concrete Agent capabilities, and the LangGraph value in this project.
- [x] A short setup path accurately reflects `.env.example`, available scripts, and the required local model/data choices.
- [x] Evaluation commands and one recent full-chain result are easy to find; it clearly says ranking quality is not measured.
- [x] Detailed provider, RAG ingestion, and historical run procedures move to focused docs or existing issue records without losing source-use caveats.
- [x] Every moved detail remains reachable from the README and repository-local Markdown links resolve.
- [x] `CONTEXT.md` and issue map continue to agree with the README's claims.

## Design

Keep the README as a short project brief and navigation hub. Give detailed operational instructions a durable home under `docs/`; use issue 14 and the relevant issue files as the authoritative full-run history rather than duplicating dated logs.

## Comments

- 2026-10-09：当前 README 有 387 行，包含多轮按日期堆叠的 Harness 记录和长篇逐 provider 操作说明；同一结果也在 `.scratch/tactiscout-mvp/issues/14-agent-harness-evaluation-suite.md` 与 issue map 维护。先保留全部重要限制，再压缩入口信息密度。
- 2026-10-11：作品集入口新增紧凑的核心机制消融摘要，列出动态调查规划、方法 RAG 与历史旁注的冻结场景观察和各自结论边界；能力评估器的真实模型消融明确标为待授权/待运行，避免把离线夹具说成线上实验结果。

## Answer

README 已重写为简体中文作品集入口，说明自然语言引援调查、LangGraph 状态/工具/追问/Reviewer 控制流、全 TypeScript 技术栈、Ollama + demo 快速启动、数据范围，以及最近一次 mosaic 多来源仓库 → Qwen/LangGraph → Reviewer → 报告链路的 28/28 Harness 结果。另保留较早同日 FPL 链路的 29/29 结果。明确标出球员排序质量未评估。

详细内容分别迁入 `docs/architecture.md`、`docs/data-sources.md`、`docs/knowledge-base.md`、`docs/scouting/first-party-observation-workflow.md` 和 `docs/evaluation.md`；原 provider 使用边界、入库/撤回说明与球探观察许可流程均保留。`CONTEXT.md` 保持领域词汇表职责，issue map 与 README 的数据范围及评测结论一致。随后验证所有新 README/专题页的本地 Markdown 路径及 `git diff --check`。
