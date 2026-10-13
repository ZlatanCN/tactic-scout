# Measure dynamic investigation planning against a fixed workflow

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Test whether the LLM Planner's adaptive investigation choices change end-to-end Harness behavior compared with a small, scenario-independent single-pass workflow, while keeping the same LangGraph, tools, data snapshot, clarification gates, Reviewer, and conclusion synthesis.

## First-principles boundary

- This is an ablation of dynamic investigation planning **inside the existing LangGraph**, not a comparison between LangGraph and another framework.
- The dynamic arm uses the existing Planner for investigation, expansion, reorientation, and conclusion decisions.
- The fixed arm uses this predeclared, case-independent sequence: search the same generic football role/performance methodology query once; request one discretionary candidate page using only currently confirmed user constraints; let the graph's existing policy perform bounded evaluation/report retrieval and mandatory clarification; permit a fresh exact-scope search only when the graph requires it after a new role confirmation or user-approved scope change; then delegate conclusion synthesis to the same model while declining further discretionary pagination/reorientation.
- Both arms retain deterministic safety gates, user clarification/resume, identical tool implementations and per-turn budgets, the same knowledge base, and the same Reviewer. The fixed arm receives exactly the registered answers when it asks; no answers are hidden or prefilled.
- Freeze the baseline before running either registered evaluation case. It may use only the user-visible request and information confirmed in that conversation; it must not inspect dynamic-arm traces, benchmark answer keys, future clarification answers, or ideal tool paths to choose actions.
- This is an exploratory mechanism check, not a published standard or confirmatory causal claim. The fixed workflow is intentionally a minimal open-loop baseline, not a strong hand-optimized recruitment procedure. It may be less thorough by design. Results cannot establish general planning quality, LangGraph superiority, or player ranking accuracy.
- Any conclusion synthesis remains model-generated in both arms so the experiment changes investigation control, not the candidate recommendation/report generator.

## Public seams

- `createRecruitmentConversation` with an injected Planner runs the full warehouse → LangGraph → Reviewer → report path.
- `pnpm eval:local-agent -- --scenario <id> --compare-investigation-planning --runs <1-10>` runs counterbalanced paired arms using the existing Harness CLI and fixed `curated` data.
- Tests stay at the complete conversation graph and Harness CLI; no internal-node or planner-helper tests.

## Experimental controls

- Use one registered scenario per invocation and the exact same request/answer script, local model configuration, curated snapshot bytes, knowledge base, graph policies, Reviewer, and tool budgets within a pair. Only the investigation next-action policy changes.
- Counterbalance which arm runs first across pairs.
- Use the same graph decision/action ceilings and timeouts. The adaptive arm is expected to use more model decisions; this difference is part of the treatment. The current chat-model adapter does not expose dependable aggregate token usage, so do not claim token-matched cost. Report the Harness-counted model-Planner dispatch attempts, elapsed time, tool count, evaluated sample size, evidence coverage, and report outcome separately; dispatch attempts are not provider-reported usage records, and runtime is descriptive.
- Report paired Harness behavior separately from recommendation content. Do not infer ranking quality from pass rate, candidate count, or runtime.
- Keep run traces and candidate identifiers in ignored local `.data/evaluations/`; publish only de-identified aggregates.

## Acceptance criteria

- [x] Default application behavior continues to use the existing adaptive Planner.
- [x] The fixed strategy follows the frozen generic protocol across registered scenarios, including graph-mandated exact-scope re-search after clarification, without inspecting paired dynamic runs, future answers, answer keys, or hidden actions.
- [x] Both arms use the same compiled graph and preserve clarification/resume, graph safety policies, tool executors, Reviewer, and final synthesis behavior.
- [x] The CLI requires one registered scenario and curated data, and rejects custom inputs or another comparison flag before contacting the model.
- [x] Full-graph tests verify the fixed methodology/candidate path, graph evaluation/report/clarification behavior, and shared conclusion model; CLI tests verify invalid requests are rejected before contacting the model.
- [x] Three counterbalanced pairs ran for a clear request and a request requiring clarification. All six runs in each scenario were retained in ignored local artifacts.
- [x] Evaluation docs and the map name the changed factor, disclose missing token accounting, and prohibit framework-superiority and recommendation-quality claims.

## Answer

Added `--compare-investigation-planning` to the local Harness and froze an evaluation-only single-pass Planner. It searches one generic methodology query and one candidate page, then delegates report synthesis to the same model; graph-mandated exact-position searches after clarification remain active. The default application path still uses the adaptive Planner. A graph trace correction now marks graph-forced methodology/candidate actions as policy decisions when they override a Planner proposal.

On 2026-10-10, Qwen 3.5 9B ran three counterbalanced pairs each for `barcelona-under-23-midfielder` and `bayern-kane-replacement` against curated Wyscout 2017/18 snapshot SHA-256 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`. All 12 full-graph runs passed: Barcelona 31/31 per run and Bayern 29/29 per run. Each Barcelona arm evaluated 20 candidates and made 6 tool calls; adaptive planning averaged 3 Harness-counted model-Planner dispatch attempts and returned 3 recommendations, while single-pass averaged 1 dispatch attempt and returned 1. Each Bayern arm answered two clarifications, evaluated 30 candidates, made 10 tool calls and returned 1 recommendation; adaptive planning averaged 5 dispatch attempts versus 3 for single-pass. Under the current adapter path, each counted Planner decision normally reaches one structured model invocation; these historical runs did not record per-invocation token usage.

The observed output differences are not ranking-quality measurements. The sample is exploratory, model runs do not share a random seed, total token usage is unavailable, and no framework comparison was performed. Raw JSON and traces remain in `.data/evaluations/investigation-planning-{barcelona,bayern}.{json,log}`. Deterministic conversation/CLI tests passed (53/53), `pnpm build` passed, and `git diff --check` passed. Full protocol and interpretation limits are in [`docs/evaluation.md`](../../../docs/evaluation.md#动态调查规划消融).

## Research

- [../research/agent-harness-ablation-design-2026-10.md](../research/agent-harness-ablation-design-2026-10.md) recommends same-tool fixed-order controls for dynamic tool planning and distinguishes Harness behavior from recommendation quality.
- [../research/dynamic-planning-vs-fixed-workflow-ablation-2026-10-10.md](../research/dynamic-planning-vs-fixed-workflow-ablation-2026-10-10.md) found no directly matching published standard and recommends answer isolation, a frozen generic workflow, paired runs, and full cost accounting. This project will report model call counts and elapsed time but cannot claim token matching because usage is not currently available from the adapter.

## Comments

- 2026-10-10: Started after confirming the issue 138 ask-policy ablation is already implemented and passing. The current evaluation matrix recommends a `−Planner` arm, but no Planner/fixed-workflow comparison exists in the Harness CLI.
- 2026-10-10: Frozen the fixed arm as a case-independent methodology lookup + one discretionary candidate page, followed by shared graph policies and conclusion model. A user-confirmed role can trigger one graph-mandated exact-scope re-search; that is not a Planner-selected expansion. The experiment is exploratory; no directly matching standard was found, and total token-matched cost is unavailable.
