# Add a bounded local Sportmonks account smoke

Type: task
Status: open
Labels: needs-info
Blocked by: none

## Goal

Allow a user-owned Sportmonks account to verify one configured current season and one team's current roster/statistics payload before enabling the provider in the application.

## Scope

- Read the existing server-side `SPORTMONKS_API_TOKEN` and a separate `TACTISCOUT_SPORTMONKS_SMOKE_SEASON_ID` from local `.env`; never request or print a token in chat, logs, or output.
- Verify the season is explicitly marked current before requesting teams, squads, or player statistics.
- Read only the first team-list page, then one selected team (or the first domestic team returned) and its current squad plus season-statistics payload.
- Cap the run at four sequential or parallel requests: season metadata, one team-list page, one squad request, and one statistics request. Do not follow more pages, retry, persist results, or invoke an LLM.
- Print only retrieval time, season/competition/team IDs, current-season status, request count, current squad count, parser-compatible player count, and per-field non-null record coverage. Never print player names, individual values, raw payloads, or the token.
- Keep public display, storage, and model-processing permissions outside this smoke; it does not enable the application provider or imply any permission.

## Acceptance criteria

- [x] `pnpm source:smoke:sportmonks` runs the bounded local smoke and sanitizes provider errors.
- [x] A season not explicitly current stops after the metadata request.
- [x] If page one contains no team explicitly marked `domestic`, the command fails with a sanitized reason and does not request squad or statistics.
- [x] Successful smoke reports one team's current squad and supported statistic field coverage without player-level identity or values.
- [x] No result is persisted or sent to the model; normal provider model-processing gate remains unchanged.
- [ ] Live account verification remains pending until a user configures their local token and season ID.

## Research

- [Official current-player-pool source decision](../research/current-player-pool-provider-decision-2026-10-04.md): Sportmonks is the strongest existing current-pool adapter, but target-league entitlement and external LLM processing permission remain unverified. This command validates an account's live response only; it does not authorize or enable the full app integration.
- [Sportmonks API v3 changes](https://docs.sportmonks.com/v3/welcome/differences-between-api-2-and-api-3/api-changes): v3 returns only recorded statistical values; unrecorded values are omitted rather than filled with default zeroes.

## Comments

- 2026-10-04：按官方来源复核结论，先用本机、限量、无模型流程验证真实账户当前赛季与一队数据形状；不订阅付费套餐、不开启正式 provider，也不假设已有 AI 处理许可。
- 2026-10-04：复审发现仅返回空 team 会让命令以成功状态结束；现在要求球队明确标记为 `domestic`，否则以脱敏错误结束且不读取阵容或统计。
- 2026-10-11：对抗性代码审查发现 provider 曾把账号覆盖配置直接当作逐球员字段可用性，因而把 API v3 省略的统计项当成零值证据。现在 `availableStats` 必须同时满足账号覆盖和该球员响应中实际存在该 `type_id`；缺失项不参与 `toPer90`/职责评估，也不会在最终报告中被表述成“零次传球”，显式返回的 0 仍是有效观测。适配器缺失/显式零对照测试 11/11、LangGraph 报告链路 41/41 通过，`pnpm build` 通过。真实账户 smoke 仍待配置 token 与 season ID。

## Answer

`pnpm source:smoke:sportmonks` 已实现；真实账户 smoke 需用户在本地配置 token 与 season ID 后执行。
