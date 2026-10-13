# Prototype a story-first portfolio showcase

Type: prototype
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Question

How should `/showcase` help a hiring manager understand TactiScout's agent behavior and evidence in under a minute, while keeping the real run and controlled ablation details available without placing six long experiment cards ahead of the recorded investigation?

## Scope

- Prototype three structurally different information hierarchies on the existing `/showcase` route using `?variant=a|b|c`.
- Keep the recorded Wyscout run, current experiment aggregates, source attribution, and caveats unchanged.
- Make the distinction between Harness behavior and shortlist quality visible in every variant.
- Add a development-only prototype switcher; do not expose the switcher or prototype variants in production builds.
- Preserve all current ablation details in a navigable, progressive-disclosure form.
- Promote the clearest design into the real page after review; retain throwaway variants only on the prototype branch.

## Verification

- [x] Each variant has a different information hierarchy, not just different styling.
- [x] All displayed counts, source scope, and caveats match the existing issue/evaluation evidence.
- [x] Desktop visual review confirms the story is understandable without expanding every experiment.
- [x] Narrow-screen layout keeps text, controls, and tables usable without page-level horizontal overflow.
- [x] Web production build succeeds and the switcher is absent from production output.

## Context

The current page places six substantial Harness, RAG, interaction, ask-policy, Reviewer, and Planner experiment sections before the recorded run's five-step journey and report snapshot. The evidence is valuable, but its current order makes the first-time portfolio narrative long and hard to scan.

## Comments

- 2026-10-10: Started after reading the existing `/showcase` accessibility tree and project docs. The page contains one recorded run followed by six experiment sections before the run's execution story; propose testing story-first, timeline-first, and research-brief hierarchies.

## Answer

Promoted the conclusion-first story layout to the normal `/showcase` page. It presents the recorded run, five observed turns, report snapshot, and evidence limits before the six experiment summaries; experiment findings and limitations remain visible, with their longer protocols available through native `<details>`. The other two information hierarchies remain available only in development through `?variant=b|c`; the development switcher and alternate layout code are removed from the production JavaScript bundle.

Reviewed A/B/C on desktop and at a 390 × 844 CSS-pixel viewport. The narrow review found and fixed the timeline variant's compressed proof stamp. The final production build passed; its JavaScript contains none of the alternate-layout labels, component names, or switcher UI text. The shared stylesheet retains unused prototype selectors, but production renders no switcher or alternate layout. This browser review covers the showcase prototype and does not replace the user's separate manual issue 144 check.

The story-first choice follows the cited GOV.UK guidance to keep commonly needed information visible, use Details only for supplementary information, and avoid tabs for sequential reading or cross-panel comparison. This is a design decision informed by official guidance, not a usability study. Research note: [showcase-information-hierarchy-2026-10-10.md](../research/showcase-information-hierarchy-2026-10-10.md).
