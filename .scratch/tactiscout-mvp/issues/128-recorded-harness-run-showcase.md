# Add a no-model recorded Harness run showcase

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Let a hiring manager inspect a real, completed LangGraph investigation from the browser without first installing or starting an LLM. Make the recorded nature, historical data scope, and evaluation limits obvious.

## Scope

- Add a first-class, read-only `/showcase` page backed by a sanitized snapshot of an existing successful end-to-end Harness run.
- Use the recorded Bayern replacement run on the TactiScout Wyscout 2017/18 snapshot: two clarification/resume turns, 30 evaluated candidates, 10 tool calls, one report entry framed as a follow-up lead, and 29/29 behavior checks passed in that single run.
- Show only safe, user-visible workflow facts and tool/action names. Do not add player names, IDs, hidden reasoning, full prompts, or fabricated clarification text.
- Attribute the historical source and state that the snapshot is not current market data and does not establish recommendation quality.
- Add an obvious entry from the live home page and a clear route back to the interactive workspace.
- Keep the existing local-model/live workflow unchanged.

## Acceptance criteria

- [x] A reviewer can open the recorded showcase without API, model, or dataset services running.
- [x] The page labels the run as a historical recording, shows its date and source scope, and distinguishes behavior checks from ranking quality.
- [x] The displayed counts and workflow sequence match the source Harness artifact and issue 121; no player identity or hidden reasoning is exposed.
- [x] A reviewer can move from the home page to the showcase and back to the live workspace.
- [x] The page is readable on desktop and narrow mobile viewports.

## Answer

Added a dedicated `/showcase` route backed by a reviewed, identity-free summary of the 2026-10-09 Qwen 3.5 9B + LangGraph Wyscout 2017/18 run documented in [issue 121](121-export-review-packets-from-harness-runs.md). The page shows two interruptions/resumes, 10 observed tool calls, 30 evaluated candidates out of a 601-record matching scope (40 read), 29/29 behavior checks, retrieved evidence counts, and the actual report's evidence limits. It does not reconstruct question text or expose player identity, IDs, hidden reasoning, or credentials. The evidence card describes the output as a follow-up lead, not a transfer decision.

Added a home-page entry, a return path to the interactive workspace, direct source/CC BY attribution, and matching README/demo-guide language. The README now gives standalone `pnpm install` + `pnpm dev:web` steps so a reviewer can open `/showcase` without starting API/model services. `CONTEXT.md` defines “录制运行展示” and distinguishes it from real-time execution and quality evaluation. Manual browser review covered the showcase route at desktop and 390px mobile widths; API/Web production builds passed. No tests were added or run.

## Comments

- 2026-10-10: Selected an existing completed Qwen/LangGraph run with two clarifications and a historical Wyscout source. The local artifact is ignored; only a reviewed, identity-free summary and safe action trace may be checked in.
- 2026-10-10: Implemented and visually reviewed `/showcase`; summary values were checked against the ignored Harness artifact and the recorded Wyscout run in issue 121.
- 2026-10-10: Checked the Figshare collection and Events item directly: the collection identifies Pappalardo and Massucco and requests citation to the 2019 data paper; the Events item lists CC BY 4.0. The page links the collection, item, paper DOI, and license.
- 2026-10-10: Verified the model-free launch command against the root and Web package scripts; the documented path starts Vite only.
