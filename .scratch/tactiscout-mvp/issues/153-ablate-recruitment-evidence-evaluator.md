# Measure what the recruitment evidence evaluator contributes

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Use one controlled end-to-end LangGraph experiment to test whether the deterministic recruitment evidence evaluator makes requested player capabilities observable and keeps the report grounded, while the existing Planner, tools, Reviewer, and report flow remain in place.

## First-principles boundary

The treatment is availability of candidate performance evaluation: the full arm returns the evaluator's source-backed metrics and same-position/competition/season comparisons; the control arm withholds evaluator output. Candidate search, methodology retrieval, player-report retrieval, Planner, deterministic Reviewer, graph policy, data snapshot, and tool budgets remain enabled in both arms.

The control arm must say that evaluation evidence was intentionally withheld by the experiment. It must not convert missing measurements to zero, mislabel them as provider gaps, or imply that candidates have no ability. Recommendation count, Harness pass rate, and runtime are behavior observations only; without human scout labels this experiment cannot measure shortlist quality or accuracy.

## Accepted verification interfaces

- Public behavior seam: `createRecruitmentConversation` from the first user turn through the final report, using an injected evaluator adapter and deterministic Planner fixture.
- Reproducible local-model seam: the existing Harness CLI with a paired `--compare-evidence-evaluator` option on one registered scenario or all registered scenarios.

## Experimental controls

- Use `barcelona-attacking-one-on-one-forward` as the first registered scenario; `--scenario all` can add the U23 midfielder and Bayern replacement scenarios on the same frozen Wyscout 2017/18 curated snapshot.
- Use the same model configuration, request, knowledge base, graph, Planner policy, deterministic Reviewer, tools, per-turn budgets, and scripted answers.
- Counterbalance arm order across at least three pairs.
- The sole changed factor is whether candidate evaluation returns the evaluator's evidence or an explicit `withheld` result.
- Keep identifiers and raw traces only in Git-ignored `.data/evaluations/`; publish sanitized aggregates.

## Acceptance criteria

- [x] The full-graph fixture observes source-backed attacking one-on-one metrics and a report that cites only observed metric keys.
- [x] The withheld fixture emits no metric values or evidence references, preserves the report's explicit experiment limitation, and does not recommend candidates without evidence.
- [x] The CLI rejects unsupported data mode, missing/custom scenario input, fewer than three pairs, and conflicting ablation flags before contacting the model.
- [x] Each pair records evaluator result counts, requested-capability coverage, recommendation/evidence counts, Harness outcomes, and downstream trace differences without exposing names or IDs in its comparison summary.
- [x] At least three counterbalanced local-model pairs run; the enabled arm returns nonzero directly relevant evidence or the experiment is reported as not informative.
- [x] `docs/evaluation.md` and the map document the protocol and its limits. `/showcase` will only be updated after a real paired result exists; recommendation quality remains unmeasured.

## Answer

The public full-graph seam and paired Harness CLI are implemented. The graph fixture verifies that source-backed evidence reaches the report when enabled, while the withheld adapter produces an explicit experimental-withholding state; a deliberately unsupported Planner recommendation is rejected by the Reviewer. The CLI validates registered scenarios, curated mode, pair count, and mutually exclusive experiments before contacting the model.

The Qwen 3.5 9B run completed three counterbalanced pairs on the frozen Wyscout 2017/18 curated snapshot (`6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`). The enabled arm passed 31/31 Harness checks in all three runs; it evaluated 20 candidates per run, returned 194 metric values, observed both directly relevant attacking-one-on-one metric keys, and produced 3 recommendations with 6 evidence references. The withheld arm passed its explicit no-evidence contract in all three runs: zero metric values, capability coverage left unassessed, and no recommendations or evidence references. Its ordinary Harness score was 29/31 in each run because the two requested-capability coverage checks correctly fail when the experiment withholds evaluation evidence. All three pairs retained the same downstream Planner/tool trace.

The result shows the evaluator's evidence is observable and changes the report's supported recommendations in this frozen case. It does not measure whether those recommendations are good: ranking accuracy remains `not_evaluable` without independent scout labels, and three pairs do not establish general reliability. The focused graph and CLI regressions pass 22/22. Raw run details remain in the Git-ignored `.data/evaluations/evidence-evaluator-one-on-one-2026-10-11.{json,log}`; the sanitized result and limits are recorded in [evaluation docs](../../../docs/evaluation.md#能力证据评估器整图消融).

## Comments

- 2026-10-11: Chosen after reviewing the current evaluation matrix. The evaluator has full-graph behavior coverage from issue 146, but no controlled ablation demonstrating the evidence it contributes. The story-first `/showcase` already communicates the agent run clearly, so another layout prototype would add less value than validating this core mechanism.
- 2026-10-11: The complete-graph seam and paired CLI are implemented. A deterministic fixture verifies evidence availability versus explicit withholding. A live curated-data run remains gated by `TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED`; the comparison runner does not enable this flag or change `.env`.
- 2026-10-11: Verification after implementation: the focused graph/legacy-snapshot regression set passes 52/52; the complete suite passes 389/389; API and Web production builds pass; `git diff --check` is clean. The live local-model acceptance criterion remains open pending explicit permission to process the curated Wyscout-derived snapshot with the configured model.
- 2026-10-11: Strengthened the graph fixture adversarially: the withheld-arm Planner now attempts to recommend the candidate using the deliberately withheld metric. The deterministic Reviewer retries, rejects the unsupported reference, and the final report contains no recommendation.
- 2026-10-11: A curated CLI run with model processing disabled previously threw during module import, so `--help` and argument validation were unusable and a valid command printed a stack trace. The CLI now lazily constructs the repository after option validation and reuses the shared configured-mode parser. With permission explicitly false, help and invalid-argument paths work without creating a repository; a valid gated command returns a concise permission message before reading the curated snapshot or contacting the model. CLI regressions pass 21/21; full suite 389/389 and both production builds pass.
- 2026-10-11: The authorized three-pair local-model run completed on the existing enabled processing gate without editing `.env`. All enabled runs passed; all withheld runs passed the no-evidence contract, with the expected two capability-coverage Harness checks failing. The paired comparison and limits are now documented; recommendation quality remains unmeasured.
- 2026-10-11: After the public test seams were confirmed, re-ran the focused full-graph and Harness CLI regressions: 22/22 passed. Rechecked the Git-ignored raw run artifact without exposing candidate identities: all three enabled runs were 31/31, all three withheld runs were 29/31 plus a passing withheld-evidence contract, and paired downstream traces matched 3/3. The web production build also passed. No live-model rerun was needed.
