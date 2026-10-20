# 12: 收缩旧运行时并完成迁移验收

**What to build:** 删除落败实验、旧上下文模式、重复工具调度器、不可达节点和仅实验可达的开关，让正常运行的架构与规格一致。完成自动测试、Web 构建、真实本地案件和 Harness 的端到端验收。

**Blocked by:** 05, 06, 07, 08, 09, 10, 11

**Status:** resolved

**Labels:** ready-for-agent

- [x] 正常组合只包含已采用的上下文、工具与并发机制；失败实验和兼容分支已删除。
- [x] 代码检索确认不存在重复工具调度器、不可达节点或只靠实验开关存活的路径。
- [x] 完整测试套件与 Web 构建通过。
- [x] 自然语言案件可以经过追问、候选证据、Reviewer 和最终报告完成本地 HTTP/SSE 链路。
- [x] 每项采用或拒绝的条件机制都有同一完整图、冻结数据的配对证据。
- [x] 文档、架构说明和实际运行组合一致。

## Answer

完成迁移验收。最终组合使用单一 `DecisionSnapshot` projection、LangGraph `ToolNode`、通过配对门槛的并行 enrichment 和 SQLite `BaseStore`。候选评估 `Send` 与局部 Agent 实验未通过门槛，其子图、循环、比较开关和专用测试均已删除；旧 planning、context compaction、summary/evidence 与 legacy action-dispatch 路径也已删除。

以 `9fa71d1` 为基准审查代码和文档；检索确认唯一工具执行器可达，图中的错误、暂停、审核、并行 enrichment 和交付节点均有路由。完整后端测试 753/753 通过，`pnpm build` 与 `pnpm build:web` 通过。完整 HTTP/SSE 测试通过自然语言案件追问、同案续跑、候选流、比赛证据、Reviewer 和最终报告，并检查事件顺序及最终证据引用。

机制结果分别记录在 issue 06（上下文 projection）、issue 07（并行 enrichment）、issue 09（拒绝候选评估 Send）和 issue 10（拒绝局部 Agent 循环）及其配对结果文件中。`spec.md` 与实际运行组合已同步；失败实验数据和全部 `.scratch` 资料保留。
