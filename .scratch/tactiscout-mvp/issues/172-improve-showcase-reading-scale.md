# Improve the recorded-run showcase reading scale

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the portfolio's model-free `/showcase` readable at presentation size while preserving its conclusion-first story, restrained visual style, compact metadata, and evidence limitations.

## Evidence and design boundary

- The current stylesheet sets several important items to 9px: recorded-run step details, limitation text, source attribution, and experiment summaries. The first 589 CSS-pixel preview turned out to be an older page than this workspace, so it is not used as evidence about current responsive behavior.
- Keep decorative eyebrows and compact metadata visually subordinate. Raise narrative, evidence, and limitation copy together; do not enlarge every label or convert the page into a denser dashboard.
- W3C WCAG 2.2 SC 1.4.4 requires text resizing to 200% without loss of content or functionality; it does not prescribe an author font-size minimum. SC 1.4.12 requires authored content to survive user-applied text spacing without loss. This issue uses those as layout robustness checks, not as a claim of conformance from font size alone.

## Requirements

- Increase the readable type scale for run narrative, evidence summary, limitations, experiment descriptions, and source attribution; target 12px or larger for explanatory text at narrow widths.
- Keep labels, dates, source keys, and decorative eyebrows distinct from body copy without relying on low contrast or extremely small text for essential information.
- Preserve the selected conclusion-first hierarchy and all existing wording, report boundaries, links, and mechanism disclosures.
- Keep text containers fluid under browser text resizing and spacing overrides; do not clip or overlap content or controls.
- Do not claim the separate exact-390px manual check from issue 144 has been completed.

## Verification

- Review the rendered `/showcase` in the available browser viewport and inspect computed sizes for key copy.
- Confirm at least one narrow responsive state has no page-level horizontal overflow; inspect the 390px media rules in CSS, without claiming a manual 390px browser check.
- Verify disclosures, source links, and all caveats remain present in the accessibility tree.
- `pnpm build:web` and `git diff --check` pass.

## Research

- [WCAG 2.2 Understanding SC 1.4.4: Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html): text must resize up to 200% without loss of content or functionality; no specific CSS pixel minimum is prescribed.
- [WCAG 2.2 Understanding SC 1.4.12: Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html): content must remain usable when users override line, paragraph, letter, and word spacing.

## Answer

Raised the explanatory copy, evidence summaries, limitations, experiment takeaways, and source attribution to a readable 12px baseline with stronger contrast. Decorative eyebrows and secondary labels remain visually subordinate.

Verification: inspected the current `/showcase` in the browser at a 400px CSS viewport. Key explanatory selectors compute to 12px; the page and visible copy have no horizontal overflow. Applied a temporary text-spacing stress override (1.5 line height, 2em paragraph spacing, 0.12em letter spacing, 0.16em word spacing), expanded all seven mechanism disclosures, and confirmed no page overflow. The accessibility tree still exposes all seven disclosures, four source links, and the recommendation-quality caveat. Reload removed the temporary override and the viewport override was reset. `pnpm build:web` and `git diff --check` passed. This does not claim the separate exact-390px manual check in issue 144.

## Comments

- 2026-10-12: Source inspection found several key copy selectors at 9px. The first screenshot came from port 5173, which showed an older showcase without this worktree's seventh evaluator study; it was not used as evidence about current rendering. The isolated worktree preview on port 5180 is the current page; its desktop view was checked at 1280×720.
- 2026-10-12: Raised the story narrative, evidence summary, experiment takeaways and limitations, source attribution, and next-step copy to 12px using relative `rem` sizes; darkened key explanatory text. In the current workspace preview at 1280×720, key copy computes to 12px, all seven mechanism disclosures and four source links remain present, and document width equals viewport width. The available browser has no viewport-size control and the repo has no Playwright/headless-browser dependency; narrow-screen rendering and text-spacing overrides remain unverified, so this issue stays claimed.
- 2026-10-12: Expanded the current latency study and confirmed its explanation and caveat compute to 12px, chart sample annotations to 10–11px, and run values to 12px in the 1280×720 preview. The rendered chart remains readable at desktop width, all seven disclosures and four source links are still present, and the page has no desktop horizontal overflow. Narrow-screen rendering and text-spacing overrides remain unverified; this issue stays claimed.
- 2026-10-13: Completed narrow-screen and text-spacing checks using the browser's temporary viewport capability; this supersedes the 2026-10-12 notes about unavailable viewport controls. The test used 400px, not issue 144's reserved 390px manual check.
