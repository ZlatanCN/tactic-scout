# Show where real LangGraph investigation time goes

Type: prototype
Status: resolved
Labels: ready-for-human
Blocked by: none

## Question

How should the no-model `/showcase` explain the newly measured difference between end-to-end investigation time, model-backed Planner decisions, and local tool execution so a hiring manager can understand the harness without mistaking operation percentiles for a sequential waterfall or recommendation-quality evidence?

## Scope

- Prototype three structurally different layouts on `/showcase`, switched by `?variant=a|b|c`.
- Use only the verified three-run curated/Qwen benchmark summary from issue 129.
- Keep whole-run samples separate from per-operation samples and state that operation spans must not be added to derive end-to-end time.
- Explain that Planner decision duration includes request handling and local validation, not only inference; p95 over three runs is the largest observed run.
- Do not expose player identity, raw trace, prompts, or model reasoning; keep the switcher development-only.

## Resolution criteria

- Three layouts present the same source-backed facts and limitations with meaningfully different hierarchy.
- A reviewer can switch and deep-link to variants on the existing showcase route.
- Each variant remains readable in the browser accessibility tree and at narrow width.

## Comments

- 2026-10-10: Started from issue 129's real latency summary. The candidate interface is the existing recorded `/showcase`; this prototype compares presentation, not runtime behavior or agent quality.
- 2026-10-10: Added three dev-only variants on the existing route: A benchmark panel, B an editorial long-tail explanation, and C an observability console. All use the same verified 2026-10-10 three-run summary and distinguish it from the 2026-10-09 recorded single run already on the page. The switcher supports URL variants and left/right keys; production builds render no prototype UI.
- 2026-10-10: `pnpm build:web` passes. Loaded A/B/C in the browser and checked the accessibility tree for headings, run samples, operation tables, and caveats. This was not a screen-reader or narrow-viewport visual review; the user should compare the three layouts before selecting one.

## Answer

The user selected **B · Long tail explained** because it leads with the conclusion, then shows the three whole-run samples and the separately scaled Planner/tool event distributions. The full A/B/C comparison is preserved as the primary source on branch `codex/prototype-showcase-latency` at commit `9fb3273`; production implementation and evidence boundaries are recorded in [issue 131](131-showcase-latency-summary.md).

## Comments

- 2026-10-10: The user selected B. The production version keeps the conclusion-first hierarchy and removes the variant switcher. CSS includes a single-column narrow layout; no screen-reader claim is made.
