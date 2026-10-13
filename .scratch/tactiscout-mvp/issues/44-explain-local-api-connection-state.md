# Explain local API connection state in the scouting workspace

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

When the scouting API is unavailable, explain that the service connection failed instead of labeling the data source as unknown. Let the user retry after starting or restoring the service.

## Why now

The web preview at `127.0.0.1:5173` is served separately from the Fastify API at `127.0.0.1:8000`. If the API is stopped, `getDatasetStatus()` rejects and the UI currently suppresses that error, showing “数据源状态未知” and “当前数据来源说明暂时不可用”。This makes a local startup issue look like missing or broken football data.

## Acceptance criteria

- [x] The header distinguishes initial connection, connected data source, and unavailable API states.
- [x] The empty report explains that the local scouting service is unreachable and offers a retry action.
- [x] Retrying updates the connection state and does not fabricate a data mode or dataset scope.
- [x] Existing connected and report states continue to render their real data source and range.
- [x] Web production build succeeds.

## Research and evidence

- `README.md` documents that API and web preview run as separate processes.
- Reproduction: opening the web preview while port `8000` refuses connections produces the misleading unknown-source state.
- The API client currently rejects HTTP and contract errors; `App` discards all of them in its initial dataset-status effect.

## Answer

保留工作台现有三态连接状态。在数据范围请求返回 5xx 时，客户端再检查 `/health`：API 不可达或健康响应不属于 TactiScout 时，归类为“服务端未连接”；API 健康但数据范围接口仍失败时，继续归类为“状态读取失败”。健康探测只发生在数据接口返回 5xx 的错误路径，正常连接不增加请求。直接网络失败仍使用原有断连状态。

Verification: 浏览器刷新前重现错误文案“暂时无法读取数据范围”，修复后刷新显示“无法连接球探服务 / 请确认本地球探服务已启动”；重试入口仍可用。`pnpm build:web` 与 `git diff --check` 通过。已连接状态本轮无法复验，因为沙箱禁止启动本机 API；成功路径未改动，上一轮 issue 44 浏览器验收记录了实际数据源和快照范围。

## Comments

- 2026-10-13: 修复 Vite 代理将后端连接失败表现为 HTTP 5xx 的回归，并在真实工作台页完成离线状态红/绿复验。
- 2026-10-13: Reopened after the actual Vite preview showed `暂时无法读取数据范围` while the API was stopped. The browser reaches Vite, which proxies both `/api` and `/health` to port 8000; a failed proxy request is returned as an HTTP error, so the old TypeError-only detection classifies an unreachable API as a data-status failure. Keep the accepted workbench browser surface and distinguish an unavailable API from an API that is reachable but returns a dataset error.
- 2026-10-04：复现时网页可访问但 Fastify API 不可连接；前端 `catch` 静默清空 dataset，导致“数据源状态未知”。增加显式加载/断连/状态读取失败文案及重试入口后，Web 生产构建通过。之后实际预览观察到 API 已在线并成功显示真实数据模式与快照范围。
