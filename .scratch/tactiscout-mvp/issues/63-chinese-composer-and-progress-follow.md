# Keep Chinese chat input and live investigation progress easy to follow

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Make the natural-language conversation reliable for Chinese IME users and keep the live LangGraph timeline visible without taking control away from someone reading earlier messages.

## Acceptance criteria

- Enter accepts an active IME composition without submitting the conversation; Enter submits only after composition ends, while Shift+Enter inserts a newline.
- A newly submitted turn scrolls the conversation to its live progress card.
- New progress stays in view while the user is at the bottom of the conversation; manually reading older messages disables auto-follow until a new turn starts.
- Progress following does not move focus or use forced smooth scrolling.
- Existing LangGraph events, turn state, and saved conversation contents are unchanged.

## Answer

The composer now ignores Enter while the browser reports an active IME composition, including the legacy key code used by some browsers. Enter submits only after composition; Shift+Enter keeps its native newline behavior.

The conversation pane scrolls to a newly submitted turn and follows updated LangGraph progress only while the reader is near the bottom. Scrolling up disables follow behavior until the next turn starts. It does not move focus or animate the scroll.

Verification: `pnpm build:web` passed. No tests were added or run; browser and screen-reader interaction were not manually verified.

## Comments

- 2026-10-06：检查当前工作台后发现 Enter handler 没有识别中文输入法组合事件；同时对话区是有界滚动区，但没有跟随 LangGraph 阶段更新。按用户最新方向优先修复自然语言主路径的交互可靠性。网页生产构建通过；未运行测试，也未人工验证读屏和浏览器输入法交互。
