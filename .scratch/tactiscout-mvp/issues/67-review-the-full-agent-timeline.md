# Allow users to review every saved Agent investigation step

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Keep the live progress card concise while allowing users to inspect the complete bounded LangGraph progress history after a turn finishes.

## Acceptance criteria

- [x] Live progress shows only the most recent six merged stage occurrences.
- [x] The saved assistant-turn disclosure renders every merged stage occurrence in original execution order.
- [x] Started/completed events merge into one displayed occurrence using its final lifecycle state; repeated occurrences stay separate.
- [x] The history summary reports the full number of steps, not the compact live window.
- [x] Existing bounded progress events are not rewritten or discarded.
- [x] Deterministic helper tests and web production build pass.

## Answer

Live progress continues to show the last six merged stage occurrences. The expandable timeline on a completed assistant message now shows all stage occurrences in the server's bounded history, preserving execution order and merging `started`/terminal pairs. Its summary reports the full step count. The original event snapshot is unchanged.

Verification: 2 deterministic timeline tests passed; web production build passed. This checks the merge/window contract but does not constitute manual visual or screen-reader review.

## Comments

- 2026-10-06：已存助手消息保留了本轮最多 24 条原始安全事件，但前端在回看面板中仍只渲染最近 6 个合并步骤。用户无法展开查看较早的真实调查活动。改为让 live view 保持紧凑、历史 disclosure 展示完整有界 timeline。
- 2026-10-06：完成完整历史视图；两个 helper 用例确认发生顺序、生命周期合并、重复阶段及 live 最近 6 步窗口。网页生产构建通过；未运行读屏软件。
