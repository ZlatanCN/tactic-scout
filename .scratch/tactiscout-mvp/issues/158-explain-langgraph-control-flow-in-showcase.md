# Explain the LangGraph control flow in the project showcase

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Help a hiring manager see why this recruitment workflow is modeled as a stateful graph: the Planner chooses research actions, tool results return to shared case state, missing information interrupts the run, and the Reviewer can route a report back for repair.

## Requirements

- Add a compact, accessible workflow map to `/showcase` after the recorded investigation story and before the mechanism studies.
- Match the current graph in `src/agent/conversation.ts`: user turn → Planner/policy choice → typed research tool loop → either user interrupt/resume or finish → evidence Reviewer → targeted retry or report. Show optional post-review enrichment only as optional.
- Distinguish the Planner's proposed action from graph policy and Reviewer responsibilities; do not imply that the model controls every transition.
- Explain that a clarification pauses and resumes the same case state, backed by the configured LangGraph checkpointer.
- Keep the real investigation and report first. Make the map useful at narrow widths and with keyboard/screen-reader navigation.
- Do not claim parallel research, autonomous transfers, ranking accuracy, or framework superiority without evidence.

## Verification

- [x] Production Web build passes.
- [x] Every depicted transition is checked against the compiled graph and same-case interrupt/resume implementation.
- [x] Accessibility semantics, focus behavior, and narrow viewport layout are reviewed without changing a user-owned `/review` tab or preview process.
- [x] Existing recorded-run story remains before the workflow map and experiment details.

## Research

- [LangGraph.js: Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph) describes decomposing a workflow into nodes connected through shared state, using interrupts for user-fixable missing information, and resuming with a checkpointer. This is the relevant conceptual basis; the map must still reflect TactiScout's actual graph rather than the guide's example workflow.

## Comments

- 2026-10-11: Opened after reviewing the current recorded-run showcase, compiled recruitment graph, and official LangGraph.js documentation. The timeline explains one observed run; this issue adds a separate, short explanation of the reusable control-flow architecture without replacing that evidence.
- 2026-10-11: Added the standalone `ShowcaseWorkflowMap` after the recorded story and before experiment details. Its Planner/tool loop, interrupt/resume path, Reviewer retry, and report path match the current graph and SQLite-backed app checkpointer. A hidden isolated preview at port 5186 confirmed the desktop layout and accessibility tree; the map adds no keyboard stops. At narrow widths, the CSS stacks both grids at 720px with no forced minimum widths. The viewport override did not change the browser's measured size, so no exact 390px screenshot is claimed; the separate issue 144 manual review remains untouched. `pnpm build:web` and `git diff --check` pass.

## Answer

Added an accessible control-flow map explaining the current LangGraph design: case state feeds Planner-plus-policy routing; typed research tools return to the Planner; `ask_user` pauses through `interrupt` and resumes from the same checkpoint; and `finish` passes through a deterministic Reviewer that either returns to the Planner for repair or allows the report path. Optional post-review enrichment is labeled optional. The map distinguishes model-proposed actions from graph policy and evidence review, and does not claim recommendation quality or framework superiority.

Validation: the Web production build and `git diff --check` pass. The isolated desktop preview and accessibility tree confirm the map sits after the real recorded investigation and before the seven experiment disclosures. Narrow CSS stacks the main flow and its two outcomes; the browser viewport control did not apply an exact 390px override, so this is a responsive CSS review rather than a pixel-verified 390px check.
