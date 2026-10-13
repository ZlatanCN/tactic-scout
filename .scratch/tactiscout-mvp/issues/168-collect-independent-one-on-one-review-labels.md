# Collect real independent labels for the one-on-one shortlist sample

Type: task
Status: open
Labels: ready-for-human
Blocked by: none

## Goal

Collect genuine, independent human judgments for the existing 20-card Barcelona U23 attacking-ground-duel review packet, then complete the existing anonymous adjudication flow. Keep the result scoped to this historical, single-role sample.

## Scope

- Use `.data/evaluations/barcelona-one-on-one-blind-packet-2026-10-10.json`; do not edit or regenerate the packet or its separate answer key.
- Have at least two football-informed reviewers independently rate every anonymous card using the packet's shared 0–3/`unknown` anchors. Reviewers must not see one another's submissions, player identities, or system ranks before submitting.
- Preserve each original submission. Do not average scores or replace `unknown` with zero.
- After both submissions are complete, use `/adjudicate` to rate every card and lock adjudications before loading `.data/evaluations/barcelona-one-on-one-answer-key-2026-10-10.json`.
- Export the de-identified evaluator input and result locally; keep all reviewer files and generated quality artifacts out of Git.
- Report nDCG only if the existing evaluator says the full frozen card set is evaluable. Any unknown or missing numeric adjudication leaves the result `not_evaluable`.
- Describe the judgment as query-specific human opinion about historical attacking ground-duel evidence. Do not generalize it to current players, transfer feasibility, all-round player quality, or professional scouting truth.

## Acceptance criteria

- [ ] Two distinct reviewers submit complete, independent ratings for all 20 anonymous cards.
- [ ] Reviewer roles/football experience are recorded only at a coarse, non-identifying level; do not collect unnecessary personal information.
- [ ] All 20 cards receive explicit adjudication before the answer key is loaded.
- [ ] The answer key is used only after adjudications are locked; no identity is added to the exported evaluation input.
- [ ] The existing evaluator result is reported verbatim as evaluable or `not_evaluable`, without converting unknown or missing judgments to zero.
- [ ] Reviewer submissions, adjudication, evaluator input, and result remain local-only and are not committed.
- [ ] Documentation states the sample's historical scope and that one query does not establish general shortlist quality.

## Context

- [Evidence-matched packet and source scope](141-evidence-matched-one-on-one-review-sample.md)
- [Human-labeled shortlist benchmark protocol](119-human-labeled-shortlist-benchmark.md)
- [Local blind-review workbench](123-local-blinded-review-workbench.md)
- [Adjudication and quality-evaluation loop](124-close-the-human-shortlist-evaluation-loop.md)
- [Human-judgment benchmark recheck](../research/adult-mens-shortlist-judgment-benchmark-recheck-2026-10-12.md)

The public-benchmark recheck found no directly applicable, rights-verified team-brief shortlist judgments. The nearest studies do not supply labels for this fixed query. This local packet is the next available route, but it still requires real independent reviewers; no scores or nDCG have been created.

## Comments

- 2026-10-12: Created after the public benchmark recheck returned NO-GO. The existing packet contains 20 anonymous historical evidence cards; no independent human submissions are present in the local evaluation files.
- 2026-10-13: All seven technical prerequisites are resolved. The 20-card blind packet, separate answer key, and review context are present under Git-ignored `.data/evaluations/`; no code work is blocked. Human handoff: give only the blind packet to each of two football-informed reviewers; each independently imports it at `/review`, rates all 20 cards using a distinct non-identifying reviewer code, and exports their submission. Keep submissions separate and do not reveal the answer key or system ranking before anonymous adjudication is locked. This issue remains `ready-for-human`; no judgments have been fabricated or entered.
- 2026-10-13: A reliability-methods audit recommends keeping current agreement rates descriptive, treating `unknown` as missing for ordinal coefficients, and deferring Krippendorff's ordinal alpha or weighted Cohen's kappa until real ratings support estimation. This single 20-card query cannot support a broad reliability claim; no coefficient or judgment was invented. See [inter-rater reliability research](../research/blinded-shortlist-interrater-reliability-2026-10-13.md).
