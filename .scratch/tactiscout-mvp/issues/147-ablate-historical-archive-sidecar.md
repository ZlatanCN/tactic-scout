# Measure the report-only historical archive sidecar

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Show, with a paired full-chain ablation, whether exact Reep → Wyscout history adds useful traceable context to an Understat scouting report while leaving candidate assessment and recommendations unchanged.

## First-principles boundary

The archive is a historical appendix, not evidence for current ability or transfer fit. The LangGraph already runs enrichment after evidence review and final Planner synthesis. The ablation must keep the same candidate source, request, clarification script, model, knowledge base, graph policies and tool budgets; only the archive sidecar is enabled or disabled.

## Accepted verification interfaces

- Public behavior seam: `createRecruitmentConversation` from the first user turn through the final report.
- Reproducible live-model seam: the existing local Harness CLI with a paired `--compare-historical-archive` option and a registered Understat or mosaic scenario.

## Acceptance criteria

- [x] A temporary, synthetic Reep + Wyscout fixture verifies the full LangGraph report path: exact Understat player ID produces an attributed historical appendix; disabling the sidecar removes only that appendix.
- [x] The paired Harness CLI requires Understat or mosaic mode, a single registered scenario, both existing archive opt-ins, and a usable local Reep/Wyscout archive before contacting the model.
- [x] CLI output includes release/data scope, sidecar coverage and sample counts, while candidate IDs/names stay out of the compact paired comparison summary.
- [x] Every pair compares Planner/tool trace, evaluated candidate count, requested-capability coverage, recommendation identities/order and evidence keys. The archive may affect only historical appendix fields; any other difference is called out rather than hidden.
- [x] At least three counterbalanced paired local-model runs produce a nonzero Understat identity-to-Wyscout sample path. If the installed snapshot cannot produce a sample, the run is reported as not informative and does not claim the mechanism was validated.
- [x] Deterministic findings and the live run are recorded here and in `docs/evaluation.md`; neither claims ranking accuracy, current ability, transfer suitability or general reliability.

## Answer

Understat source identities now retain the competition-scoped display key and expose the exact raw provider player ID through `providerIdentifiers`, allowing Reep's `(provider, namespace, external_id)` lookup to resolve it without fuzzy matching. The Harness counts historical samples attached both to recommendations and to the separate historical-candidate appendix.

Qwen 3.5 9B completed three counterbalanced pairs on the registered Understat scenario. Both arms passed 3/3 runs. Each enabled arm checked 20 evaluated candidates, mapped 14, matched 5, and appended 6 traceable Wyscout records from season 2017/18. All three pairs had identical non-archive report content, candidate/evidence/capability coverage, recommendation identity order/evidence, and Planner/tool traces. No pair reported an unexpected difference.

This verifies the exact identity path and report-only behavior for this frozen local dataset and scenario. It does not establish ranking quality, current ability, transfer suitability, or general reliability. The historical archive remains partial: 6 records across 5 candidates do not cover the full pool.

## Evidence

- Reep provider bridge lookup uses exact `(provider, namespace, external_id)` keys and stamped releases; the 2026-10-10 official coverage recheck still reports 5,287 Understat rows in release `20261005T180536Z` and no newer public release.
- The application imports 5,119 Understat player bridges locally. ASA remains unsupported in this release; this experiment covers Understat identity only.
- Existing LangGraph history enrichment runs after Reviewer and final Planner synthesis, and builds the appendix outside Planner history and candidate evidence.
- A synthetic full-graph pair resolves Understat `50001` to Wyscout `101` despite different display names. Removing the sidecar yields an identical report after stripping only archive fields; evidence, recommendation and decision/tool trace are unchanged, and the archive-only name never enters Planner history.
- CLI boundary tests verify single registered scenario, supported mode, three paired runs, both opt-ins and local archive/SQLite readability fail closed before any model call. Compact pair output includes sanitized traces and aggregate coverage without candidate IDs or names.
- `pnpm test` passed (376/376); this includes the synthetic full-graph test and the historical CLI fail-closed cases. `pnpm build`, `pnpm build:web`, and `git diff --check` passed.
- Understat's `sourceIdentity.playerId` is competition-scoped (`<league>:<playerId>`), while Reep stores the raw Understat ID. The provider now publishes that raw value as an explicit `understat/player` provider identifier with source field `id`; no names or approximate matching are used.
- A regression check found the Harness counted only non-recommended historical candidates when validating `matchedCandidates`, although samples for recommended players are stored on recommendation objects. It now validates both report locations.
- 2026-10-11 live result: Qwen 3.5 9B, Understat mode, Reep release `20261005T180536Z`, local Wyscout archive season `2017/18`. Three counterbalanced pairs; enabled and disabled arms each passed 3/3 runs. In every enabled arm: checked 20, mapped 14, matched 5, samples 6; coverage status `partial`. All pair comparisons passed with no differences. The result verifies this exact local identity bridge and report boundary only.
- Raw output and progress log are retained locally under the Git-ignored `.data/evaluations/historical-archive-understat-verified.{json,log}`. Both history opt-ins were set only on the experiment command; `.env` was not changed.
- Full verification after the final changes passed: `pnpm test` (383/383), `pnpm build`, `pnpm build:web`, and `git diff --check`.
- See [Reep/ASA identity bridge audit](../research/current-provider-identity-bridge-2026-10-10.md) and [issue 34](34-wyscout-cross-source-archive-enrichment.md).

## Comments

- 2026-10-10: Started after confirming the official Reep coverage page still points to release `20261005T180536Z`. Implementation should reuse the existing history enrichment and local Harness; do not create a second archive pipeline or feed old-season rows into scoring.
- 2026-10-10: Implemented the synthetic full-graph control, archive preflight and `--compare-historical-archive` local Harness branch. The three-run local-model experiment is still pending because the archive opt-ins are currently off; the runner refuses to enable them itself.
- 2026-10-11: Ran the authorized local experiment and found the adapter's competition-prefixed identity prevented exact Reep lookup; added a raw Understat provider identifier. A follow-up run exposed the Harness's missing recommendation-sample accounting, which was corrected with a regression test. Final three-pair Qwen run passed both arms 3/3 with six archive samples per enabled run and no non-archive differences.
