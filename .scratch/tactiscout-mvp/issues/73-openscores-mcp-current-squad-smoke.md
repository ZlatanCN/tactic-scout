# Inspect OpenScores MCP current-squad data with a bounded local smoke

Type: task
Status: open
Labels: needs-info
Blocked by: none

## Goal

Determine whether OpenScores can return a club profile and current-season squad shape for further evaluation, and record the actual MCP tools and response fields without enabling a provider prematurely.

## Context

[OpenScores official docs](https://openscores.ai/docs) describe a free, read-only MCP server with `list_leagues`, `list_seasons`, `search_teams`, `get_team`, `search_players`, and `get_player`. Its [terms](https://openscores.ai/terms) allow products and agent workflows, application caching/transformation, and user-facing display. Its [changelog](https://openscores.ai/changelog) says the ingest combines Sofascore and Flashscore; the public pages do not explain the upstream authorization chain, list a full player-statistics schema, or establish 2026/27 completeness. See the [official-source review](../research/openscores-current-player-source-review-2026-10-06.md).

The user's current project direction allows broader source exploration. This smoke is for local technical/schema inspection only; it must not silently add OpenScores records to the candidate pool or imply that its squads are complete or current.

## Scope

- Read `OPENSCORES_API_KEY` only from the local API process environment and fail before network access when it is absent.
- Use the documented MCP Streamable HTTP URL exactly as `https://api.openscores.ai/mcp/` with a Bearer header; reject redirects, do not retry, and keep calls sequential and bounded.
- Inspect the documented tool catalog, one exact team result from the global team search, and that team's profile/squad. OpenScores documents `search_teams` as a search across all teams, so this smoke does not claim that the team belongs to a selected league.
- Make at most three sequential MCP requests: tool catalog, exact team search, and team profile. Never enumerate all teams or scrape unrelated pages.
- Handle only response forms confirmed by the returned MCP payload. If schemas differ from the public docs or are ambiguous, stop with a sanitized error rather than guessing.
- Report only tool names, allowlisted field names and aggregate row/field-presence counts. Never print player names, IDs, individual values, raw responses, keys or upstream free-text errors.
- Do not persist data, call the LLM, add a LangGraph node, or enable an app provider. A successful smoke does not grant rights to create a dataset or public report.

## Acceptance criteria

- [x] Missing key exits before calling `fetch`.
- [x] Requests use the documented endpoint, Bearer authentication, redirect rejection, timeout and a fixed request budget; they do not retry or enumerate the full database.
- [x] The returned tool catalog is checked for required tools and the exact input fields used by the smoke.
- [x] The returned global-search page rejects absent or ambiguous exact-name matches; the profile must match the selected team's exact provider ID and name. The smoke does not infer league membership, whole-database uniqueness, or stable identity from field presence.
- [x] The smoke reports only allowlisted field-presence counts and whether a `current_season_squad` field is present; it makes no claim about field semantics, unique/stable IDs, roster completeness, or season freshness.
- [x] MCP JSON/SSE responses and error envelopes are parsed safely; key, personal data and upstream error text never reach stdout/stderr.
- [x] Fixture tests cover valid catalog and squad, missing key, ambiguous team name, empty team results, unsupported schema, provider auth/rate-limit failures and privacy-safe output.
- [x] The command does not write files, database/checkpoints, browser storage, logs containing raw data, or model prompts.
- [ ] A live check is completed with a locally configured free key; its season and schema outcome are recorded without raw response data.
- [x] No LangGraph provider, candidate search, scoring, public player display or persistent cache is enabled by this smoke.

## Research

- [OpenScores MCP docs](https://openscores.ai/docs)
- [OpenScores terms](https://openscores.ai/terms)
- [OpenScores FAQ](https://openscores.ai/faq)
- [OpenScores changelog](https://openscores.ai/changelog)
- [OpenScores current-player-source review](../research/openscores-current-player-source-review-2026-10-06.md)

## Comments

- 2026-10-06：按 OpenScores 的官方 MCP/REST 文档登记受限 smoke。官方文档说明 `search_teams` 跨所有球队搜索，因此该 smoke 不选择或推断联赛归属。当前没有配置 API key，真实 squad 响应和 2026/27 覆盖待本地验证；OpenScores 的上游数据授权链、长期留存与逐球员作品集展示仍未得到证明。

## Answer

新增 `pnpm source:smoke:openscores`，通过官方 MCP Streamable HTTP 端点只读检查工具目录、全局精确球队搜索结果和单队 profile/squad，最多 3 次顺序请求。工具目录与实际使用的 input 字段会先校验；所有请求带 10 秒超时、拒绝重定向且不重试。JSON 与 SSE 返回都按 JSON-RPC id 校验，输出只含工具名、球队字段存在性和球员字段覆盖计数，不含球员身份、统计值、密钥或上游错误正文，也没有任何文件/数据库/模型写入。

7 项 fixture 测试覆盖正常 squad、SSE、缺失 key、球队名歧义、空球队结果、工具 schema 变化、HTTP 鉴权/限流及输出净化。OpenScores 文档说明球队搜索是全局的，因此 smoke 不把球队与联赛关联。live key 尚未配置；实际 payload、2026/27 时效、上游授权链和能力指标字段仍未验证，OpenScores 没有接入正式 provider 或 LangGraph。
