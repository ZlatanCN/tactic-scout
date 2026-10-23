# TactiScout LangGraph Core Loop

这是一个从零重建的最小足球资料 Agent。请求涉及某位球员的替代或比较时，图先确认目标球员身份；无法唯一确认就暂停追问。身份确认后，模型可以请求查询工具，LangGraph 执行工具并把结果送回模型，直到模型给出回答。

```text
用户消息 → 身份解析节点 → assistant ↔ tools → 回答
                    └─ 不明确 → interrupt 追问 → 确认后继续
```

## 代码结构

```text
src/
├── agent.ts            # 组装 StateGraph、身份门控、工具循环并编译
└── utils/
    ├── state.ts        # messages 与身份解析状态、reducers
    ├── nodes.ts        # 身份解析/澄清节点和模型节点
    └── tools.ts        # Understat、FM 查询与精确身份注册表解析
```

控制流使用 LangGraph 的 `StateGraph`、`ToolNode`、`toolsCondition` 和 `interrupt`。身份门控先用模型提取用户原文中的球员称呼，再查本地 Reep 精确 ID 映射；短称、多个候选或注册表不可用时会暂停，请用户确认。姓名本身不会触发跨来源合并。thread checkpoint 使用 `MemorySaver`，跨 thread Store 使用 `InMemoryStore`；两者都只在进程内有效，进程重启后会丢失。首版没有前端、RAG 或图状态持久化数据库。

`tools.ts` 读取 Git 忽略的 `.data/` 本地 SQLite 数据快照。Understat 表现记录与 FM 能力画像按来源分别返回；只有身份注册表返回唯一精确映射或用户明确确认后，模型才将其作为同一目标球员。未确认来源允许模型处理时，只允许配置在回环地址的模型端点接收这些数据。

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

Vitest 使用假模型和固定结果验证身份追问门控及完整工具循环，不调用外部模型，也不读取本机球员数据库。
