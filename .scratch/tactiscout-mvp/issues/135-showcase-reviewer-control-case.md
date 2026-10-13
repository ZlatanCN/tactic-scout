# Show the Reviewer repair and no-change control together

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: 134

## Goal

Make the public showcase explain the deterministic evidence gate using both observed behaviors: it repaired a missing focus reference in one scenario, and left an already-grounded shortlist unchanged in another.

## Scope

- Replace the one-scenario-only ablation presentation with a compact two-case comparison sourced from issues 132 and 134.
- Lead with the conclusion, then show per-case repeat counts, paired Harness checks, repair/no-repair result, and candidate/trace equality.
- Keep historical scenarios generic, omit player/team identities and raw IDs, and retain the small-sample and no-ranking-quality caveats.
- Preserve responsive behavior at desktop and 390 CSS px.

## Resolution criteria

- Both cases and their distinct outcomes are represented accurately; the second case is described as a no-change control, not as a failed Reviewer.
- The section distinguishes 3 repeated pairs per scenario from independent scenario count, and makes no claim about candidate ranking quality or framework superiority.
- Web production build passes and browser inspection confirms the section fits desktop and 390 CSS px without horizontal page overflow.

## Answer

Updated `/showcase` to lead with the conditional behavior and show two side-by-side case cards. The forward-replacement case shows 29/29 versus 28/29 checks and a one-reference repair in each of three pairs. The U23 midfielder control shows 30/30 in both arms, no Reviewer problems or repairs, and unchanged outputs across three pairs. Both cards state that Planner/tool traces and candidate lists matched. The caveat separates six repeated pairs from two distinct scenarios and keeps shortlist quality `not_evaluable`.

`pnpm build:web` passed. Browser inspection at desktop width confirmed both cards fit. At a 390 × 844 CSS-pixel viewport, the page and body scroll widths were both 390 px and each card's scroll/client widths were both 321 px. The showcase preview is open in the Codex in-app browser. No automated test suite was run.

## Comments

- 2026-10-10: The second ablation result strengthens the explanation: the Reviewer repaired a defect in one case and made no change in the already-grounded control. The display remains a behavior demonstration, not a ranking-quality claim.
