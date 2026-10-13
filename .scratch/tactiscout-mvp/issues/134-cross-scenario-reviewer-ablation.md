# Replicate the evidence-review ablation on a second role scenario

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: 132

## Goal

Check whether the evidence-reference repair observed in the forward-replacement scenario also appears in a distinct midfielder recruitment task, while measuring whether the Reviewer ever suppresses an otherwise grounded conclusion.

## Scope

- Use the registered Barcelona under-23 midfielder scenario and the same curated Wyscout snapshot, Qwen model/configuration, tool budget, and paired `--compare-reviewer` runner as issue 132.
- Run three matched full-review/bypass pairs; only the deterministic evidence review gate changes.
- Compare per-pair Harness checks, Planner/tool decisions, candidate identity sets, recommendation/evidence counts, review repair/suppression outcomes, and elapsed time.
- Keep all raw outputs and IDs in ignored `.data/evaluations/`; only publish privacy-safe aggregate findings.
- Treat the scenario as a second exploratory replication, not an independent population sample or proof of general ranking quality.

## Resolution criteria

- The live paired run completes three times per arm against one recorded snapshot hash.
- Every pair's changed variables and observed outcomes are inspectable from the local result; IDs are never copied into tracked files.
- Results state whether the earlier mechanism effect replicated, failed to replicate, or could not be evaluated, including false-suppression risk and small-sample limits.
- `docs/evaluation.md` records the second scenario without inflating a two-scenario exploration into a general LangGraph comparison.

## Context

Issue 132 found three repairs of a requested-capability evidence reference in one forward-replacement scenario. That result does not establish the Reviewer gate's precision across different roles. The existing local CLI supports a single registered scenario with paired reviewer mode and up to ten repetitions.

## Answer

Ran three paired full-review/bypass Qwen 3.5 9B runs using the Barcelona under-23 midfielder scenario and the same curated Wyscout 2017/18 snapshot (`6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`). Both arms passed all 30 Harness checks in all three runs. Within every pair, Planner/tool traces, final recommendation identity sets, and evaluated-candidate counts matched; each arm evaluated 20 candidates and returned 3 recommendations with 6 focus evidence references. The enabled Reviewer passed with zero problems and zero repaired references in every run. No recommendation suppression or shortlist change was observed.

All six executions emitted zero `ask_user` actions and completed the report. This is a direct-completion observation for this registered request, which already states a position, age bound, and requested capabilities; it does not measure clarification quality on ambiguous requests.

The evidence-repair effect from issue 132 did not recur because this scenario already satisfied the evidence check. This is a useful no-change control for the gate, not evidence that it repairs every kind of defect. Three pairs cannot estimate a false-suppression rate or establish general behavior. Full/bypass end-to-end p50/p95 was 116.435/176.538 versus 112.233/118.808 seconds; the sample is too small and Planner latency too variable to attribute a latency difference. Recommendation quality remains `not_evaluable` without independent human judgments. Privacy-safe aggregates are recorded in [evaluation documentation](../../../docs/evaluation.md); raw output and trace remain in ignored `.data/evaluations/cross-scenario-reviewer-ablation-2026-10-10.{json,log}` and are not copied into tracked files.

## Comments

- 2026-10-10: The second role scenario did not trigger a Reviewer repair. All paired behavior and recommendation outputs matched; treat it as a no-change control alongside issue 132's repair case, with no shortlist-quality or generalization claim.
