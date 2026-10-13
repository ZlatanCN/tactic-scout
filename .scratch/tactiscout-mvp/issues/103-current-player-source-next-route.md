# Choose the next eligible current-player data source

Type: research
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Question

Which additional current-player performance source can materially broaden TactiScout's candidate pool or ability evidence while supporting a reproducible, rights-aware local Agent workflow?

## Acceptance criteria

- Compare at least three unreviewed candidate routes using source-owner API documentation, data catalogs, terms, or license text.
- Verify whether each source exposes a usable player pool rather than only a top-scorer or leaderboard sample; record competitions, seasons, player identity fields, positions, and relevant ability metrics.
- Separate verified freshness/update evidence from marketing claims or undocumented behavior.
- Assess credentials, price/quota, local caching, derived statistics, local LLM/RAG processing, and public portfolio display independently; unknown rights remain unknown.
- Exclude sources already recently assessed for this purpose, including K League, J.League, SoccersAPI, SportScore, FBref, OpenScores, and PitchAPI, unless new first-party evidence changes a prior decision.
- Save one cited note under `.scratch/tactiscout-mvp/research/`, choose a practical next action, and do not integrate an unverified source into the Agent.

## Context

- [Layered player-evidence source matrix](39-layered-player-evidence.md)
- [K League current-season API assessment](../research/k-league-current-player-performance-api-2026-10-09.md)
- [SoccersAPI current-player-statistics review](../research/soccersapi-current-player-statistics-source-review-2026-10-09.md)

## Comments

- 2026-10-09：开始优先寻找覆盖球员池和能力字段均有一手证据、且处理边界可核验的当前数据路线；不因 API 可访问就默认获准留存或送入模型。

## Answer

没有找到可以立即加入 Agent 的新增当前赛季数据源。iSports API 的五大联赛商品有技术增量：商品范围列出英超、西甲、德甲、意甲、法甲；赛季球员统计文档包括分钟、进球、传球、关键传球、长传、直塞、成功盘带、防守动作和空中对抗等基础字段。但官方资料没有证明这些赛事现已有 2026/27 记录，也未实测球队球员池完整度、位置/年龄字段和名单到统计的联结。

该商品页面标价 149 美元/月，15 天试用不是长期免费来源。条款也未给出 TactiScout 所需的本地缓存、向本地/云端模型提供数据、向量 RAG、派生报告和公开作品集展示权。因此没有注册账户、调用 API、获取球员数据或改动 provider/LangGraph。本轮结论为先不接入；若用户之后愿意承担费用，应先取得供应商对许可与目标赛季覆盖的书面回复，再进行有界无模型 smoke。

核验范围、链接和逐项字段见[研究笔记](../research/current-player-source-next-route-2026-10-09.md)。
