# Agent state contract and continuation

## Goal

Make completed workflow results trustworthy and reusable without replacing the current LangGraph state model. Keep the four independent successful snapshots, the message reducer, in-memory checkpointing, and the current graph nodes.

## Decisions

- Keep `messages` as the only reducer-backed channel.
- Keep four separate `conversationContext.active*` snapshots; add complete result data to comparisons.
- Keep `resultJson` during this change. Define full result schemas in the owning player/team data modules and centralize parsing/validation.
- Commit a successful snapshot and matching outcome in one node update before answer generation. A failed explanation must not erase completed data.
- Treat valid empty outcomes (`no_candidates` and source-clean `no_comparable_data`) as completed results. Reject malformed or inconsistent result payloads.
- Do not add a persisted continuation pointer or a database/store.
- Derive a temporary previous-turn summary before replacing `request`/`outcome`; select explicit target first, otherwise compatible previous workflow, otherwise clarify among multiple valid snapshots.
- Save an unresolved workflow choice and current-turn patch in the existing `pendingClarification`; merge only after the user selects a workflow. Omitted fields inherit, explicit `null` clears, and explicit values override.
- Reuse a saved result directly for explanation requests, with `outcome.source = "saved"`, skipping entity resolution and data tools.

## Acceptance

1. Partial result shapes cannot replace a prior successful snapshot.
2. Valid empty results are stored and can be refined.
3. A data result remains available when explanation fails.
4. Failed or ambiguous new work never silently reuses an unrelated old snapshot.
5. Explicit saved-result explanations use no data tools and remain the active workflow for the next refinement.
6. Ambiguous continuation preserves the user's patch through interrupt/resume.
7. Existing identity, comparison, recommendation, team recommendation, and fault-tolerance behavior remains covered by tests.

## Out of scope

Objectifying all result payloads, changing checkpointers, message pruning, a persisted continuation pointer, and broad request-schema cleanup.
