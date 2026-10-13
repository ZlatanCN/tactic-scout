# Skip embedding work when an authorized RAG corpus is empty

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Problem

The live FPL report showed player-report retrieval as failed even though the local knowledge index has zero player-report chunks. `LocalKnowledgeBase.search()` queried the requested corpus and initialized query embeddings concurrently, then returned an empty list only after both completed. An empty corpus can therefore become a retrieval failure due to unnecessary model loading or embedding errors.

## Acceptance criteria

- [x] Empty corpora return an empty result before query embedding is invoked.
- [x] Player-report searches with no exact indexed entity match also return before query embedding.
- [x] A deterministic regression test fails before the change and passes after it.
- [x] Re-run the FPL natural-language workflow through LangGraph to a report; confirm empty player-report RAG is reported as no matches, not a failed search.
- [x] Record whether recommendation evidence and policy-loop behavior pass the full workflow; do not claim ranking accuracy.

## Comments

- 2026-10-08：真实 UI 报告显示球员报告检索失败；本机获准球员报告语料为 0 条。新增回归测试稳定复现空语料仍调用 query embedding 并抛错；搜索现先读取并按实体过滤语料，再仅对非空候选行做 embedding。知识库定向测试通过。命令行 Harness 当前因执行环境拒绝访问本机 Ollama（`EPERM`）未能运行；后续端到端验收通过浏览器连接的本机服务进行。
- 2026-10-08：本机 curated/Wyscout Qwen Harness 实际检索两批候选的球员报告，均正常返回 0 条；此后完成 Reviewer 与报告并通过 28/28 行为检查。最新 FPL 浏览器案件在候选搜索处遇网络错误，未到达 RAG；因此空语料实现已在真实非空数据链路中得到验证，FPL 当前源的重复验收仍未完成。
- 2026-10-09：实时 FPL 工作台自然语言链路已从候选检索完成至 Reviewer 和最终报告；进度明确记录球员报告检索“找到 0 条获准片段”，报告也说明没有匹配的获准球员报告，没有将 0 命中显示成检索错误。候选匹配 79 条、读取 20 条、评估 10 人；请求的能力证据不完整，报告未宣称完整推荐。运行完成，未观察到策略循环阻断；这只验证正常结束与证据边界，不证明推荐排序准确性。知识库定向回归已有通过记录；本轮未重跑自动测试。

## Answer

已解决。空的授权球员报告语料在 LangGraph 的实时 FPL 调查中正常作为 0 命中返回，Reviewer 与最终报告继续完成；不再把空语料误报为 RAG 故障。证据覆盖不完整时，报告保留缺口并不宣称完整引援推荐。本项不验证候选排序准确性。
