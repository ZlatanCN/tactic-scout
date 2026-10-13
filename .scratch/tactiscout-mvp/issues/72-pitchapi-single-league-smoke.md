# Add a bounded PitchAPI player-stat smoke

Type: task
Status: open
Labels: needs-info
Blocked by: none

## Goal

Prepare a local, read-only check for PitchAPI's current-season player evidence without enabling a production provider or sending player data to the Agent.

## Context

[The current-season source review](../research/current-season-player-source-path-2026-10-06.md) found PitchAPI's official documentation promising: 77 leagues, current-season fixtures and per-match advanced player statistics. The API needs an account key. Its official SDK says returned data is governed by separate service terms, but the public documentation and key page did not expose those terms. Data-display, storage, attribution, LLM/RAG and public-portfolio permissions remain unverified. The technical smoke must preserve that distinction.

## Scope

- Read `PITCHAPI_API_KEY` only from the local API process environment; fail before any request if it is missing. Never print or persist the key.
- Let the operator select one league by exact name and country code, defaulting to `Premier League` and `ENG`; resolve it from `/v1/leagues` instead of hard-coding provider IDs.
- Read the provider's current-season metadata and that season's played-match list. Sample at most the three most recent completed matches.
- For each sampled match, read standard and advanced player-stat endpoints, respecting documented `ANALYTICS_UNAVAILABLE` responses as missing sample evidence. Make at most nine sequential requests and do not retry or paginate.
- Summarize season, sampled match count, player-row count, advanced-data availability and non-null coverage for a small allowlist of ability metrics. Do not print player names, IDs, individual values, images, raw payloads, or provider error messages.
- Keep all fetched player records in memory for the command only. Do not write to dataset files, SQLite checkpoints, browser storage, logs, or model prompts. This smoke does not enable a provider in the application.
- Document separately that a successful technical smoke is not permission to persist, display, republish, or send the data to Ollama/LLM/RAG.

## Acceptance criteria

- [x] Missing key exits before calling `fetch`.
- [x] League resolution requires one exact name + country match; absent or ambiguous matches stop safely.
- [x] Only the provider-reported current season is sampled; future, scheduled and older-season matches are excluded.
- [x] The command makes no more than nine sequential requests, samples at most three matches, and performs no retry or pagination.
- [x] Standard and advanced player response shapes are summarized by a stable metric-key allowlist; empty/unavailable fields remain missing rather than zero.
- [x] CLI output and sanitized errors contain no key, player name/ID, individual data value, raw response, or upstream free-text error.
- [x] Unit tests use fixture responses and verify success, missing/invalid key, ambiguous league, no current-season matches, analytics unavailable and sanitized HTTP/API errors.
- [x] The smoke writes no files and invokes no LLM, database, checkpoint or application provider.
- [ ] A live account smoke run is completed with a locally configured key.
- [x] No LangGraph provider or user-facing PitchAPI data display is enabled until the applicable service terms/data rights are reviewed.

## Research

- [PitchAPI API documentation and changelog](https://pitchapi.dev/): current-season league/fixture endpoints, match player stats, advanced player metrics and field semantics.
- [PitchAPI free key page](https://pitchapi.dev/get-api-key): one free plan, 77 leagues and API-key requirement.
- [Official PitchAPI SDK page](https://pypi.org/project/pitchapi/): SDK MIT license applies to code only; returned data is governed by separate PitchAPI terms.
- [Current-season source admission review](../research/current-season-player-source-path-2026-10-06.md): no current source passed all data-rights and product-use gates.

## Comments

- 2026-10-06：开始实现只读 smoke。当前工作区没有配置 `PITCHAPI_API_KEY`；live verification 尚未执行，且公开展示/存储/LLM 权限仍未核实。

## Answer

已添加 `pnpm source:smoke:pitchapi` 与服务器端 `PITCHAPI_API_KEY` 配置示例。命令精确解析联赛后读取 provider 当前赛季，最多取三场已结束比赛，并最多顺序发出九次请求；只输出指标 key 与非空样本覆盖计数。`ANALYTICS_UNAVAILABLE` 保留为缺失样本，不折算为零。结果不包含球员名字、ID、单项数据或原始响应，也不会写文件或进入 Agent。

本地 fixture 测试 7/7 通过；API 和网页生产构建通过。无 key 执行 CLI 会在任何网络请求前退出。真实 API 返回形状仍待用户本地 key 验证；PitchAPI 服务条款及展示/留存/模型权限尚未核实，所以此 issue 保持进行中，不启用数据 provider。

- 2026-10-06：实现与本地验收完成；只剩真实账号数据形状检查待 `.env` 配置 `PITCHAPI_API_KEY`。即使 live smoke 通过，也要单独完成数据使用权审查。
