# Surface the shared shortlist-fit rating anchors to reviewers

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Make every human reviewer and adjudicator use the same project-defined 0–3/`unknown` role-fit rubric, without exposing candidate identity, model ranking, or model rationale.

## Context

- The project rubric already exists in [the recommendation evaluation protocol](../research/scouting-recommendation-evaluation-protocol-2026-10-06.md); [ADR 0008](../../../docs/adr/0008-human-shortlist-judgments.md) establishes that labels are scenario-specific judgments.
- `/review` has a hard-coded expandable rubric, `/adjudicate` has separate short labels, and the exported review packet carries only general instructions. The definitions can drift, and offline reviewers do not receive the rubric with their packet.
- The research refresh confirms no statistical code change is justified while real labels are absent. This ticket improves the human-label collection protocol; it does not create judgments or change nDCG semantics.

## Scope

- Define one shared rubric source for grades 0, 1, 2, 3, and `unknown`, matching the project protocol.
- Include the anchors and missing-evidence rule in exported reviewer instructions.
- Display the same anchors in the `/review` rating choices and `/adjudicate` controls.
- Preserve the distinction between evidence of poor fit (0) and insufficient evidence (`unknown`).
- Keep the rubric scenario-bound and descriptive; do not introduce metric thresholds or claim calibration/reliability.

## Public seams

- `exportBlindedReviewPackets(input)` and the existing local CLI output contract, including `reviewerInstructions`.
- The browser workflow: import a packet in `/review`, inspect rubric anchors, rate and export; `/adjudicate` presents the same anchors while retaining anonymous cards and lock-before-key behavior.

## Acceptance criteria

- [x] Packet export gives reviewers explicit, shared meanings for every grade and `unknown`.
- [x] `/review` and `/adjudicate` render the same grade definitions from the shared rubric.
- [x] Missing or non-diagnostic evidence maps to `unknown`, never automatically to 0.
- [x] No system identity, candidate identity, rank, or model rationale is added to reviewer materials.
- [x] Existing review/adjudication behavior remains intact; verification uses the agreed exporter/CLI and review-workspace seams, plus server and Web builds.
- [x] Evaluation docs link the rubric and retain limits on ordinal ratings and nDCG's gain mapping.

## Answer

Added the shared `shortlistFitRubric` domain module and reused it in the reviewer packet exporter, `/review`, and `/adjudicate`. The packet now carries all five anchors, explicitly distinguishes missing evidence from grade 0, and says the project scale is not calibrated or a mechanical conversion of statistics. Both workbenches render the same expanded definitions. `CONTEXT.md`, ADR 0008, and the evaluation guide now define the scenario-bound meaning and disclose the evaluator's exponential gain assumption.

Verification: the new packet-contract test failed before the implementation and passed afterward. The packet, CLI-output, and review-workspace tests passed 18/18; `pnpm build` and `pnpm build:web` passed; `git diff --check` passed. No reviewer submissions, human judgments, or model outputs were created.
