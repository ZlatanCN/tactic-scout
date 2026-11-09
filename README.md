# TactiScout LangGraph Core

这是一个从零重建的足球资料 Agent。每轮先把请求整理成结构化任务，再按任务进入查询、比较、球员推荐或球队定向推荐工作流。

```text
用户消息 → 请求理解 → 球员身份解析 → 任务分流
                              ├─ 单球员查询 → assistant ↔ search tool → 回答
                              ├─ 多人比较 → compare node → compare tool → 总结
                              ├─ 球员推荐 → recommendation node → FM ranker → 总结
                              ├─ 球队推荐 → resolve_team → resolve_team_roster
                              │                 → recommend_players_for_team → 总结
                              └─ 需要确认 → interrupt → Command 恢复后继续原请求
```

## 代码结构

```text
src/
├── agent.ts                 # 组装图、路由条件边并编译
├── state.ts                 # messages、请求、确认中断与 thread 上下文
├── request-extraction.ts    # 结构化请求模型与提取规则
├── player-mentions.ts       # 对话中的已确认中文别名识别
├── nodes/                   # 实际加入 LangGraph 的节点
├── player-data/             # FM/Understat 读取、身份解析与排序
├── team-data/               # API-Football 适配器与阵容身份映射
└── tools/                   # 图节点调用的数据工具
```

请求理解节点提取任务类型、球员和球队提及，以及用户明确给出的条件。它只负责结构化请求，不规划执行步骤。需要确认身份时，图通过 `interrupt()` 暂停；调用方用同一个 `thread_id` 和 `Command({ resume })` 恢复。

`player_lookup` 进入模型和 `ToolNode` 循环。`player_comparison` 和球员推荐由确定性图节点直接调用对应工具。球员推荐按目标位置属性 RMSE 排名；高潜名单单独按 PA 排序。

球队推荐要求用户指定球队和 FM 位置。图通过 `resolve_team` 唯一识别 API-Football 球队，再由 `resolve_team_roster` 读取当前阵容并逐个映射到本地 FM 画像。中文名或简称可以先转换成 API-Football 搜索词；如果搜索词和用户原名不同，图会先请用户确认命中的球队。精确 Reep bridge 可自动映射；无 bridge 的同名画像必须由用户确认。任何队员无法映射时暂停推荐，避免把队内球员误报为候选。至少一名位置评分达到 15 且特征完整的队员才能形成团队参考画像；队员属性等权平均后复用现有 RMSE 排序，并排除全部已映射队员。结果分别显示阵容获取时间和 FM 快照日期。

球队阵容在进程内缓存七天。`API_FOOTBALL_KEY` 从本地 `.env` 读取，不要提交密钥；首版仅供本地或私有演示，不公开分发原始 API-Football 阵容数据。

同一 thread 会保存最近一次成功的球员和球队推荐。只改筛选条件时继承成功请求的球队、位置与映射；失败或中断不会覆盖最近成功结果。通过 `pnpm dev` 启动的 Dev Server/Studio 使用 LangGraph 原生 Checkpointer 和 Store，正常停止并重启后可恢复 thread、interrupt 和球员记忆。直接调用 `createAgent()` 则默认使用进程内存储；不保证强杀或断电后恢复。项目没有前端、RAG 或应用数据库。

## 启动

需要 Node.js 22.13+、pnpm，以及已配置的 OpenAI 兼容模型网关。球队推荐还需要 API-Football API key。

```bash
pnpm install
if [ ! -f .env ]; then cp .env.example .env; fi
# 在 .env 中配置 OPENAI_API_KEY、模型网关和可选的 API_FOOTBALL_KEY
pnpm dev
```

`langgraph.json` 将 `agent` 图暴露给 LangGraph CLI 与 Studio。真实 `.env` 不提交到 Git。

## 模型上下文预算

请求理解、球员查询工具循环和结果解释都在模型调用前估算完整输入，并为 ChatOpenAI 请求设置有限输出上限。官方 OpenAI 端点上有可信能力资料的模型可直接使用；自定义网关或未知模型必须在 `TACTISCOUT_MODEL_CONTEXT_PROFILE` 提供实际配置。JSON 至少包含匹配当前 `model` 与 `baseURL` 的标识、`maxOutputTokens`，以及 `contextWindowTokens` 或 `maxInputTokens`；官方端点的 `baseURL` 写 `null`。不要猜窗口大小。可选的 `countingMarginTokens`、`softTriggerFraction` 和 `targetFraction` 默认分别按 10% 余量、80% 软阈值和 60% 目标计算。

Tokenizer 使用 LangChain `getNumTokens`。首次计数可能从 `tiktoken.pages.dev` 下载对应的 tokenizer 编码文件。计数余量默认取 64 tokens 与输入窗口 10% 中的较大值。输入超限、无法计数或窗口配置缺失时，图会在发送模型请求前明确停止。当前预算票实现检查和安全停止；自动文字压缩、长输入分块和大证据分批由后续上下文管理票据交付。

thread 恢复、interrupt 回答、记忆管理以及版本不兼容时的处理见[本地会话恢复说明](docs/local-development.md)。

## 检查

```bash
pnpm test
pnpm build
```

Vitest 使用假模型、模拟 API-Football 响应和固定 FM 数据，不调用真实模型或足球数据 API，也不消耗模型 / 数据配额。首次 tokenizer 计数仍可能下载公开编码文件。
