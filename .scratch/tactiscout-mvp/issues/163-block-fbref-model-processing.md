# Block FBref records from model processing without source permission

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the runtime match the documented FBref restriction. Sports Reference explicitly prohibits using its content for AI prompting/instructing and model-generated output without permission; the current `PlayerRepository` mode can still enter the regular LangGraph conversation.

## First-principles boundary

- Reject an FBref-backed recruitment turn before reading its checkpoint, loading players, or calling the Planner.
- Return an actionable service-unavailable response that says this source cannot be processed by the Agent and points users to a permitted data mode.
- Do not add a self-attested environment switch that implies permission from the source. Preserve the adapter for isolated parsing/regression fixtures; do not use it in the Agent path.
- Keep the normal Understat and other approved/configured conversation paths unchanged.

## Accepted verification seams

- `createApp` HTTP behavior for a configured LangGraph conversation using an FBref repository.
- The natural-language conversation/report path remains covered by its existing full-chain regression.

## Acceptance criteria

- [x] The public recruitment-turn endpoint returns HTTP 503 for an FBref repository with a clear source-specific explanation.
- [x] The rejected turn performs no player reads and no Planner calls.
- [x] The gate runs before checkpoint access and cannot be bypassed by an environment variable or a loopback model endpoint.
- [x] Other configured repositories retain their existing behavior.
- [x] Source documentation and issue 36 accurately distinguish a page being readable from permission to scrape, retain, prompt a model, and display data.
- [x] The portfolio README states that the source-processing gate is enforced at runtime.
- [x] Focused regressions and production builds pass.

## Research

- [Official Sports Reference Data Use](https://www.sports-reference.com/data_use.html) and [Terms of Use, clause 5](https://www.sports-reference.com/termsofuse.html) explicitly restrict copying or using site content for AI training, fine-tuning, prompting, instructing, or generated outputs without permission.
- [Official bot traffic guidance](https://www.sports-reference.com/bot-traffic.html) describes rate limits; it is not permission to bypass an observed HTTP 403.
- [2026-10-12 route revalidation](../research/fbref-route-revalidation-2026-10-12.md) records that no FBref player/stat page was retried and the observed 2026-10-04 403 remains a per-request stop condition, not proof of permanent site-wide unavailability.

## Comments

- 2026-10-12: Started after comparing the existing source policy in `docs/data-sources.md` with the graph turn gate. StatsBomb has a runtime gate, but FBref did not; a configured FBref repository could therefore be passed to the Planner even though the documented route says not to use it for model/RAG processing.
- 2026-10-12: The accepted HTTP regression first failed with HTTP 502 after observing an actual Planner call for an FBref repository. The runtime now rejects the turn with HTTP 503 before checkpoint access, player reads, or Planner calls; a fake `TACTISCOUT_FBREF_AI_PROCESSING_ALLOWED=true` and local Ollama URL do not override the gate. Full deterministic suite 393/393, API/Web production builds, and `git diff --check` pass.

## Answer

Added the FBref check to the existing pre-turn policy seam used by the LangGraph runtime. It stops the request before checkpoint lookup or data/model work and returns an actionable source-specific 503. No user-controlled environment flag claims permission on Sports Reference's behalf. Existing demo, Understat, and other providers keep their prior path. Updated the portfolio README and `docs/data-sources.md`; moved issue 36 from stale `claimed` to `open / needs-info` pending source-side permission or a different approved route.

Verification: the HTTP test failed before the fix because the Planner ran, then passed after the fix while asserting zero checkpoint reads, zero player reads, and zero Planner calls. `pnpm test` passed 393/393; `pnpm build`, `pnpm build:web`, and `git diff --check` passed.
