# Clarify blind-review packet onboarding

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the empty `/review` state explain what an invited reviewer should import and how a project maintainer provides that file, without exposing answer keys or requiring reviewers to run the Agent.

## Acceptance criteria

- [x] The import state names the expected anonymous review packet in plain Chinese and distinguishes it from the answer key.
- [x] An accessible, collapsed help section separates reviewer steps from maintainer steps and names the local CLI help command.
- [x] The page keeps explaining that files and drafts stay in the browser and no model/API is needed to score a packet.
- [x] Reviewer onboarding does not expose a candidate identity, ranking, answer key, local `.data` path, or private evaluation output.
- [x] The Web production build passes and the running `/review` accessibility tree exposes the new instructions.

## Answer

Rewrote the empty-state instructions to identify the anonymous review packet, distinguish it from the separately held answer key, and explain the two roles: invited reviewers import the packet without running the Agent; maintainers generate the packet and key locally, share only the packet, and adjudicate after independent reviews are locked. The help disclosure starts collapsed and exposes the exact CLI help command. The page continues to state that packet review is local and does not need a model/API.

Verification: the production build passes. The production `/review` accessibility tree shows the new instructions after expanding the disclosure, while the initial state exposes it as collapsed. The visible text contains no candidate identity, system ranking, answer key contents, `.data` path, or private evaluation output. `pnpm export:shortlist-review -- --help` prints the documented local usage.

## Comments

- 2026-10-12: Started after inspecting the open `/review` page. It asked users for a Harness-exported JSON file but did not explain whether a reviewer or maintainer should produce it; this can stall the project's human-evaluation workflow.
- 2026-10-12: Clarified the reviewer/maintainer handoff and added a collapsed accessible help disclosure. Verified the built production page at `127.0.0.1:4173/review`; the original `5173` Vite preview remained open and unchanged. Expanded `/review` accessibility tree exposed the role-separated steps and CLI help command; production build and CLI help passed.
