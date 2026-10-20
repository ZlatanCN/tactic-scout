# LangGraph 原生工具调用迁移

## 目标

让 TactiScout 的 Planner 使用具名工具调用，并由 LangGraph `ToolNode` 执行数据工具；保留现有招募案件 StateGraph、需求理解、确定性资格/预算策略、等待用户、checkpoint 恢复、Reviewer 和报告投影。

## 现状与问题

生产 Planner 当前通过一个 `recruitment_action` 结构化输出返回包含数据动作与控制动作的联合对象。对话图再以 `switch(action)` 手动分发和执行数据动作。该协议绕过了 LangGraph 的 `ToolNode`、LangChain `tool()`、模型 `bindTools()` 与 `toolsCondition()`。

## 方案边界

- 模型按当前阶段和已验证预算获得具名、受限的工具集合。
- `ask_user` 与 `finish` 是图控制信号，路由到等待/审核边，不由数据工具执行。
- 每次最多执行一个工具调用；策略必须在工具执行前核验 Planner 的提议，拦截或修正后只执行最终动作。
- `ToolNode` 负责按名称执行工具；球员资格、状态投影、进度、取消、安全错误、候选证据规则仍属于 TactiScout。
- `toolsCondition` 仅路由具名数据调用；人机等待、Reviewer、检查点恢复、策略拦截与终止仍由案件 StateGraph 显式管理。
- 现有注入式测试 Planner 可保留适配，避免把既有业务策略回归改写为协议测试。
- 不增加冗余 LLM classifier。需求理解已经把任务分类为 reinforcement/replacement/similarity；图中的条件边根据结构化状态路由。
- 旧版 JSON action 与直接分发仅作为 Harness 对照臂保留，不作为产品默认路径。
- 对照只接受需要实际调用 `search_candidates` 的 shortlist 场景；运行前以产品默认的原生协议执行单次前置检查，确认模型、数据与场景可运行。若原生路径未得到完整报告（包括模型协议错误、上下文超限或工具未触发），立即停止，不消耗后续配对运行。旧协议只在交错配对臂中评估；它的失败必须记录为对照结果，不能用旧协议预检失败来选择性取消配对。

## 验收接口

1. 从公开入口 `createRecruitmentConversation` 运行完整图，验证具名工具调用、ToolNode 执行、ask/finish 控制路由和策略拦截。
2. 复用 `pnpm eval:local-agent` Harness 做同一登记场景的旧 action 与原生工具协议配对消融，记录报告/检查、工具调用数、Planner 调用数、输入输出 token 与耗时；没有真实模型的成功运行时不得宣称性能或质量获益。

Harness 入口：

```sh
TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario barcelona-under-23-midfielder --compare-tool-protocol --runs 3
```

## 完成标准

- 默认产品 Planner 经由 `bindTools` 发出具名调用，数据动作由 LangGraph `ToolNode` 执行。
- 复杂案件控制流、检查点、等待/恢复与流式进度保持可用。
- 被策略拦截的提议不会调用对应数据工具；多调用或未知工具不会并发/越权执行。
- TypeScript 类型检查和受影响的完整图回归通过；Harness 对照结果被记录为可复核文件，或清楚标记受模型端点/额度影响而未得到有效结果。
- 不触碰本任务开始前已存在的上下文管理未提交改动，不提交代码。

## 本次实跑结论

实跑记录见 [results.md](./results.md)，原始 Harness JSON 保存在 [harness-results.json](./harness-results.json)。模型端点可用，但本次对照没有形成可支持质量或效率结论的完整样本：清晰需求六次配对运行均未全部通过，旧协议两次在报告阶段触发上下文容量错误、一次 Planner 响应错误；原生协议两次出现相同类别错误，一次生成报告但未通过 4 项场景检查。后续必须先解决上下文容量与 Planner 响应稳定性，再重跑配对实验。
