# TactiScout LangGraph Core

这是一个从零重建的足球资料 Agent。每轮先把请求整理成结构化任务和实体，再解析所有球员身份。当前只执行球员记录查询；比较和推荐意图会被识别并明确告知尚未接通。

```text
用户消息 → 请求理解 → 球员身份解析 → 任务分流
                              ├─ 球员查询 → assistant ↔ tools → 回答
                              ├─ 身份不明 → interrupt → Command 恢复
                              └─ 其他已识别任务 → 说明当前边界
```

## 代码结构

```text
src/
├── agent.ts            # 组装请求理解、身份解析、分流与工具循环
└── utils/
    ├── state.ts        # messages、结构化请求与身份状态
    ├── nodes.ts        # 请求提取、身份解析、澄清和 assistant 节点
    └── tools.ts        # Understat/FM 查询和 Reep 身份关联
```

请求理解节点提取任务类型、所有球员与球队提及，以及用户明确给出的条件。它只负责结构化请求，不规划执行步骤。所有球员提及都先经过本地身份解析；短称或多个候选会通过 `interrupt()` 请求确认，调用方用同一个 `thread_id` 和 `Command({ resume })` 恢复。

`search_player_records` 分别查询 Understat 赛季表现与 Football Manager 能力画像。工具用本地身份注册表把能映射到同一 canonical Reep ID 的来源记录放入同一 `identityGroups`；无确切关联的记录保留在 `unlinkedRecords`，不会凭同名合并。来源指标始终分开呈现。

目前 `player_lookup` 进入模型和 `ToolNode` 循环。`player_comparison`、`player_recommendation`、`team_recommendation` 已纳入请求类型，但对应执行链尚未实现。这里不放空的占位工作流。

thread checkpoint 使用 `MemorySaver`，跨 thread Store 使用 `InMemoryStore`；两者都只在进程内有效，重启后会丢失。首版没有前端、RAG 或图状态持久化数据库。

`tools.ts` 读取 Git 忽略的 `.data/` 本地 SQLite 数据快照。未确认来源允许模型处理时，只允许配置在回环地址的模型端点接收这些数据。

## 启动

需要 Node.js 22.13+、pnpm，以及已配置的 OpenAI 兼容模型网关。

```bash
pnpm install
if [ ! -f .env ]; then cp .env.example .env; fi
# 首次配置时，在 .env 中填入 OPENAI_API_KEY，并设置模型网关地址
pnpm dev
```

`langgraph.json` 将 `agent` 图暴露给 LangGraph CLI 与 Studio。真实 `.env` 不提交到 Git。

## 检查

```bash
pnpm test
pnpm build
```

Vitest 使用假模型和固定结果，不调用外部模型，也不读取本机球员数据库。
