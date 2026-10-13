# Test whether the Agent uses retrieved scouting methodology

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Use a controlled full-chain ablation to determine whether gate-accepted methodology RAG results change the Agent's observable investigation or report in a source-grounded way.

## Why now

TactiScout has a source-level retrieval benchmark and a role-aware Planner query contract, but those establish retrieval relevance and query construction separately. A retrieved-source count alone does not show that the LangGraph Agent actually receives, uses, or cites the retrieved material. This experiment isolates corpus availability while retaining the same graph, Planner, candidate data, user answers, Reviewer and other tools.

## Approved interface and experiment boundary

- Reuse the previously approved full conversation acceptance seam: the frozen data warehouse → `createRecruitmentConversation` LangGraph → Reviewer → report Harness path.
- Expose the experiment through the existing local Harness CLI: `--compare-methodology-rag --scenario bayern-kane-replacement --runs 3`.
- In the ablation arm, only searches whose `corpus` is `methodology` return no evidence. Player-report searches and every other dependency remain unchanged.
- Keep raw run output under Git-ignored `.data/evaluations/`; summarize only aggregate, de-identified results in tracked docs or showcase material.
- Do not score player recommendations, infer human fit labels, or claim that RAG improves answer correctness from this behavioral experiment.

## Acceptance criteria

- [x] The CLI accepts the new option only for the registered Bayern replacement case, `curated` data, and the existing 1–10 paired-run range; conflicting experiments and custom input are rejected before model access.
- [x] The ablation adapter suppresses only methodology-corpus search results; all other corpus searches pass through unchanged.
- [x] Each pair uses the same model configuration, scenario/answers, curated snapshot, graph policies, Reviewer mode and tool budgets; execution order is counterbalanced.
- [x] Per-run output records Harness checks and status, method-search calls/results, source URLs actually returned, and report method-source/chunk coverage; no run or failure is silently dropped.
- [x] Three real local-model pairs complete through the full LangGraph conversation chain. If the enabled arm retrieves no accepted methodology evidence, report that the experiment did not expose downstream RAG use rather than claiming a positive effect.
- [x] Every methodology reference in each report is supported by a source returned in that same run; the ablation arm has no methodology source to cite.
- [x] Documentation and `/showcase` report the actual comparison, sample size, snapshot hash, retrieval and report outcomes, and limits; shortlist quality remains unmeasured.

## Research and related work

- [Role-aware methodology retrieval](110-methodology-retrieval-intent.md)
- [Methodology retrieval gate and v2 benchmark](106-methodology-rag-abstention-threshold.md)
- [Source-level retrieval benchmark](105-methodology-rag-retrieval-benchmark.md)
- [Methodology RAG v3 fixed query set](../../../data/evaluations/methodology-rag-v3.json)
- [Full-chain Harness](14-agent-harness-evaluation-suite.md)

## Answer

Added `--compare-methodology-rag` to the local LangGraph Harness. Its paired control arm suppresses only `methodology` corpus results; the normal arm and all other corpus/tool behavior remain available. The CLI restricts this experiment to the registered Bayern replacement scenario, curated data and supported paired-run count. Focused CLI tests passed (10/10), and `pnpm build` passed.

Ran three counterbalanced pairs with local Qwen 3.5 9B on the Wyscout 2017/18 curated snapshot (SHA-256 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`). All six complete LangGraph runs passed their 29/29 Harness checks. In all three enabled runs, one method search returned two chunks from one source; the report contained those two chunks and the same source, and the citation-source check passed. In all three suppressed runs, the search returned zero chunks/sources and the report cited no methodology source; citation checks also passed. Across all three pairs, non-methodology trace and candidate order were unchanged.

This establishes that accepted methodology evidence can pass through retrieval into the report with source grounding in this frozen case. It did not change observable decisions or candidate ordering here. This is one scenario, one local model and three pairs; it does not measure recommendation quality or establish that RAG generally improves scouting decisions. Raw run artifacts remain in the Git-ignored `.data/evaluations/` directory.

The aggregate protocol and result are recorded in [the evaluation guide](../../../docs/evaluation.md#方法-rag-agent-整图消融) and the de-identified [portfolio showcase](/showcase).

Validation: `pnpm test -- tests/local-agent-evaluation-cli.test.ts` passed (10/10); `pnpm build` and `pnpm build:web` passed; the rendered `/showcase` page was inspected in the local browser; `git diff --check` passed.

## Comments

- 2026-10-10: Started after auditing the current project evidence. The retriever has a fixed relevance gate and the Planner has a role-aware query contract, but no controlled corpus-on/corpus-off comparison yet shows whether retrieved methodology reaches the final report.
- 2026-10-10: Completed the paired local-model run and added an aggregate showcase. The observed contribution is retrieval-to-report source propagation, with no changed candidate order or non-methodology trace in these three pairs.
- 2026-10-13: Re-ran the same three counterbalanced pairs against the same curated snapshot. All six LangGraph runs completed 27/29 checks; both arms failed the same candidate-position and expansion-evidence checks (0/3 passes per arm). Enabled runs still passed 2 method chunks to Planner/report with valid citations; suppressed runs passed 0. Because both arms failed the scenario checks, this rerun does not estimate an Agent behavior benefit from methodology RAG. Raw output remains ignored in `.data/evaluations/methodology-rag-agent-ablation-2026-10-13.{json,log}`.
