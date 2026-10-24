# LangGraph TypeScript 项目结构调研

**调研日期：2026-10-24**  
**问题：**如何组织当前小型 LangGraph 足球球员查询项目，避免为了分类而不断新增薄目录。  
**范围：**LangGraph 官方 JS/TS 文档、官方 starter 和 LangChain 官方 TypeScript 仓库；不把任何示例目录宣称为框架规定。

## 结论

LangGraph 没有规定 `nodes/`、`tools/`、`utils/` 等目录结构。官方文档规定的是工作流应由职责明确的节点、共享状态和路由组成；目录如何映射到代码库是应用自己的决定。官方最小 JS starter 把 `graph.ts` 与 `state.ts` 放在 `src/agent/`，而官方 LangGraph.js 仓库的小型工具循环示例将模型、LangChain tools、`ToolNode` 和图装配写在单个 `simple-tool-graph.ts` 中。这说明起步阶段应优先保持可读，而非先搭完整分层。[官方 LangGraph 节点与状态设计指南](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph) · [官方 JS starter 的图入口](https://github.com/langchain-ai/new-langgraphjs-project/blob/main/src/agent/graph.ts) · [官方简单工具图](https://github.com/langchain-ai/langgraphjs/blob/main/examples/streaming/src/agents/simple-tool-graph.ts)

官方更复杂的示例按独立 Agent/子图组织代码，并将跨示例共享的东西放在 `shared/`，而不是把每种函数强行归入全局 `nodes/`、`tools/` 或 `utils/` 层。[LangGraph.js 官方 streaming examples 目录说明](https://github.com/langchain-ai/langgraphjs/blob/main/examples/streaming/README.md) 这支持“按变化边界和能力划分模块”，不支持某一种固定目录模板。

## 应用于当前项目

当前代码已有两类相交的职责：图节点负责请求理解、必经身份确认和回答路由；球员查询能力读取 Understat、FM 和 Reep 本地数据，既被球员搜索工具使用，也被身份解析节点使用。因此，`identity/` 和 `request/` 各自作为单文件目录会过度分类；但把数据库读取直接塞进图节点也会让节点与数据格式耦合。以下是基于当前依赖关系的建议，不是 LangGraph 官方标准：

```text
src/
├── agent.ts                         # langgraph.json 指向的图编排入口
├── state.ts                         # LangGraph state schema
├── request-extraction.ts            # 请求提取 prompt/schema/模型调用
├── player-mentions.ts               # 多个节点共用的称呼/指代规则
├── nodes/                           # 只放实际挂到 Graph 的节点
│   ├── request-understanding.ts
│   ├── entity-resolution.ts
│   ├── identity-clarification.ts
│   ├── request-boundary.ts
│   └── assistant.ts
├── player-data/
│   ├── contracts.ts                 # Source record / identity contracts
│   ├── search-records.ts            # 球员数据查询能力
│   ├── resolve-reference.ts         # 确定性候选查找/身份关联能力
│   ├── understat.ts
│   ├── football-manager.ts
│   ├── reep-registry.ts
│   ├── name-matching.ts
│   └── shared.ts                    # 仅限 player-data 内部共用逻辑
└── tools/
    └── search-player-records.ts    # LangChain tool schema/description 的模型适配层
```

### 依赖规则

```text
agent.ts 负责组装
nodes/entity-resolution → player-data.resolve-reference
tools/search-player-records → player-data.search-records
player-data 用例 → 本地数据源读取器
state.ts → player-data/contracts.ts（单向类型依赖）
```

- `nodes/` 只放实际 GraphNode 实现。请求理解模型调用和被多个节点共用的球员称呼规则分别留在 `request-extraction.ts` 与 `player-mentions.ts`，不为单个文件再建 `request/` 或 `identity/` 目录。
- `tools/` 只表示**模型可见的 LangChain tool**。模型决定是否调用它；身份解析是图必须执行的控制步骤，不应为了复用代码而伪装成可选 tool。官方文档也区分 LLM、数据获取、动作和用户输入步骤；LangGraph node 本身就是执行这些步骤的函数。[官方节点设计指南](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)
- 节点不直接导入 SQLite/provider 读取器；`entity-resolution` 依赖 `player-data.resolve-reference` 这类确定性能力。这样图负责必经控制流程，`player-data/` 负责数据读取和身份匹配，模型 tool wrapper 只拥有模型接口描述。
- Understat、FM、Reep 目前只有少量实现，先平铺在 `player-data/`，不必增加 `sources/` 子目录；来源数量或内部职责增长后再下沉。`utils/` 不回归，因为这些逻辑不是跨领域通用工具。
- `state.ts` 是图运行状态，不应成为所有业务类型的总入口。source record 和 identity contracts 由 `player-data/contracts.ts` 定义；图状态可以引用这些契约，数据模块不反向依赖 LangGraph state。

## 证据与边界

官方 starter 适合作为部署入口和最小 graph 的参考，不是目录规范。当前项目保留 `src/agent.ts` 作为 `langgraph.json` 的入口，形成三条清楚的能力边界：**`nodes/` 负责图状态转换，`player-data/` 提供节点与 tool 共用的球员数据能力，`tools/` 负责模型可见的 LangChain 接口**。不要为了“看起来分层”预先添加 `services/`、`repositories/`、`adapters/`、`utils/` 或单文件子目录。

### 一手来源

1. [Thinking in LangGraph (JavaScript)](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph) — 节点职责、数据步骤、状态与节点粒度权衡。
2. [Official LangGraph.js starter](https://github.com/langchain-ai/new-langgraphjs-project) 和 [starter graph.ts](https://github.com/langchain-ai/new-langgraphjs-project/blob/main/src/agent/graph.ts) — 最小项目的 `src/agent/graph.ts` 组织方式。
3. [LangGraph.js simple tool graph](https://github.com/langchain-ai/langgraphjs/blob/main/examples/streaming/src/agents/simple-tool-graph.ts) 和 [official streaming examples README](https://github.com/langchain-ai/langgraphjs/blob/main/examples/streaming/README.md) — 简单图单文件、较大示例按 agent 拆分并将共用实现放入 shared 模块。
4. [LangGraph workflows and agents](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents) — 工作流与 Agent/tool loop 的边界。
