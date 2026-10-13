# Name the configured LangGraph conversation options

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the configured conversation factory's optional settings explicit at both Fastify and Harness call sites, without changing graph behavior or exposing new internal seams.

## First-principles review

`configuredRecruitmentConversation` currently has eight positional arguments. Callers must remember their order, and the Fastify composition passes an `undefined` placeholder to reach the checkpoint option. This is avoidable caller knowledge at the app/Harness seam. The LangGraph construction remains a single cohesive graph module; this task does not split its nodes or duplicate graph state.

## Requirements

- Replace the positional factory parameters with one options object and a named options type.
- Keep `repository` required and preserve defaults for planner factory, reviewer mode, and ask-user mode.
- Preserve the current unavailable-model fallback and configured candidate identity grouper.
- Update Fastify and the local Harness call sites to use named fields.
- Do not change `createRecruitmentConversation`, LangGraph nodes/edges, ablation flags, or public turn behavior.

## Verification

- [x] TypeScript production build passes.
- [x] `git diff --check` passes.

## Answer

Replaced the eight positional factory parameters with `ConfiguredRecruitmentConversationOptions`. Fastify now names the repository, knowledge base, and optional checkpointer; the local Harness names its observer, reviewer/ask-user modes, Planner factory, and optional evidence evaluator. The configured factory still fixes the Reep identity grouper, defaults reviewer and ask-user modes to enabled, creates the same planner by default, and converts only `RecruitmentModelUnavailableError` to the unavailable conversation. It still does not expose the candidate-policy bypass. LangGraph nodes, edges, state, and turn interface were not changed.

Verification: `pnpm build` and `git diff --check` passed. No tests were added or run; this was a named-options interface refactor, not a core graph behavior change.

## Comments

- 2026-10-13: Claimed after the codebase-design audit found the positional app/Harness integration seam; graph internals themselves pass the cohesion check and remain untouched.
