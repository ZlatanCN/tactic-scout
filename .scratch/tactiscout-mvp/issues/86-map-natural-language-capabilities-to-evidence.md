# Map scouting language to observable evidence

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Carry the capabilities in a natural-language recruitment request through deterministic evidence coverage, LangGraph planning, Reviewer checks, and the final report. Unsupported football concepts must stay visible as evidence gaps.

## Why now

In a real three-turn Bayern replacement UI run, the user asked for a forward who could “接应、做球和终结”. The FPL pool returned 79 forwards and the graph evaluated 40, but the report showed no requested-capability coverage for those terms and no shortlist. The current capability vocabulary does not recognize “做球” or standalone “终结”; “接应” also has no directly observed FPL statistic. A separate same-scenario Harness run exited successfully with all registered checks, so the UI outcome demonstrates model-run variance and a gap in the current semantic coverage contract, not a ranking-quality conclusion.

## Scope

- Extend the deterministic request-to-evidence mapping for common Chinese scouting terms without mapping adjacent metrics as substitutes.
- Map “做球” to observed chance-creation outputs where available; map bare “终结” only to goal output, and continue treating shot-finishing skill as unavailable unless directly measured.
- Represent “接应” as unsupported when the selected source has no direct receiving/link-up field; do not infer it from goals, assists, xG, or generic passes.
- Ensure LangGraph planning and Reviewer receive the recognized coverage, and the report shows observed, partial, and unavailable dimensions with sample/source limits.
- Use the full repository → multi-turn LangGraph → report Harness path as the acceptance seam.

## Acceptance criteria

- [x] A deterministic request such as “找能接应、做球和终结的前锋” yields explicit coverage for the requested concepts.
- [x] “做球” can use only directly available chance-creation evidence; bare “终结” maps to goal output without claiming shooting technique; “接应” remains an explicit missing-data dimension for FPL.
- [x] Missing or unsupported capabilities are disclosed and never filled by nearby metrics; recommendations are limited to evaluated players and directly relevant evidence.
- [x] Final reports explain partial evidence and low-minute samples, and either provide an evidence-backed lead or explain why none can be supported.
- [x] Deterministic coverage/reviewer checks and the selected end-to-end Harness scenario pass; ranking accuracy remains unevaluated without scout labels.

## Comments

- 2026-10-07：窄屏真实报告显示已评估 40 人、192/600 个指标值、40 人均低于 900 分钟；当前报告未呈现用户原话中的三项能力覆盖。另一条真实 Harness 运行 allPassed=true，体现单次模型结果的波动。该任务只修正能力语义与证据契约，不改变数据源覆盖或伪造球探排序标签。
- 2026-10-07：Planner 结论 schema 最初按候选与指标逐项拼 union，扩大样本后长度膨胀；改为紧凑枚举 schema，压缩逐人指标与分页历史，并只保留本次明确需求直接关联的指标。Ollama OpenAI 兼容接口不支持 `tool_choice`；标准本机回环地址现在自动选择 JSON Schema 输出，其他兼容服务保留函数调用模式。前两次实跑发现 `reorient` 仍传入完整历史；改为同时压缩 `reorient`/`conclude` 后，最终三轮链路 74.411 秒通过 25/25 检查。

## Answer

已完成“接应、做球、终结”从用户对话到报告的语义与证据链：`做球` 映射到当前球员记录里实际存在的助攻/预期助攻等创造产出；单独的 `终结` 只映射为进球产出，并另外记录射门技术数据缺口；`接应` 不借进球、助攻或泛化传球补足。Reviewer 会核对推荐候选及其逐人证据，覆盖状态和来源局限进入最终报告。

本机 `qwen3.5:9b` 使用 FPL 当前赛季英超目录完成所选的完整链路验收：同案三轮对话、两次追问/续跑、79 条 ATT 匹配记录、30 人评估、12 次工具调用，经过方法检索、候选分页、能力评估、球员报告查询和 Reviewer 后生成报告；25/25 Harness 检查通过，用时 74.411 秒。报告显示进球产出与创造机会均为 19/30 部分覆盖，射门技术和进攻接应缺少直接指标；输出 2 条引用进球、助攻或 FPL xA 的后续考察线索。球员报告命中为 0，报告中的低样本和当前目录范围限制仍保留。

该真实运行只验证这次 Agent 行为与证据契约，不验证推荐排序准确性、完整转会市场覆盖或长期模型稳定性。
