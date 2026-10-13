# Extract the scouting report panel behind one view interface

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Give the evidence-heavy scouting report a single, maintainable UI module so report layout, comparison state, source disclosures, and empty-state handling can evolve without expanding the main workbench coordinator.

## Acceptance criteria

- [x] The workbench coordinator passes one discriminated report-panel view model and handles only panel actions.
- [x] The report module owns empty-state rendering, report composition, comparison selection, source details, and report-only formatting.
- [x] Existing report wording, progress-to-report state, comparison limit, evidence caveats, and source links remain unchanged.
- [x] The module has a small interface with explicit invariants; no app-level or model dependencies are introduced.
- [x] Web production build succeeds, and the live workbench still renders its empty state after hot reload.
- [x] Issue map and this issue record the module seam and verification evidence.

## Design

Use one `ScoutingReportPanel` interface receiving a discriminated `empty | report` view model plus a small action callback. The module owns rendering and comparison state. The workbench retains API calls, saved plans, conversation state, and decides which view model to pass.

## Answer

Implemented in `web/src/RecruitmentReportPanel.tsx`. Its two-variant `view` makes the empty connection state and retained/complete report state explicit; the parent sends only `retry_dataset` and `open_observations` actions back. Comparison selection and report-only presentation helpers now live with the report. A small pure `formatDate` module is shared with the workbench's saved-plan timestamps.

The move preserves the existing report markup and wording. The report view still owns its three-player comparison cap and clears selection when a new report object arrives. API calls, conversation state, plan persistence, and case transitions remain in `App.tsx`.

Verification: `pnpm build` and `pnpm build:web` passed; `git diff --check` passed. The running `http://127.0.0.1:5173/` workbench hot-reloaded and its accessibility tree still exposes the existing empty report state, current FPL source scope, and dataset limitations.

2026-10-09: resolved. This verifies the module extraction and initial live render; it does not claim a new report-state interaction or screen-reader announcement test.

## Comments

- 2026-10-09：从 `App.tsx` 读取到报告视图、数据范围说明、来源上下文、对比状态和格式化 helper 混在案件对话协调代码中。报告面板是可通过小接口隔离的本地 React 模块；无需新增 provider 或 fake adapter。
