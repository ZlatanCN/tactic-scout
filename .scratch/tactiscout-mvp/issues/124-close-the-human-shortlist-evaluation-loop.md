# Close the human shortlist evaluation loop

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: 119, 120, 121, 123

## Goal

Connect the local blind-review workbench to the existing offline shortlist evaluator so independent human judgments can become a reproducible, query-scoped nDCG result only after explicit human adjudication.

## Scope

- Import one schema-v2 reviewer packet and at least two complete anonymous submissions for that exact packet.
- Reject duplicate reviewer IDs, duplicate/missing/extra card ratings, packet/hash mismatch, malformed answer keys, and incomplete adjudications.
- Before adjudication is locked, show only the frozen role/evidence cards and reviewer ratings; do not load or show candidate identity, team, system, or rank.
- Let a human adjudicator assign 0–3 or `unknown` to every anonymous card without averaging or auto-resolving disagreement.
- Only after all adjudications are locked, load the separate answer key and join system rankings by anonymous card ID.
- Generate a schema-valid `human-shortlist-quality-v1` input and compute it with the existing `evaluateShortlistQuality` function; export the evaluation input for independent CLI reproduction.
- Keep drafts and files local. Do not claim the interface can verify reviewer independence or that one query proves general ranking quality.

## Public seams

- `createShortlistQualityDataset(input)` validates the reviewer packet, complete submissions, answer key, and adjudications; it emits the existing evaluator schema with anonymous card IDs as candidate IDs and does not propagate player identity fields.
- Browser workflow: import packet + independent submissions → review anonymous evidence and scores → adjudicate all cards → lock adjudications → import answer key → calculate and export evaluation input.

## Acceptance criteria

- [x] The pure function requires at least two distinct, complete reviewer submissions for the same packet and exact card pool.
- [x] Unknown grades remain unknown and suppress nDCG under the existing evaluator; they are never converted to zero.
- [x] The answer key is not imported or displayed before adjudications are complete and locked.
- [x] The final evaluation input uses anonymous card IDs for candidates and rankings, keeps reviewer grades/adjudications, and omits player/team identity fields.
- [x] The browser reports judgment coverage, numeric-grade agreement, unknown-involving pairs, evaluability reasons, and per-system nDCG without implying general accuracy.
- [x] Browser import, rating comparison, adjudication, lock-before-key flow, evaluation, reload recovery, and JSON export are verified with synthetic local fixtures.
- [x] Focused tests exercise the approved pure-function seam; the full browser flow was manually verified; API and Web builds pass.
- [x] Evaluation documentation, ADR and map distinguish agreement, adjudication, nDCG, and reviewer-independence limits.

## Context

- [Human-labeled shortlist benchmark](119-human-labeled-shortlist-benchmark.md) provides the existing evaluator and refuses to score incomplete or unknown-labeled pools.
- [Blind packet export](120-export-blinded-shortlist-review-packets.md), [Harness export](121-export-review-packets-from-harness-runs.md), and [local review workbench](123-local-blinded-review-workbench.md) provide the frozen packet and independent submissions.
- The packet's answer key contains candidate identities and system ranks. The final evaluation dataset can stay de-identified by using `cardId` as `candidateId` after the blind ratings are locked.

## Answer

Implemented `createShortlistQualityDataset(input)` and the local `/adjudicate` workbench. The pure function validates that at least two reviewer IDs are distinct, every reviewer covers the exact packet card pool, the answer key matches the packet and frozen snapshot, and every card has one adjudicated 0–3/`unknown` grade. It joins system rankings only after the browser locks adjudications and emits evaluator input with anonymous card IDs; player names, teams, and source player IDs are not propagated.

The browser now imports the packet and completed submissions, presents each anonymous card with the reviewers' original scores, stores and restores the adjudication draft in localStorage, locks all grades before revealing the answer-key picker, computes the existing query-scoped evaluator result, and downloads both reproducible input and result JSON. Unknown remains a distinct category; numeric-only agreement and unknown-involving pairs are reported separately from raw categorical agreement.

Verification:

- Focused Node test run: 32/32 passed, including exporter → blind packet → de-identified evaluator-input integration.
- Full deterministic suite: `pnpm test` passed, 356/356.
- `pnpm build` passed.
- `pnpm build:web` passed.
- Manual browser workflow used only synthetic fixture files: two complete reviewer submissions for three anonymous cards; lock-before-key behavior; 3/3 double-rating coverage; 67% categorical and numeric agreement; synthetic nDCG@5 values of 1.0000 and 0.6064; input and result downloads; reload recovery; no identity fields in the exported evaluator input; and no horizontal overflow at a 390 px viewport. Browser console error log was empty. The synthetic localStorage draft and temporary fixture files were cleared afterward.
- No real player judgments were created, and these synthetic scores do not measure TactiScout recommendation quality. The interface cannot prove reviewer independence.

## Comments

- 2026-10-10: Resolved after pure-function, API/Web build, and synthetic browser verification. Human collection of real, independent judgments remains the next evaluation activity.
