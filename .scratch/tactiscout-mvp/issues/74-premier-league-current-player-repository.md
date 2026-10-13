# Connect a current Premier League player pool to the conversational scout

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Add a live, one-competition player repository so the existing LangGraph investigation can search and compare current-season Premier League players using measured public performance fields.

## Context

The Wyscout and curated paths prove the harness against historical data, but they cannot produce current candidates. A bounded, anonymous read of the Premier League Fantasy bootstrap response on 2026-10-06 returned a 2026/27 player directory, club and position IDs, minutes, goals, assists, xG, xA, xGI and selected defensive totals. The endpoint is not a supported developer API and its player directory is not a complete club registration list. Keep this provider explicitly scoped to the fantasy game's current Premier League player set. See [current roster and performance route review](../research/current-roster-and-performance-route-review-2026-10-06.md).

## Scope

- Implement a `PlayerRepository` adapter for one anonymous HTTPS request to `https://fantasy.premierleague.com/api/bootstrap-static/`.
- Derive the season from the earliest valid event deadline; preserve FPL player/team IDs, retrieval time, broad game position and exact source field names.
- Use only observed season totals for goals/assists and a small allowlist of xG/xA/xGI, tackles, recoveries and combined clearances/blocks/interceptions. Normalize totals per 90 using source minutes. Missing fields and zero-minute samples remain unavailable.
- Filter candidates only by known Premier League team IDs and broad FPL positions; do not infer centre-back/full-back/winger roles, transfer availability, player value, full squad coverage or non-EPL candidates.
- Cache in memory with a bounded TTL, timeout, response-size limit, redirect rejection and sanitized failure handling. Never retry 403/429.
- Integrate the mode with the conversational repository, report limitations and current-limited dataset scope. Do not expose it through the legacy one-shot runner.
- Verify with fixture tests and the user's chosen end-to-end acceptance: current source -> repository tools -> LangGraph conversation -> reviewed report.

## Acceptance criteria

- [x] The provider rejects malformed, oversized, redirected, timed-out and unsuccessful responses without leaking raw payloads or retrying.
- [x] The provider preserves source IDs, current season, retrieval time, team/position mapping, birth-date-derived age and only fields actually supplied.
- [x] xG/xA/xGI, tackles, recoveries and combined defensive totals are accurately defined, use observed minutes for per-90 values, and retain unknown samples as missing.
- [x] The existing repository query contract correctly paginates and filters the provider's player pool.
- [x] Reports and dataset status describe this as an FPL-derived Premier League current-season pool, not a full registered squad or global transfer market.
- [x] Users cannot mistake broad goalkeeper/defender/midfielder/forward groups for specific tactical roles; unavailable progressive passing, carrying, pressure, value, injury or contract attributes stay explicit gaps.
- [x] Deterministic tests, API/web builds and a real local-model LangGraph report pass against live data without logging raw response bodies or exposing upstream error payloads.

## Comments

- 2026-10-06：按用户选择的整条对话链路验收推进。当前源端实测是 667 条 FPL 玩家记录、20 支球队；这只说明接口返回了这些行，不证明俱乐部完整阵容覆盖。
- 2026-10-06：首次在简化各 Planner 阶段的数据源范围提示后复跑，`bayern-kane-replacement` 全链路再次通过。输出上限设为 4096 tokens；耗时 82.452 秒，20/20 行为检查通过。此前仅增加输出上限时仍在同一规划阶段解析失败，因此这次结果支持“缩短重复范围提示”是修复关键，但单次运行不能证明长期稳定性。
- 2026-10-06：随后对同一实时数据 + 本机模型 + LangGraph 场景重复运行 3 次，3/3 全部通过，每次 20/20 检查、两次追问/同案恢复、12 次工具调用及 60 条进度事件；耗时分别 56.299、92.044、89.436 秒，中位数 89.436 秒。三次样本只作为有限的运行一致性证据。

## Answer

Implemented `TACTISCOUT_DATA_MODE=fpl` using a bounded public bootstrap read. The adapter maps the current season from the earliest event deadline, keeps FPL player/team identity and broad positions, and turns only observed xG/xA/xGI/tackles/recoveries/combined defensive totals into per-90 evidence. Missing or zero-minute fields remain unavailable. The conversation Planner, current-limited report scope and workbench source indicator now preserve the FPL directory boundary; legacy one-shot scouting is disabled for this source.

Verification: 12 provider tests passed; all 210 repository tests passed; API and web production builds passed; `git diff --check` passed. Live data returned 667 game-directory records across 20 clubs for 2026/27. A real `qwen3.5:9b` LangGraph run completed the Bayern Kane replacement scenario; after prompt refinement, three repeated runs passed all 20 behavior checks each, with two clarifications and same-case resumes, 12 tool calls and 60 progress events per run. The three runs took 56.299, 92.044 and 89.436 seconds. An earlier full run evaluated 30 candidates and produced one recommendation citing eight measured metrics. This validates these runs through report review; it does not validate ranking quality, full-roster coverage or long-term reliability.
