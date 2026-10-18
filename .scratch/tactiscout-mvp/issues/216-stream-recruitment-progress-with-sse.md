# Stream recruitment progress with SSE

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

让进行中的招募回合通过原生 SSE 即时更新现有安全进度时间线，同时保留 Fastify、LangGraph、案件 checkpoint、请求幂等、结构化追问、取消和断点恢复语义。轮询继续作为断线回退，不作为第二个业务状态源。

## Proposed public seams

- `createApp()` 的真实 HTTP 边界：`POST /api/v1/recruitment/cases/:caseId/turns/stream` 使用现有 turn 请求契约，按序发送 `progress` 和唯一的 `result`/`error` 终态事件；验证最终业务响应与现有 JSON turn 等价，客户端断开不取消服务端回合，取消仍走现有接口。
- 前端公开流客户端：`turnRecruitmentCaseStream()` 用 POST `fetch()` 解析 SSE，把安全 `RecruitmentProgress` 快照交给现有 `useRecruitmentSession`；验证即时进度、成功终态和流中断后保留原 `requestId` 以便恢复。

## Acceptance criteria

- [x] SSE 只承载现有白名单进度 DTO 与经 Zod 校验的现有 turn 结果，不转发 LangGraph state、Planner prompt、工具参数或异常正文。
- [x] 同案串行、请求去重、结构化位置/身份回答、取消、checkpoint 恢复与报告 DTO 行为不变。
- [x] 浏览器断开流不触发取消；正常完成只消费一个终态，失败可回退到原请求恢复。
- [x] UI 时间线在事件到达时更新；轮询只在流不可用/断线时提供恢复，不让两个来源同时覆盖当前进度。
- [x] 候选搜索结果通过白名单 `candidates` 事件在报告生成前显示脱敏预览；流空闲时发送 SSE 心跳，同一 `requestId` 的既有进度快照在流开始时重放；等待计时在 SSE 模式下持续运行，静默超过 20 秒时提示仍在执行。
- [x] API/Web 构建、定向真实 HTTP 与前端流测试通过。

## Comments

- 2026-10-18: 用户确认 SSE 对 UI/UX 重要。按 TDD skill，先记录并确认测试 seam，确认前不写测试或实现。范围限定为可删除的传输纵向切片，不引入 AG-UI 或 TanStack runtime。
- 2026-10-18: 已实现同一回合服务上的原生 SSE 路由；前端优先消费 SSE。只有流端点在回合执行前不可用或没有响应体时才回退 JSON；流开始后的断线、契约错误或业务错误都保留原 `requestId`，不会误触发第二轮。正常路径暂停轮询，断线后恢复快照同步。AG-UI 保留为将来有第二个客户端时的协议映射层。
- 2026-10-18: 补齐事件通道：候选搜索完成后发送 `candidates` 预览；SSE 每 15 秒发送注释心跳；重连/恢复时先重放同 request id 的进度快照；等待时钟独立于轮询 effect 运行；静默 20 秒以上显示“仍在执行”提示。所有新增事件继续走 Zod 白名单，不转发 LangGraph state、prompt 或工具参数。

## Answer

新增 `POST /api/v1/recruitment/cases/:caseId/turns/stream`。它调用与 JSON 回合相同的应用服务、LangGraph 图、checkpoint、同案协调、取消和报告投影，只把传输改为 `progress`、唯一 `result` 或 `error` SSE 事件。若调用方没有提供 `requestId`，路由先创建一次并复用于整条流，确保早期失败也能关联。

前端用同一 `requestId` 消费事件并校验事件 DTO；SSE 活跃时停止轮询。只有服务端在执行回合前明确表明流端点不可用，或响应完全没有 body 时才回退现有 JSON 接口。流一旦建立，后续断线、格式不兼容或业务错误都直接呈现并保留原请求身份，避免显示故障被误当成一次可重发的新回合。流断开不会被解释成服务端取消，恢复仍按原 `requestId` 取回同一回合结果。

验证：`pnpm build`、`pnpm build:web` 通过；前端 SSE 5/5、HTTP 定向套件 8/8 通过。另两项已有和新加的 loopback 流测试因当前沙箱拒绝 `listen 127.0.0.1`（`EPERM`）未执行，断言未失败。

复核补充（2026-10-18）：修复应用服务缺少最终进度投影的问题，并按实际事件 envelope 更新真实 HTTP 断言。当前完整后端 630/630、前端 SSE 8/8 通过，API/Web 构建通过；此前 loopback 未验证状态已补齐。
