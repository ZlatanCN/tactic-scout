# Preserve candidate-source failures through LangGraph conclusions

Type: task
Status: resolved
Labels: ready-for-human

## Goal

Keep a failed candidate query distinct from a successful search with zero matches, through Planner recovery, final report and progress UI.

## Why now

FBref access denial has a dedicated terminal path. Other repository errors are written into conversation history for the Planner, but the final user-facing report does not retain whether candidate discovery succeeded. A failed online request could therefore be mistaken for an empty market sample.

## Acceptance criteria

- [x] Candidate-query failures are recorded in LangGraph state for the current turn and survive until recovery or report delivery.
- [x] A later successful candidate search clears the unresolved failure; an unrecovered failure is named in report limitations.
- [x] If no candidate search succeeded in the current turn, the final summary states that results are unknown and failure does not mean zero matching players.
- [x] Safe failure details are bounded and redact tokens before entering graph history or report copy.
- [x] Deterministic conversation tests cover fail-to-report and failure-then-success recovery behavior.
- [x] API and web production builds pass.

## Answer

Added current-turn LangGraph state for the latest candidate-search failure and whether any candidate query succeeded. An unresolved failure is carried into report limitations; when no query succeeded, the summary explicitly says the result is unknown and cannot be read as zero matches. A later successful query clears the unresolved failure, allowing a real zero-result page to be reported accurately. Error text is truncated and token-like values are redacted before it enters graph history or the user-facing report. Existing FBref 403/429 terminal handling remains intact.

The tool progress lifecycle already emits a notice on failure and a completed event on successful recovery; the new conversation tests assert that distinction and verify the secure report path.

Verification: both new LangGraph conversation tests passed; 15 prior UI request/plan/API tests passed; API and web production build and `git diff --check` passed. A broad conversation-suite run encountered the existing StatsBomb model-processing consent gate in unrelated fixtures; that gate was not changed.

## Comments

- 2026-10-05：真实外部请求不可达时，工具失败不能被压成空候选。本 issue 通过注入型 `PlayerRepository` 失败夹具验证 LangGraph 状态和报告，不调用线上 provider 或读取用户凭据。
- 2026-10-05：追加“失败后恢复成功”场景，确认失败状态只在同轮后续查询成功时清除，且实际成功的零匹配页面仍保留为零结果。
