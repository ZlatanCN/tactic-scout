# Keep candidate-expansion Planner decisions within a compact token budget

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Prevent local model output truncation during a constrained candidate-expansion decision by sending only stage-relevant Planner instructions. Keep the decision dynamic and preserve user constraints, exact pagination, and evidence boundaries.

## Acceptance criteria

- [x] Expansion prompts omit unrelated investigation and provider-specific rules already supplied separately by the configured data-source policy.
- [x] Expansion system instructions stay below 2,500 characters.
- [x] Expansion prompts retain exact cursor/filter, no-repeat, material-question, source-scope, and evidence-backed finish requirements.
- [x] Expansion decisions have a bounded 1,024-token default output budget separate from full report synthesis.
- [x] A deterministic, fast regression check fails against the current oversized prompt and passes after the change.
- [x] A non-empty local-data Harness run recovers from expansion `finish_reason=length` using the exact candidate cursor and reaches a reviewed report.
- [x] Update the map and the original output-truncation issue with the stage-specific finding.
- [x] Complete a current FPL-to-report UI run after the live FPL candidate endpoint is reachable; the current network-failure report is not a data-backed completion.

## Comments

- 2026-10-08：当前工作台真实 FPL 案例在第 5 次 Planner 决策（10 人评估、报告检索 0 命中后）等待约 5 分钟，并以 `finish_reason=length` 终止；用户输入被保留。该失败发生在扩页决策，而此前 issue 89 的成功复验覆盖的是 `curated` Wyscout 的报告结论阶段。`expansionInstructions()` 当前为 6,555 字符，包含其他 provider 的规则；`conclusionInstructions('fpl')` 为 941 字符。下一步用快速提示边界回归缩短扩页决策上下文，再复验真实链路。
- 2026-10-08：扩展决策系统提示当前为 705 字符（批准过位置扩展时为 767 字符），保留下一页游标/筛选、能力覆盖、已答问题、来源范围和证据约束；provider 规则仍由数据源策略单独附加。确定性边界测试由红转绿。工作台真实 FPL 重跑约 90 秒到达 Reviewer 与报告，没有再次出现长度截断；但报告显示球员报告 RAG 失败、10 人中进球和创造机会各仅 5 人覆盖，并因重复受限动作停止，故这不是完整成功验收。空球员报告库仍触发 embedding 的问题已单列到 [issue 98](98-short-circuit-empty-rag-corpus.md)。随后修复了空语料提前返回。下一次真实运行中，方法检索、20 人候选页、10 人评估及空球员报告库查询均正常；第 5 次扩页决策仍等待超过 6 分钟，用户主动停止。扩页模型请求现使用默认 1,024 token 上限（受一般输出预算约束），对应测试通过；尚未完成完整报告验收。
- 2026-10-08：最新本机 `curated` Wyscout Harness 复现扩页 `finish_reason=length`（24.420 秒后达到输出上限）。LangGraph 现将该错误与请求超时同样交给证据回退：按 `requestedCapabilityCoverage` 和原筛选条件读取 `nextOffset=20`，随后评估第二页、检索报告；Planner 结论经 Reviewer 一次补查后完成。Harness 读取 2,682 条历史仓库记录、实际评估 20 人、生成报告，28/28 行为检查通过，耗时 99.965 秒；球员报告检索 0 命中按正常空结果处理。此项验证的是本地仓库到报告链路及截断恢复，不评估推荐排序。同期 FPL 浏览器请求在候选查询阶段遇网络错误，未到达 RAG/结论阶段；当前 FPL 在线验收仍待来源可达。
- 2026-10-09：本机 `curated` 全链路复验再次出现扩页输出上限，但已评估 10 人中 goals 与 key passes/assists 均有可观测值，继续翻页不会补足结构上缺失的射门终结和进攻接应指标；LangGraph 按当前证据收束并经 Reviewer 生成报告，28/28 Harness 检查通过（179.067 秒）。这证明输出截断时的证据策略能结束案件，不证明 Planner 正常完成了扩页决策，也不替代仍待完成的 FPL 工作台验收。
- 2026-10-09：从现有浏览器工作台完成真实 FPL → API → LangGraph → 报告链路。自然语言案件先暂停询问角色，答复后中锋搜索为 0，再暂停请求扩位许可；用户同意后同案改查 ATT。实时进度显示候选分页、评估 10 人、球员报告检索 0 命中与结束阶段；报告写明该范围匹配 79 人、读取 40 人、能力覆盖与小样本限制，最终界面显示调查完成并完成证据复核。该次页面读到 FPL 当前赛季数据，是此前网络失败后的有效浏览器验收；不验证推荐排序准确性或长期稳定性。

- 2026-10-09：定位此前扩页 `finish_reason=length` 的真实原因是 Ollama 默认 4,096 token 上下文饱和，而不是扩页输出预算：安全 SSE 元数据显示 `prompt_tokens=4079`、`completion_tokens=17`、`total_tokens=4096`，请求本身已携带 `max_tokens=8192`。`ollama ps` 确认 `qwen3.5:9b` 上下文为 4,096；[Ollama FAQ](https://docs.ollama.com/faq#how-can-i-specify-the-context-window-size) 说明默认上下文和服务/请求侧配置方式，[OpenAI-compatible 文档](https://docs.ollama.com/api/openai-compatibility#setting-the-local-context-size) 说明要用 Modelfile 的 `PARAMETER num_ctx` 创建更大上下文模型。扩页约束已通过结构化输入携带能力覆盖、候选证据和准确游标，因此 Planner 历史现只保留用户原话与追问/回答，移除所有工具结果。聚焦测试与 API 构建通过；以默认 4K 上下文和 1,024 输出预算重跑 `mosaic` 仓库→追问/同案恢复→评估→Reviewer→报告全链 Harness，28/28 检查通过、无 fallback，5 次工具调用、28 条进度事件、评估 10 人，用时 68.759 秒。只读取有限分页样本，不代表搜索完全部匹配记录或推荐排序已验证。
