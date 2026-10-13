# 让读屏用户知道 Agent 进度连接已断开或恢复

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

在长时间球探调查期间，向视觉用户和读屏用户一致说明实时阶段连接状态；状态改变时只播报一次，不把每秒计时纳入 live region。

## Acceptance criteria

- 实时阶段连接、断开、恢复和 API 契约不兼容都有明确的可访问状态提示。
- 进度轮询的连接状态变化通过 polite live status 播报。
- 每秒更新的等待计时不进入 live region。
- 未决请求恢复提示仍说明相同 request ID 不会重复启动调查。
- 工作台生产构建通过。

## Answer

实时进度卡现在为连接状态使用独立的 `role="status"`、`aria-live="polite"`、`aria-atomic="true"` 区域，覆盖连接中、已连接、短暂断线、恢复中的未决请求及 API 阶段格式不兼容。进度阶段继续由原状态标题播报；逐秒计时仍在 live region 外，避免重复打断。

验证：`pnpm build:web` 与 `pnpm build` 通过，`git diff --check` 通过。尚未用 VoiceOver 等读屏软件人工验收实际语音与 timeline 导航。

## Comments

- 2026-10-06：代码检查发现实时进度 heading 会播报 LangGraph 当前阶段，但进度轮询变为 stale 或 incompatible 时的提示只在视觉上出现。新增独立、原子 polite status，涵盖连接状态，并让断线恢复可被读屏感知；等待计时仍在 live region 外。双端构建与差异格式检查通过；实际 VoiceOver 语音验收留给人工完成。
