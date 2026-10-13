# Prevent repeated candidate pages from consuming the investigation budget

Type: task
Status: resolved
Labels: ready-for-human

## Goal

Keep the LangGraph investigation moving from candidate discovery into evidence evaluation when the model repeats or miscalculates candidate-page offsets. Verify the behavior against the real local Wyscout 2017/18 dataset and Qwen 3.5 9B.

## Reproduction

With `TACTISCOUT_DATA_MODE=wyscout`, local Wyscout files, and `qwen3.5:9b`, run `node --import tsx src/evals/local-model-agent.ts --scenario barcelona-under-23-midfielder`. The model searched offset 0 twice, then offsets 10 and 20; after the four-call candidate-search budget was exhausted, it repeated the blocked action twice. It completed with no candidate evaluation and failed `candidatePagesFollowCursors`, `evaluatedDiscoveredCandidates`, and `didNotHitDecisionOrPolicyLoopLimit` (138.6 seconds).

## Acceptance criteria

- [x] A stale or skipped offset for the same candidate-search criteria cannot repeat or hide an unsearched page; actual tool execution starts from the next unexamined offset.
- [x] A changed candidate-search scope begins at offset 0 and retains its own cursor.
- [x] The trace distinguishes a model-requested offset from the effective offset when the system corrects it.
- [x] Reaching the candidate-search budget with discovered candidates gives the Agent a clear instruction to evaluate candidates already found before finishing or searching reports.
- [x] Re-evaluating already evaluated candidate IDs cannot spend the evidence-evaluation budget; the Agent is directed to report search or conclusion.
- [x] After one candidate batch has been evaluated and reports are empty, a non-null nextOffset keeps the graph in investigation mode so the Planner can choose whether to inspect another page.
- [x] Conversation tests cover repeated-page correction, scope reset, and the real tool trace through the public turn seam.
- [x] The registered local evaluation suite fails on page repetition and succeeds only after at least one discovered candidate is evaluated with evidence.
- [x] The real Wyscout/Qwen scenario completes with cursor-consistent pages, evaluates discovered Wyscout candidates, preserves the user's explicit age limit, adds no unrequested competition/season/minutes filters, and reports the historical-data limitation.

## Comments

- 2026-10-04: This issue is based on a real local-model run against the five-league Wyscout Figshare sample, not the synthetic demo repository. The run did not send data to a hosted model.
- 2026-10-04: The first cursor fix let the real model reach evidence evaluation, but a second local run repeatedly evaluated overlapping subsets of the same four candidates until the decision budget ended before player-report search. Preserve this as part of the same Agent-loop regression.
- 2026-10-04: A later run reached methodology search, all four candidate pages, four distinct Wyscout player evaluations, and the player-report search; the final decision exceeded nine minutes and was manually interrupted. This exposed the need for per-request model bounds and a leaner final-decision prompt.
- 2026-10-04：harness 回归发现，首批球员评估且报告语料为空时，即使候选搜索仍有 nextOffset，状态也会直接切换成只能总结的结论模式。现在仅当本轮最新候选页已耗尽时才进入受限结论模式；候选页仍有后续数据时，Planner 可以结合首批表现继续或结束。新增分页回归覆盖两批评估和独立搜索范围游标；全量测试在 StatsBomb 本机处理 gate 的临时测试环境下 126/126 通过。

## Answer

The candidate-search cursor is now tracked per normalized search scope. Model-requested and effective offsets appear separately in the privacy-safe trace. Budget feedback directs the Agent to evaluate already discovered players, and repeated evaluation requests are blocked before spending the evaluation budget. A changed, user-confirmed position can reuse matching discovered candidates rather than repeating an exhausted page.

The conclusion stage now receives a compact evidence history and a short, conclusion-specific system prompt. `OPENAI_TIMEOUT_MS` bounds one model request (default 180 seconds, configurable from 1 to 600 seconds), and implicit LangChain retries are disabled. The UI reports that it is summarizing verified evidence while this final call runs.

If the latest candidate page has a next offset, an empty player-report result no longer forces conclusion-only mode; the Planner can use the evaluated batch evidence to decide whether to inspect the next page. Once the latest page is exhausted, the compact conclusion path remains available.

Final real run against the local five-league Wyscout dataset and Ollama `qwen3.5:9b` passed all 18 registered checks in 184.3 seconds. It searched offsets 0, 10, 20, and 30 with the user-specified maximum age of 23; it added no competition, season, minimum-minute, or player-name filter; evaluated four discovered candidates; searched the player-report corpus; and returned one recommendation citing measured evidence. The report identifies Wyscout as 2017/18 historical data and records low-minute and unavailable-metric limits. This validates the harness flow, not recommendation-ranking accuracy.
