# 面试演示路线

## 免模型查看记录

只想先看运行效果时，在首页选择“先看一段真实运行”，或直接打开 `/showcase`。这页无需 API、Ollama 或数据服务，会展示一次真实 Harness 运行的脱敏摘要：LangGraph 追问与同案恢复、观察到的工具调用、报告证据和数据范围。

安装 Node.js 22.13+ 和 pnpm 后，在仓库根目录运行下面两条命令即可打开它：

```bash
pnpm install
pnpm dev:web
```

然后访问 <http://127.0.0.1:5173/showcase>。`dev:web` 只启动 Vite Web 工作台，不启动 Fastify API。

页面不是实时回放，也不重建原始对话；该次运行使用 Wyscout 2017/18 历史数据。29/29 表示单次运行通过了预先定义的行为检查，不代表候选排序质量或当前市场覆盖。数据署名和原始来源链接显示在页面底部。

想开启新的互动调查，再按下面步骤配置 Ollama 和 API。

这条路线让评审者在几分钟内看到 TactiScout 的核心：用户用一句自然语言发起招募调查，LangGraph 根据案件状态调用数据工具；遇到关键歧义时暂停等待用户，再在同一案件继续，最后由 Reviewer 检查证据并生成带范围说明的报告。

## 准备环境

交互演示需要 Node.js 22.13+、pnpm、Ollama 和 `qwen3.5:9b`。按[快速开始](../README.md#快速开始)安装依赖并复制 `.env.example`，再将 `.env` 中的模型配置设为本机 Ollama，并选择当前的单一 Understat 路线：

```env
TACTISCOUT_DATA_MODE=understat
OPENAI_API_KEY=ollama
OPENAI_MODEL=qwen3.5:9b
OPENAI_BASE_URL=http://127.0.0.1:11434/v1/
OPENAI_REASONING_EFFORT=none
```

确认 Ollama 已下载模型并在本机运行。在单独的终端启动 API 与 Web：

```bash
pnpm dev
```

```bash
pnpm dev:web
```

然后打开 <http://127.0.0.1:5173/>。`understat` 读取五大联赛当前赛季的男子球员表现记录；它不是完整注册阵容或转会市场，没有年龄字段，且自动采集、留存、模型/RAG 处理及公开展示权限尚未核实。报告会披露本次实际读取的范围与限制。想离线体验对话流程时，可保留默认 `TACTISCOUT_DATA_MODE=demo`；它使用虚构数据，不代表真实球员表现。

## 现场走一遍

1. 点击首页的拜仁示例，或输入“为拜仁寻找凯恩的替代者，重点看能接应、做球和终结的前锋”。
2. 观察 LangGraph 进度时间线：它会展示实际开始和完成的调查阶段、工具读取量与可观察结果，不会显示模型隐藏推理或虚构百分比。
3. 如果 Agent 询问职责、位置或候选范围，按你的真实偏好回答。图会暂停等待补充，再恢复同一案件；具体问题和结果随数据、模型及运行状态变化，不保证每次都问相同问题。
4. 检查报告中的候选证据、来源/赛季范围、能力缺口和风险。缺少直接指标的能力会标为数据缺口；Reviewer 不会把附近指标包装成证明。
5. 可保存招募计划，回看这次对话和最近报告快照。计划保存在当前浏览器的 `localStorage`。

## 展示 LangGraph 的价值

面试时可以这样讲：

> 这不是一次 Prompt 后生成名单的链。LangGraph 保存招募案件状态，Planner 在调查过程中选择下一步；结构化工具负责检索与指标计算；条件边控制合法状态迁移；关键需求不明确时用 `interrupt` 等用户补充，之后从同一案件 checkpoint 恢复；Reviewer 发现证据不足时可以把图送回调查。进度时间线来自真实节点和工具执行，因此可以和报告里的来源及覆盖范围核对。

现场演示用于说明 Agent 如何工作。要查看可复算的行为验收，运行：

```bash
mkdir -p .data/evaluations
TACTISCOUT_DATA_MODE=understat pnpm eval:local-agent -- \
  --scenario understat-five-league-xg-creation \
  --summary-output .data/evaluations/understat-demo-summary.json
```

命令只为这次调用选择 Understat；模型仍使用当前 `.env` 的本机 Qwen 配置。摘要文件只保留聚合运行数据，且不会覆盖已存在文件；重复运行时请更换文件名。最近一次身份自由摘要记录于 2026-10-12：31/31 项预设行为检查通过，用时 53.195 秒；查询匹配 650 条来源记录，本轮读取并评估 20 条，评估器返回 220/340 个预期指标值。运行包含 3 次模型请求、6 次工具调用和 29 条进度事件；方法语料命中 2 个片段/1 个来源，球员报告语料 0 命中。另一次同日运行用时 107.674 秒；两次都是独立的单次行为验收，不代表长期可靠性、完整市场覆盖或推荐排序质量。完整细节见[评测说明](evaluation.md)和 [issue 94](../.scratch/tactiscout-mvp/issues/94-understat-five-league-conversation-chain.md)。

## 结果边界

Harness 检查验证的是单次运行的多轮恢复、工具策略、证据引用、进度和报告契约。项目没有真实双人球探标签，因此目前没有可信的 nDCG 或推荐质量结论；一份表现数据快照也不等于完整阵容或全球转会市场。

## 简历描述与一分钟讲解

### 中文简历

**TactiScout｜对话式足球球探 Agent** · TypeScript、LangGraph、React、Fastify、SQLite

- 构建有状态的自然语言招募调查：LangGraph 编排球员与方法资料工具，在关键需求不明确时暂停追问，并通过 SQLite checkpoint 恢复同一案件；确定性 Reviewer 只允许结论引用本轮实际评估到的证据。
- 构建来源可追溯的球员评估器与本地 Harness。三组 Wyscout 2017/18 巴萨 U23 整图对照中，启用组 3/3 次通过 31/31 检查、每次产出 3 条线索/6 条引用；屏蔽组 3/3 次不作无证据推荐（常规能力检查 29/31），下游轨迹一致。该实验只验证证据流，排序质量未评估。详见[评测记录](evaluation.md#能力证据评估器整图消融)。

### English resume

**TactiScout | Conversational Football Scouting Agent** · TypeScript, LangGraph, React, Fastify, SQLite

- Built a stateful, natural-language recruitment workflow in LangGraph: it orchestrates player and methodology tools, pauses for decision-critical clarification, resumes the same case from SQLite checkpoints, and uses a deterministic reviewer to reject recommendations unsupported by observed evidence.
- Built a provenance-aware player evaluator and local Harness. In 3 matched pairs of full-graph runs on a frozen 2017/18 Wyscout case, all enabled runs passed 31/31 checks and produced 3 leads/6 citations each; all evidence-withheld controls made no recommendations (29/31 ordinary coverage checks). Downstream traces matched in every pair; ranking quality remains unevaluated. See the [evaluation record](evaluation.md#能力证据评估器整图消融).

### 面试时的一分钟版本

> 这个项目的重点不是让模型一次性写一份球探报告，而是让它在一个可恢复的招募案件里持续调查。Planner 根据当前状态选择下一项工具；工具返回有来源的数据后，确定性评估器计算可观测指标，Reviewer 再检查推荐是否引用了这些实际证据。遇到会改变候选方向的歧义时，LangGraph 会暂停等用户补充，并从同一 checkpoint 继续。在固定的历史一对一案例中，我做了三组评估器开关整图对照：启用时每次都通过 31/31 行为检查，形成 3 条线索并引用 6 条证据；屏蔽评估证据时三次都不产生推荐。它只验证证据如何进入报告，并未验证名单排序质量；后者仍需要独立球探标签。

上述条目概括的是项目结构和冻结场景行为结果。实际数据范围、权限状态和各消融结果以[评测说明](evaluation.md)、[数据来源说明](data-sources.md)及每项 issue 记录为准。

架构细节见[架构说明](architecture.md)，数据范围和配置见[数据来源说明](data-sources.md)，评测方法见[评测说明](evaluation.md)。
