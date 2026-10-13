# Add a licensed player-data provider with field-level provenance

Type: task
Status: open
Labels: needs-info

## Goal

Make TactiScout capable of exploring a real, provider-backed current-player pool while preserving the identity, freshness, competition/season and supported-stat coverage of every player record. The first optional provider is Sportmonks Football API; existing demo and StatsBomb modes remain available.

## Research basis

See [provider landscape research](../research/football-data-provider-landscape-2026-10.md). Sportmonks documents season team lists, season squad/player statistics, provider IDs, pagination and server-side token handling. Its current public plan page lists Starter at €29/month for five selected leagues; an optional xG/Pressure Index bundle is priced separately. Older free-coverage details may be stale and account entitlements must be checked directly. Its public terms permit product storage/display, but the reviewed material does not specifically resolve external LLM processing, so model use must be disabled unless the operator has confirmed that permission.

## Acceptance criteria

- [x] Player records can retain provider identity, provider player/team/competition/season IDs and retrieval time without merging IDs across sources.
- [x] Player records declare which raw statistics are actually supported; unsupported fields do not become measured zeros or influence tactical assessments.
- [x] Sportmonks is a server-side optional provider configured through environment variables, with selected season IDs and a server-only API token.
- [x] The adapter follows pagination for season team lists and retrieves season squads with player statistics using documented endpoint shapes.
- [x] Only teams explicitly marked `domestic` enter the current club player pool; a missing team type fails closed instead of guessing.
- [x] Provider authentication, unavailable league entitlement, rate limiting, malformed payloads and empty valid results are distinct outcomes; a failed fetch cannot appear as an empty shortlist.
- [x] External model processing of Sportmonks data is disabled unless an explicit operator setting is enabled after permission has been confirmed.
- [x] Mapping, pagination, metric coverage, authentication, error handling and default privacy behavior have deterministic tests using an injected fetch implementation.
- [x] The provider mode and provenance are visible in the application without exposing credentials.
- [x] `.env.example`, README and domain context explain configuration, source limits, unsupported metrics and the distinction between live verification and fixture-based tests.
- [ ] A live account check verifies target-league coverage and real payload compatibility before the provider is described as working against live data.

## Comments

- 2026-10-04：从 issue 09 的来源 provenance 落地顺序开始执行。官方文档表明季赛球队列表需分页；球员赛季 squad/detail 可连同统计取回；API v3 未记录的统计不会返回。此 issue 将先把安全、可验证的 adapter 做完整，真实联赛联调在获得凭据与确认对应模型处理许可后完成。
- 2026-10-04：adapter、fixture 测试和球员卡来源显示已实现；统计覆盖需由部署者按 Sportmonks 账户/联赛显式登记，避免将套餐缺项误当零。官方统计类型以 Sportmonks `player-statistics` 文档为准；真实账户联调仍未完成。
- 2026-10-04：重新核对 Sportmonks 当前官方价格页与服务条款，修正旧文档中的免费联赛/限额描述。当前公开页列出 Starter €29/月、5 个联赛、每实体每小时 2,000 次调用；xG/Pressure Index 另付费。14 天付费试用需有效银行卡并会自动续费，除非到期前取消。真实账户和目标联赛 entitlement 仍未联调。
- 2026-10-04：按 [官方按赛季球队响应](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/teams/get-teams-by-season-id) 和 [Participants 字段说明](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/includes/participants) 收紧球队解析：仅接受 `domestic`、排除明确的 `national`，缺失或未知类型均作为无效响应停止，避免进入俱乐部候选池或把 schema 变化误报成空名单。
- 2026-10-10：状态改为 `needs-info`：代码与脱敏 smoke 已交付，剩余验收依赖真实账号的赛季/联赛权限及 token；没有这些账户事实时不声称 live provider 已验证。

## Answer

核心实现完成；待真实 Sportmonks 账户验证。新增 [issue 48](48-sportmonks-current-pool-smoke.md) 与本机无模型 smoke：最多四个请求，只检查当前赛季和一支球队，不打印球员身份/原始统计、不持久化、不调用模型；真实 token 联调仍待用户在本机配置。
