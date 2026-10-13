# Bounded SoccersAPI current-season player-stat smoke

Type: task
Status: open
Labels: needs-info
Blocked by: none

## Goal

Verify whether SoccersAPI can contribute a real, current-season squad and basic player-stat sample from a user-selected free-plan league before considering it for the LangGraph candidate workflow.

## Scope

- Add a server-side, opt-in, read-only command. It must fail before any request when `SOCCERSAPI_API_KEY` is absent.
- Resolve exactly one account-enabled league by exact league name and country code; use provider metadata for the current season rather than deriving it from today's date.
- Inspect the current-season team list, one exact selected team's season squad and at most five player-season statistic records.
- Make at most nine sequential requests; no retry, pagination, login automation, scraping, or attempt to bypass account entitlements or rate limits. Use Bearer authentication, bounded response sizes, redirects rejected and finite timeouts.
- Report only competition, season, sampled-team name, aggregate row counts, metric coverage counts and remaining request allowance. Never print player names, IDs, images, individual values, raw payloads, secrets or upstream free-text errors.
- Keep all source data in memory for the command. Do not persist records, contact an LLM, add a LangGraph provider, or display player-level statistics in the app.
- Mark current-season completeness, refresh frequency, local retention, local model/RAG processing, public portfolio display and upstream rights as unverified unless the smoke or written terms directly establish them.

## Acceptance criteria

- [x] Missing key fails before fetch and no credentials appear in request URLs or output.
- [x] Exact league/country resolution rejects absent and ambiguous matches; only the account's returned league list is eligible.
- [x] The current season comes from provider metadata; an absent, contradictory or malformed current-season ID stops the smoke.
- [x] The run inspects at most one team and five players and never exceeds nine sequential requests.
- [x] Tests distinguish absent fields from measured zero and summarize only an explicit metric allowlist.
- [x] Redirect, oversized body, timeout, invalid JSON, plan denial and rate limiting stop clearly without retry or upstream response text.
- [x] Fixture tests cover successful and incomplete coverage, account-scope errors, malformed data and sanitized output.
- [x] The command does not write files, invoke an LLM, touch checkpoints or enter the user-facing candidate pool.
- [ ] A live smoke is run with an operator-configured development key before any future provider integration is proposed.

## Research

- [SoccersAPI current-season player-statistics source review](../research/soccersapi-current-player-statistics-source-review-2026-10-09.md): official docs show player-season statistics and current-squad operations; current-season record completeness and data-processing terms remain unknown.
- [Player statistics endpoint](https://docs.soccersapi.com/stats/player/), [current-season league profile](https://docs.soccersapi.com/leagues/info/), [season squad](https://docs.soccersapi.com/teams/squad/), [account league list](https://docs.soccersapi.com/leagues/list/) and [free-plan access](https://docs.soccersapi.com/guides/plans-and-data-access/).

## Answer

代码与本地验收已完成：`pnpm source:smoke:soccersapi` 从服务器端环境变量读取 key，以 Bearer header 串行读取账户联赛表、联赛当前季、球队列表、一支队的阵容和最多五名球员统计；请求最多 9 次，响应体限制 1 MB，无重试、不跟随重定向、不落盘、不调 LLM。输出只显示来源/赛季/球队及汇总字段覆盖，不含球员身份或单项数值。

确定性 smoke 测试 11/11 通过；完整 `pnpm test` 310/310、API/Web 构建和 `git diff --check` 均通过。当前本机未配置 `SOCCERSAPI_API_KEY`，因此没有发出 API 请求，live 统计覆盖与刷新情况仍未验证。官方条款对本地非商业调用、长期留存、本地模型处理及简历作品集展示的适用性也仍未知，所以此功能仅为本地无模型验真工具，尚不接入 LangGraph/推荐池。

## Comments

- 2026-10-10: Rechecked `.env` by parsing it without printing values; `SOCCERSAPI_API_KEY` is absent. No provider request was sent. Status is `needs-info` until the operator configures a development key for the explicitly bounded smoke.
