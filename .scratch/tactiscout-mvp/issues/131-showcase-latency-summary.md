# Present Harness latency as conclusion then evidence

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: 130

## Goal

Turn the user-selected B layout from issue 130 into a production-quality section of the model-free `/showcase`, explaining where the observed investigation time goes without overstating what three runs prove.

## Scope

- Lead with the observed latency conclusion, then show complete-run samples and per-operation evidence.
- Keep run-level percentiles separate from Planner and tool event samples; show independent category scales.
- State that Planner timings include request handling and local action validation, and that operation events must not be summed into end-to-end duration.
- Preserve the small-sample and recommendation-quality limitations; keep the section identity-free.
- Remove all variant-switcher and URL-query prototype behavior from the production page.

## Resolution criteria

- The user-selected conclusion-first hierarchy is on `/showcase`.
- The three full-run timings and every verified operation sample from issue 129 are represented with sample counts and p50/p95.
- The limitations are visible in the page itself.
- The component has a narrow-width layout and the web production build passes.

## Context

Prototype source: branch `codex/prototype-showcase-latency`, commit `9fb3273`. The user chose variant B because it states the conclusion before the evidence.

## Answer

Added `ShowcaseLatencySummary` as a focused production component and mounted it in the existing recorded-run showcase. It presents the conclusion and end-to-end p50/p95 first, then three individual run durations, then separate Planner and tool event groups with counts, p50/p95, and independent bar scales. The caveat explicitly identifies the small sample, explains what Planner time includes, says the run p95 is the maximum of three observed runs, and prevents reading the event samples as a sequential waterfall or a measure of recommendation quality. The A/B/C prototype and development switcher were removed from this working tree; the prototype remains on its throwaway branch.

## Comments

- 2026-10-10: Implemented the selected layout in `web/src/ShowcaseLatencySummary.tsx` and `web/src/ShowcaseLatencySummary.css`; integrated it into `RecordedRunShowcase`.
- 2026-10-10: `pnpm build:web` and `git diff --check` pass. Opened `/showcase` and inspected its accessibility tree: conclusion, each run and operation sample, and all caveats are present; the prototype switcher is absent. The CSS stacks breakdown groups below 720px; no separate narrow-viewport visual or screen-reader review was performed.
