# Show the investigation-planning ablation in the run showcase

Type: task
Status: claimed
Labels: ready-for-human
Blocked by: none

## Goal

Make the completed adaptive-vs-single-pass investigation comparison understandable in `/showcase` without configuring a model or exposing local candidate identities.

## Requirements

- Follow the previously selected B presentation: state the conclusion first, then let readers expand protocol and limitations.
- Show both frozen scenarios with pair count, per-run Harness checks, Planner request counts, tool counts, evaluated candidate counts, clarification count, recommendation counts, and observed data gaps.
- Keep recommendation counts descriptive; do not label either arm better or infer ranking quality.
- Explain the baseline, curated snapshot, missing token accounting, and small-sample limits in a collapsed methods section.
- Keep candidate IDs and original traces private.

## Verification

- [x] Desktop browser review confirms the conclusion-first card, both scenario tables, and collapsed method note render in `/showcase`.
- [x] Responsive CSS reviewed: scenario cards stack below 760px; the heading stacks below 420px; tables are fixed-layout and contained by a horizontally scrollable wrapper.
- [x] Web production build passes.
- [ ] User manually inspects the page at exactly 390 CSS px and verifies the method note both collapsed and expanded. Do not treat a different viewport check as completion of this review.

## Comments

- 2026-10-10: Created after issue 143 completed its live Qwen 3.5 9B paired runs. Results and cautious interpretation are already in `docs/evaluation.md`; this issue adds the portfolio-facing presentation.
- 2026-10-10: Added the component and verified it in a desktop browser. The embedded browser has no viewport-size control, and its URL policy blocked the temporary local-file responsive preview; the exact 390px browser check remains for a human reviewer. The CSS breakpoint behavior was inspected, but this does not substitute for that check.
- 2026-10-10: The user chose to perform the exact 390px check manually. Keep this issue claimed and `ready-for-human` until that review is complete; the isolated preview remains available at `http://127.0.0.1:5185/showcase?qa=2`.
- 2026-10-13: The current in-app browser exposes a temporary viewport override; it was used at 400px for the separate issue 172 check and then reset. The user explicitly reserved the exact 390px layout/method-note review for themselves, so this issue remains `ready-for-human` with its verification item unchecked.
- 2026-10-13: Refreshed the conclusion-first card and README from the post-guard three-pair runs in issue 193. The current figures now show 20/19 evaluated candidates, 6/8 tools, adaptive-vs-fixed recommendation counts of 3/1 in both scenarios, and complete provider usage for all 36 Planner requests. Added the fresh offset-zero search after the second user confirmation to the collapsed explanation. The requested 390px collapsed/expanded review remains for the user and is still unchecked.
