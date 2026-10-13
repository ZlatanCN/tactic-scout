# Surface the strongest mechanism result first in the showcase

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Help a hiring reviewer reach TactiScout's strongest, carefully scoped full-graph mechanism result before lower-signal latency details.

## Acceptance criteria

- [x] The story-first page continues to show the recorded investigation and LangGraph control-flow map before experiments.
- [x] The evidence-evaluator ablation is the first experiment disclosure and its summary remains accurate: observed evidence changes the report in this frozen case; ranking quality is not evaluated.
- [x] The other mechanism studies remain available with their current findings, boundaries, and collapsed-by-default behavior.
- [x] The production Web build passes and the current preview's accessibility tree exposes the updated order.

## Answer

Reordered the existing mechanism disclosures so the evidence-evaluator full-graph ablation appears first, followed by adaptive planning and interaction studies; RAG and latency details remain available later. Its collapsed summary now surfaces the verified paired result (3 leads / 6 references per enabled run; withheld arms abstained). The recorded case and LangGraph control-flow map still precede the experiment section, and all seven studies remain collapsed by default. No experimental claims or result values changed.

Verification: `pnpm build:web` passes. The current local preview at `127.0.0.1:5180/showcase` exposes the evidence-evaluator study as item 01, followed by planning as item 02 and all seven studies in the intended order. `git diff --check` passes.

## Comments

- 2026-10-13: Read-only review of the current `/showcase` accessibility tree showed the evidence-evaluator ablation—the strongest measured result that directly supports the project's core claim—listed seventh after latency and secondary mechanism studies. This is a presentation-order change; it does not strengthen or broaden the experiment's claims.
- 2026-10-13: Moved that study to item 01, placed the adaptive-planning comparison next, and exposed the verified leads/citations count in the collapsed summary. Kept the story, control-flow map, all seven collapsed disclosures, and every limitation intact. Production build and the live preview's accessibility tree confirm the final order and summary.
