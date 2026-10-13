# Record why LangGraph fits the scouting workflow

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the project's LangGraph choice explainable in an engineering interview by tying official framework capabilities to the actual recruitment-case lifecycle and the simplest credible alternatives.

## Acceptance criteria

- [x] Verify framework facts against official documentation for LangGraph and relevant higher-level/alternative TypeScript agent workflows.
- [x] Record the concrete requirements that drive the choice: dynamic investigation, policy-controlled routing, pausing for user input, resuming the same case, reviewer re-entry, durable checkpointing, and traceable progress.
- [x] Compare a one-shot LLM, a hand-written tool loop, and a higher-level agent abstraction without claiming universal framework superiority.
- [x] Link the decision to current code and observed Harness evidence; state which claims remain untested, including cross-framework performance or quality.
- [x] Add one concise pointer from the interview walkthrough or README to the decision record.

## Context

- [Architecture](../../../docs/architecture.md)
- [Constrained investigation stages](../../../docs/adr/0005-constrained-langgraph-investigation-stages.md)
- [Agent evaluation claim audit](../research/agent-evaluation-claim-audit-2026-10-13.md)

## Comments

- 2026-10-13: Claimed after an architectural focus review. The graph's case state, nodes, and routing are deliberately co-located because splitting them into many node factories would spread one control flow across modules; the missing artifact is the framework-selection trade-off, not another abstraction.

## Answer

Recorded the project-specific LangGraph decision in [ADR 0010](../../../docs/adr/0010-langgraph-stategraph-for-recruitment-cases.md), linked from the interview walkthrough. The decision describes LangGraph as the best fit for this explicit, resumable recruitment-case workflow while acknowledging that LangChain `createAgent` also provides checkpointing and human-in-the-loop and that Vercel AI SDK is a credible tool-loop alternative. The official-docs comparison and current-code audit are in the [research report](../research/langgraph-framework-fit-2026-10-13.md).

Existing deterministic tests and frozen Harness evidence support specific workflow claims, including checkpoint recovery and policy/evidence behavior. No matched cross-framework comparison was run, so no relative claim about quality, latency, cost, or maintenance is made; shortlist quality remains unevaluated. Documentation-only change; no tests run. `git diff --check` passed.
