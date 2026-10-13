# Keep tiny samples from receiving misleading percentiles

Type: task
Status: resolved
Labels: ready-for-human

## Goal

Make evidence comparisons reflect sample reliability without silently removing low-minute players from discovery. TactiScout may still surface a low-minute player as a lead, but it must not give that player's unstable per-90 rate an apparently precise peer percentile.

## Why now

A real Wyscout 2017/18 report ranked a player with 16 minutes in the sample and showed several metrics at the 100th percentile against a much larger comparison group. The report disclosed the low-minute risk, but the percentile presentation still looked precise and made the extreme per-90 rates easier to over-read. The project already uses 900 minutes as its low-sample boundary in evidence coverage and report risks; reuse it as an internal reporting convention, not a universal football standard.

## Acceptance criteria

- [x] Candidate discovery still includes low-minute players by default; the guard does not change `minimumMinutes` search filters.
- [x] Percentiles are computed only when both the evaluated player's metric sample and each comparison player's metric sample meet the existing 900-minute boundary; an unknown metric sample is ineligible.
- [x] Low-sample players keep their observed rate and sample minutes, but show no percentile and an explicit low-sample reason.
- [x] High-sample comparisons remain position-, competition-, and season-specific; fewer than five eligible peers still produce no percentile.
- [x] Report limitations distinguish low-sample evidence, unknown metric sample minutes, and an insufficient comparison group.
- [x] The local Agent Harness checks the sample/percentile behavior without treating it as a player-ranking accuracy metric.
- [x] API and web production builds pass.

## Answer

Added a shared evidence-comparison rule in the domain layer. It keeps candidate discovery unchanged, requires at least 900 minutes for the candidate's metric sample and every peer metric sample, excludes unknown or short peer samples, and requires at least five eligible peers. Evidence still retains the measured value; its nullable sample minutes and explicit reason explain why a percentile is unavailable.

The report and workbench now distinguish a candidate sample below the project boundary, unavailable metric sample minutes, and a comparison group with fewer than five eligible peers. The workbench also applies the sample guard when displaying older localStorage snapshots that predate the explicit unavailable-reason field, so a stale percentile is hidden without silently rewriting the saved report. The local Harness enforces those sample/percentile invariants and makes no claim about ranking quality.

Verification: 40 focused comparison, conclusion-policy, and Harness tests passed; `pnpm build`, `pnpm build:web`, and `git diff --check` passed. A full-suite attempt reached the existing StatsBomb model-processing opt-in guard in conversation tests; I left that user consent gate unchanged.

## Comments

- 2026-10-05：基于本机 Qwen 的真实工作台报告登记。Dodi Lukebakio 有 16 分钟样本，但传球成功率和渐进传球成功率分别显示为第 100 百分位；该记录同时已被标为小样本。这项修复只收紧比较解释，不将小样本球员从自然语言候选发现中筛掉，也不宣称 900 分钟是行业统一标准。
- 2026-10-05：完成实现和定向验证。除了 16 分钟候选，补上了指标级样本分钟缺失的情况；缺失时不回退使用球员总分钟进行百分位比较。
- 2026-10-05：27 个比较规则与 Harness 用例通过，API/网页生产构建通过。全量测试触及 StatsBomb 处理授权 gate；没有为通过测试覆写用户的来源处理设置。
- 2026-10-05：浏览器实际打开的旧 localStorage 报告仍显示了 16 分钟样本的第 100 百分位；根因是旧记录没有新版的 unavailable reason。工作台现按 evidence 的实际分钟再次保护百分位展示，并有旧快照回归测试；原始保存快照不被自动改写。
