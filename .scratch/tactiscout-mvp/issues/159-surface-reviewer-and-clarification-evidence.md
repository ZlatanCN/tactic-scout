# Surface Reviewer and clarification evidence in the project summary

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the README's core-mechanism summary reflect the verified Reviewer and ask-policy experiments already shown in `/showcase`, while keeping the conclusions scoped to their frozen scenarios.

## Acceptance criteria

- [x] Add concise summaries of the evidence-review gate and ask-policy ablations.
- [x] Include the observed behavior, scenario scope, and the most important limitation for each.
- [x] Link each statement to its protocol/results in `docs/evaluation.md` and source issues.
- [x] Do not describe Harness checks as recommendation-quality evidence or make general framework claims.
- [x] Check the Markdown diff for formatting and link-path consistency.

## Answer

Expanded the README's core-mechanism section with the verified ask-policy and Reviewer results. The summary distinguishes the unresolved-role safe pause from the clear-request control, and the scenario where the Reviewer repaired a reference from the one where it made no change. It links to the full protocols and retains the limits around answer availability, small frozen samples, and unmeasured shortlist quality.

Verification: reran the approved HTTP seams for the retired route (410 with no player reads) and the natural-language conversation pause/resume/report path (2/2 passed); `git diff --check` is clean.

## Comments

- 2026-10-11: The showcase presents these verified mechanism comparisons, but the README's mechanism summary currently omits them. The source of truth is the existing evaluation documentation and resolved issues; this is a documentation alignment task, not a new experiment.
