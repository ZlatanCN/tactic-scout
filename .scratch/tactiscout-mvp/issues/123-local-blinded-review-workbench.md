# Capture independent shortlist ratings in a local blind-review workbench

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: 119, 120, 121

## Goal

Make the frozen, source-grounded blind-review packet practical for a football-informed reviewer to rate without exposing player identity, club identity, system ranking, or model rationale.

## Scope

- Import only the reviewer-facing packet; reject answer keys and malformed/unsupported packets.
- Present one anonymous evidence card at a time with the fixed 0–3/`unknown` fit rubric and visible completion progress.
- Save draft ratings and the packet locally in the current browser profile; allow reopening after reload.
- Export a completed, reviewer-specific ratings file containing anonymous card IDs only.
- Keep the adjudication/answer-key join outside the reviewer workflow. Do not claim reviewer independence or ranking quality from software behavior.
- Preserve keyboard use, screen-reader labels, responsive layout, and clear local-storage/privacy messaging.

## Public seams

- `createShortlistReviewSubmission(input)` validates a complete reviewer submission and emits only packet ID, opaque reviewer ID, anonymous card IDs, and 0–3/`unknown` ratings.
- `createShortlistReviewWorkspace(storage)` supports packet import, draft persistence/reopen, rating updates, and completed export through an injected key/value storage interface.
- Browser workflow: import packet → rate cards → reload/reopen draft → download submission.

## Acceptance criteria

- [x] The shared packet parser accepts current schema-v2 reviewer packets and rejects answer keys, malformed evidence, duplicate card IDs, and unsupported versions.
- [x] Reviewers can rate each anonymous candidate 0–3 or `unknown`; missing ratings block final export.
- [x] The interface shows one card at a time, useful evidence/provenance, the query role brief, and progress without exposing answer-key information.
- [x] Drafts are isolated by packet and reviewer ID and survive a browser reload in localStorage.
- [x] Exported ratings contain no player/team identity, system name/rank, model explanation, or raw evidence fields.
- [x] Browser import, one-card navigation, local save/reload, and submission download are manually verified at desktop and narrow widths.
- [x] Focused tests exercise the agreed pure-function and injected-storage seams; server and web builds pass.
- [x] Docs explain the 0–3/`unknown` rubric, independent review and later adjudication, local data handling, and that the export is not itself an nDCG result.

## Context

- [Human-labeled shortlist benchmark](119-human-labeled-shortlist-benchmark.md) remains `not_evaluable` until the full pool has two independent reviews and adjudicated grades.
- [Blind packet export](120-export-blinded-shortlist-review-packets.md) and [Harness export](121-export-review-packets-from-harness-runs.md) already provide the source-grounded, identity-separated input.
- [ADR-0008](../../../docs/adr/0008-human-shortlist-judgments.md) defines the subjective, query-specific 0–3/`unknown` rubric and forbids treating missing evidence as a zero.

## Answer

Implemented `createShortlistReviewSubmission(input)` and the injectable-storage workspace, plus the local `/review` browser workflow. The shared strict schema rejects answer keys and malformed/duplicate cards; submissions contain only benchmark/packet/reviewer IDs, anonymous card IDs, and grades. Drafts are isolated by packet/reviewer in localStorage, survive reload, and can be cleared for the active reviewer. No API, LLM, or server persistence is involved.

Verification: 30 focused tests passed across the review workspace, packet export/CLI, quality evaluator, and Harness request modules; `pnpm build`, `pnpm build:web`, and `git diff --check` passed. A synthetic packet was manually imported in the browser; rating, next-card navigation, reload recovery, anonymous JSON download, draft clearing, and 390px responsive layout were checked. The export packet is contract-tested against the shared import schema. No real player assessments were created; merge/adjudication, screen-reader VoiceOver testing, and any nDCG result remain outside this issue.

## Comments

- 2026-10-10: The separate `/adjudicate` flow for merging completed anonymous submissions, locking human adjudications before answer-key import, and computing query-scoped nDCG was implemented in [issue 124](124-close-the-human-shortlist-evaluation-loop.md). No real player assessments have been collected.

