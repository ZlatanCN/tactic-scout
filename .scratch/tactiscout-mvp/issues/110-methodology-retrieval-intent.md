# Separate methodology retrieval intent from transfer-decision intent

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the LangGraph planner ask the methodology corpus about role- and capability-specific evaluation concepts, rather than asking it to solve a named transfer decision. Preserve fail-closed retrieval and prove the change in a full local-model data warehouse → LangGraph → report run.

## Acceptance criteria

- When methodology evidence is useful, the planner query states an answerable evaluation-method question grounded in the user's explicit role/capabilities; club names, reference-player names, replacement phrasing, and current transfer decisions do not dominate it.
- The planner does not broaden a vague recruitment question into an unsupported research claim; missing role details remain eligible for the normal in-conversation clarification flow.
- Keep the methodology similarity and lexical-coverage thresholds unchanged. Queries with no accepted source still let the scouting workflow continue without unsupported method citations.
- Add deterministic regression coverage for methodology-vs-transfer intent and run the existing methodology retrieval benchmark.
- Run a real local-model conversation from an initial natural-language scouting brief through data warehouse search, same-case clarification/resume where needed, candidate evaluation, Reviewer, and report. Record the actual method-query result and prove every reported methodology reference came from a source accepted and returned in that run.
- Run the complete automated suite, API/Web builds, and `git diff --check`. Do not claim recommendation-ranking accuracy from a behavior run.

## Context

- [Domain context](../../../CONTEXT.md)
- [Agent Harness](14-agent-harness-evaluation-suite.md)
- [Methodology abstention policy](106-methodology-rag-abstention-threshold.md)
- [Role-aware methodology source and full-chain verification](109-add-role-aware-methodology-source.md)
- [Methodology RAG v3 benchmark](../../../data/evaluations/methodology-rag-v3.json)

## Comments

- 2026-10-09：本机当前许可索引试检发现，直接以“拜仁、凯恩、替代者、中锋、能力、进球、支点”拼出的查询没有来源通过 gate；改成询问“中锋位置角色与个人技术风格如何影响比赛表现”时，Forcher 等（2022）来源能以 cosine 0.888、同片段词项覆盖 0.833 命中。该检索诊断只用于定位查询意图差异；是否适用必须由完整 LangGraph 链路确认。

## Answer

在 `recruitment-planner.ts` 的 Planner system instructions 中加入单独的方法检索契约：方法 query 必须询问用户明确或已确认的角色/能力如何对应比赛表现分析；目标球队、参考球员、替代者措辞和转会结论不进入方法问题；缺失职责时不猜测，gate 无结果时继续球探流程并遵守弃答。方法检索新规有确定性提示回归覆盖，RAG 阈值与源登记均未改变。

使用本机 Qwen 3.5 9B 与 TactiScout 自建 Wyscout 2017/18 快照运行凯恩接班人 Harness：完整经历方法检索、宽范围发现、两次按需追问与同案恢复、位置空结果后征求扩围许可、候选评估、球员报告空检索、Reviewer 和报告。Agent 方法搜索返回 Frontiers/Forcher 2022 来源的 2 个 gate 许可片段；报告引用边界检查确认没有引用未由本案搜索返回的来源。共 3 轮、6 次工具调用、评估 10 人、35 条进度事件，29/29 Harness 检查通过，耗时 116.508 秒。数据范围明确为 2017/18 历史样本，不能推出现役转会市场覆盖或候选排序准确性。

方法 RAG v3 仍是 10 条固定作者标注查询、校准/留出各 5 条：6/6 可回答题检出相关来源，留出来源对 precision 0.75，范围外误接收 0/2；模糊留出题有相关角色上下文命中，不能解释为支持转会适应预测。v2 和 v3 CLI 均通过，现有 fail-closed 阈值保持不变。全套测试 317/317，API 与 Web build 及 `git diff --check` 通过。

