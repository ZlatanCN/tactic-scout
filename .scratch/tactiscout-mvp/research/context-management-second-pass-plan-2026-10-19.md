# TactiScout 上下文管理：补充调查与落地方案

研究日期：2026-10-19。使用 LangGraph、LangChain/Deep Agents、OpenAI Agents SDK、Google ADK、LlamaIndex 的官方资料，以及 Anthropic 官方工程文章；项目现状来自本仓库代码和本地 Harness 结果。本文是 `.scratch/context-management/spec.md` 的补充方案，不代表所提机制已在本机模型上验证有效。

## 结论

TactiScout 不需要再造一套通用“记忆平台”，也不需要为展示 LangGraph 而引入更多 Agent。应把四件不同的事明确分开：

1. **案件档案**：完整保存这一个球探案件里用户说过什么、工具实际返回什么，便于审计和恢复。
2. **案件权威状态**：当前有效的俱乐部、参考球员、位置/职责、用户确认或撤销、排除对象、检索游标、已核验证据和待解决问题。它是决策依据，不由摘要重写。
3. **模型工作上下文**：针对当前 LangGraph 节点，由代码从权威状态与已核验证据中组装出来的一份短视图。不同节点看到不同内容。
4. **案件导航摘要**：只有工作上下文仍然超预算时，才作为历史导航的有损副本；原始记录仍可按 ID 找回，摘要不能作为球员/比赛证据。

跨案件用户记忆另算：未来如果用户明确要求“以后默认找年轻球员”，再提供可查看、修改、删除的偏好设置。不能把一次案件的年龄、预算、球队或参考球员自动沉淀成个人画像。

## 新调查得到的实践

### 1. LangGraph 把“保存状态”和“整理模型输入”交给不同机制

LangGraph 官方将 checkpointer 定义为单个 `thread_id` 的图状态快照，支持会话连续、暂停恢复、容错和时间回溯；Store 是供跨 thread 使用的应用数据。State 应保存后续步骤需要的原始事实，在节点内按需格式化 prompt。也就是说，checkpointer 能保存案件状态，但不会自动裁剪 Planner 输入。[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[Memory](https://docs.langchain.com/oss/javascript/langgraph/add-memory)、[Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)

这与 TactiScout 的图结构匹配：SQLite checkpoint 负责可恢复案件；每个模型节点经上下文组装器获得有限视图。LangGraph 的价值在于可以将“先压缩/投影，再规划或继续工具调用”作为可观察、可测试的节点和边，而不是把压缩藏在一段不可见的聊天 SDK 行为里。

### 2. 优先把大内容移出模型输入，再做摘要

LangChain 的 Deep Agents 将上下文管理分成大工具结果外置、旧工具输入外置、摘要和按需读取：大结果被写入文件，模型先看预览与路径；当仍接近窗口限制且已无可外置内容时，才摘要旧历史，同时保存完整 canonical transcript 供后续检索。它的公开 targeted eval 专门验证压缩后是否继续原目标、以及早期信息能否通过工具找回；测试时可故意降低触发阈值以提高机制信号，再回到真实任务验证。[Context Management for Deep Agents](https://www.langchain.com/blog/context-management-for-deepagents)、[Context Engineering: How Deep Agents Remember](https://www.langchain.com/blog/context-engineering-deep-agents-remember)

Anthropic 的官方工程文章也把清理旧工具结果视为轻量压缩，并强调摘要过度会丢掉之后才显得重要的细节；结构化笔记与摘要都应有回查路径。[Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)、[Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)

适用于 TactiScout 的是“引用 + 预览 + 按需读取”，而不是照搬通用文件系统。候选指标、比赛观察、报告原文已经有业务语义和来源边界，应继续由已有的案件证据索引及 `read_case_evidence` 管理。模型上下文只携带候选目录、相关指标、样本信息及证据引用；结论或 Reviewer 要核实细节时再定点读取。

### 3. 摘要触发应基于实际请求压力，不是固定轮数

Google ADK 的 compaction 支持按实际 prompt token 阈值触发，并保留末尾若干原始事件；也支持固定事件间隔与 overlap。OpenAI Agents SDK 允许在模型调用前按应用逻辑裁剪输入，另有 Responses 专用的服务端/回合后压缩。SDK 文档提醒，回合结束后同步压缩可能让 streaming 的 `completed` 延迟到最后一个文本 token 之后。[ADK Context Compaction](https://adk.dev/context/compaction/)、[OpenAI Agents Sessions](https://openai.github.io/openai-agents-js/guides/sessions/)、[OpenAI Agents Streaming](https://openai.github.io/openai-agents-js/guides/streaming/)

通用结论是：阈值应反映**即将发出的完整模型请求**，包括 system 指令、结构化输出 schema、对话、工具结果和证据，而不是“对话已有 12 轮”。摘要发生在请求之前、请求之后还是由 Provider 托管，是具体运行时策略；需要按用户可见的首个进度和回合完成延迟评估。

### 4. Checkpoint 也要有增长策略，但这与 prompt 压缩是另一类工作

LangGraph 文档指出长期对话的 checkpoint 会持续累积，需要 retention/pruning；保留完整 checkpoint 不代表每次都要把全部内容发给模型。[Persistence troubleshooting](https://docs.langchain.com/oss/javascript/langgraph/persistence)

当前 TactiScout 使用 SQLiteSaver。现阶段不需要立刻拆数据库；先分别观测“每次模型请求有多大”和“每个案件 checkpoint 有多大/读写多慢”。如果后者成为真实瓶颈，再把大型不可变工具响应/证据正文移到本地案件档案表，checkpoint 只留有版本的引用和恢复所需状态。这是存储增长优化，不应混进第一次上下文质量消融。

## 对常见压缩笔记的校准

- **“静态前缀绝不能动，否则 KV cache 失效”不是跨 Provider 的通用红线。** Prompt caching 是 Provider 特定、基于相同前缀重用的性能优化；稳定 system 指令有助缓存，但与对动态历史做压缩是两个层面的事。缓存策略需按 Provider 验证，不能成为把有用上下文留在窗口里的理由。OpenAI 的说明使用 best-effort prefix caching，而不是永久锁定规则：[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)。
- **“摘要版本永远不能重算”也不是普遍要求。** TactiScout 应给摘要记录源事件范围、生成器版本和摘要版本；同一案件需求变化时可以生成新的衍生版本，但不能覆盖原始事件或让旧摘要冒充最新事实。版本化和可追溯性是产品要求，永久冻结文本不是。
- **“用户记忆必须主动学习出预测画像”不是本产品的必要目标。** LangGraph、ADK、LlamaIndex 都提供跨 session memory 能力，但它们只是存储/检索机制，不等于必须自动学习用户偏好。球探案件间默认隔离更能防止把旧预算、旧球队和已撤销条件带入新案。
- **更大的 context window 不会替代信息筛选。** Deep Agents 与 Anthropic 的实践都同时处理冗余、工具回传和恢复能力；但 TactiScout 应以报告正确、条件不丢、证据可追溯为验收目标，而不能把“context rot”当成未经验证的归因。

## 对当前代码的检查

已具备的基础：

- `src/recruitment/conversation.ts` 用 LangGraph StateGraph 编排案件，并将 `compact_case_context` 放在理解请求后、Planner 前，以及工具执行后、Planner 前。
- `src/recruitment/conversation/state.ts` 保存结构化案件状态、对话/工具事件、候选评估和证据相关状态；`src/recruitment/checkpoint-store.ts` 用 SQLite checkpoint 保存可恢复运行。
- `src/recruitment/context.ts` 统一构造请求，记录请求字节、system/payload/schema 组成、历史事件引用、证据引用、预算、指纹和 Provider usage 状态。
- `src/recruitment/planner-context.ts` 已为扩页和结论构造较小视图；结论可基于权威 State 构造完整候选指标目录，并对证据做按需读取。
- 五种实验模式已存在：`legacy`、`projection`、`evidence`、`unified`、`summarized`；目前 `legacy` 仍是默认值。

尚未证实的部分：

- 当前摘要节点触发条件仍是至少 12 轮、旧对话估算超过 2,048 tokens，而非当前完整请求越过某个软预算。它验证的是“挑选可引用的旧对话原话”流程，不能直接称为完整案件压缩或 token 优化。
- 估算器是 UTF-8 字节启发式。Manifest 已能记录 Provider 实际 usage，但 Provider 有时返回 partial/unavailable；单条请求的估算和实际 usage 差异不足以校准整个模型/所有 schema。
- `.data/evaluations/context-management-five-arm-qwen35-9b-20261019.json` 中每臂 5 次的结果都未通过：每臂 0/5 完成，20 轮压力脚本完成 0/20；legacy 扩页 Planner 的 p50 约 60 秒，达到超时。它不是“策略胜负”证据，只说明当时这个真实模型任务没有进入长对话压力段。不能用其 token 估算宣称某种策略有效或无效。

因此目前已经有可继续的工程骨架，但还没有证明哪一种上下文策略值得成为默认。

## 建议的目标架构

```text
本轮用户输入
     │
     ▼
LangGraph 读写案件 State ─────────────── SQLite checkpointer
     │                                     完整恢复/中断状态
     ├── 明确需求、修正、身份、游标、候选状态（权威）
     ├── 已取回原始证据与版本化 ref（可追溯）
     │
     ▼
按当前节点构造 Working Context
  ├─ understand：当前原话 + 必要的近期问答 + 当前 brief
  ├─ planner：有效约束 + 未解决项 + 已发现范围/精确游标 + 当前动作预算
  ├─ reviewer：完整合格候选目录 + 被引用的窄证据 + 缺失项
  └─ report：最终 shortlist + 有来源/样本的证据
     │
     ├── 先做字段投影、去重、历史工具结果替换为 ref
     ├── 超预算时再注入有界案件导航摘要
     └── 仍超预算则安全返回容量错误，不丢事实继续猜
```

请求投影是临时视图，不改权威 State。不可逆的裁剪只影响模型输入；源事件和来源证据仍能按案件 ID / event ID / evidence ref 恢复。每个 ref 必须检查案件归属、需求/证据版本，过期或缺失要显式报出。

## 分阶段落地

### 第 1 阶段：先让基线可测

在增加新压缩机制前，先让 `legacy` 对照任务通过短任务验收，并确认同一模型配置、数据快照、Planner 工具权限和请求预算稳定。Harness 增加短预检：基线有任一关键验收失败或模型请求超时，就不启动 25 次五臂长跑，并输出失败检查、阶段、usage 覆盖率和耗时。这样可以避免再花数十分钟得到“压力脚本根本没开始”的实验。

将结论分成两个互不混淆的问题：Planner 推理延迟/超时是模型与节点任务设计问题；请求过长/历史噪声是上下文策略问题。只有同一 baseline 可重复完成任务，才能把组间变化归因于上下文机制。

### 第 2 阶段：把已有请求清单作为每个模型调用的合同

需求理解、investigate、expand、reorient、conclude、Reviewer（如含 LLM）和摘要都使用同一预算/manifest 入口。每条记录包含 model/stage、context window 配置、输出预留、请求字节、schema/system/payload 各自大小、实际用量状态、调用结果、延迟与触发的压缩动作。user text 和网页正文不进普通日志；用现有指纹与 event/ref ID 排查。

Provider usage 有值时用作事实；没有时明确记 `unknown`，同时保留请求字节和标明为 estimate 的 token 数。校准须按当前 Ollama 模型、阶段、Structured Output 方法分别收集多条成功请求，不能从一条 usage 推出通用换算系数。

### 第 3 阶段：按节点投影 + 证据外置是默认候选，先做 targeted eval

先验证不需要摘要也能把每个阶段的 context 缩到恰当范围：

- Planner 不重放旧候选页、整页评估和无关报告正文；它收到完整发现数、最新页、有效过滤条件、exact `nextOffset` 和必要证据覆盖。
- Reviewer/结论保留所有符合范围的候选行，防止“压缩”变成静默漏掉候选；指标保留数值、单位、样本、赛事/赛季、missing-vs-zero 与证据 ref。
- 已取回的报告正文不在之后每个模型调用反复携带；模型需要核实哪条主张，再按 ref 有界读取原文。
- 每个阶段的 JSON schema / 可用动作只包含此阶段需要的输出；manifest 单独观察 schema 成本。

先用纯函数和公开调用链验证投影不丢事实，再对真实整图做单次/小样本检查：同一案件、同一候选与相同来源快照下，限制/排除对象/候选覆盖/游标/证据引用不变，context 体积确实下降。不要仅以“请求看起来更短”宣布成功。

### 第 4 阶段：只在预算压力下做可恢复的摘要

把摘要触发从“轮数阈值”改为由最终组装请求决定：经过确定性投影和 evidence-ref 化后，若超过本模型的软预算才触发；软预算再由当前配置的窗口、输出预留和安全余量计算。每个模型阶段可有独立软目标。

TactiScout 的摘要 schema 建议只记录案件导航信息：用户目标如何变化、明确更正/拒绝过什么、仍未解决的澄清、应继续的任务方向、来源事件 ID。球队/球员身份、年龄/预算条件、候选资格、统计数值、样本和已完成动作仍从权威 State / evidence refs 读取，不由语言摘要决定。保留最近若干原始用户/问答回合。历史摘要要求覆盖范围和来源引用可校验；读取原文失败时显式中断依赖它的步骤。

摘要节点应计入模型调用、usage、延迟与取消；生成失败回退到无摘要投影或安全分批。若摘要只在输出后同步跑，会拖慢 stream 完成；先在下一次模型调用之前按需执行，并把“整理较早对话”作为 SSE 进度。若可以延后且下一轮不会依赖摘要，则放在回合后后台进行。

### 第 5 阶段：存储增长与跨案记忆分别排期

先统计 SQLite checkpoint 大小、读写时间、history 中工具结果大小。超过约定上限后，再将大型、不可变工具结果/抓取正文移入本地档案或 evidence 表，checkpoint 保留恢复所需的小状态与稳定引用。引入引用时同时做旧 checkpoint 迁移、retention、清理/孤儿检查和引用失效回退。

不增加 LangGraph Store 用户画像、向量检索旧聊天或自动“偏好学习”。若未来用户提出跨案件个性化，再作为独立产品能力实现显式保存/查看/编辑/删除；偏好要有作用域和更新时间，且当前案件指令永远覆盖默认值。

## 验证计划与启用门槛

采用两层实验，避免单一完整任务把机制信号淹没：

1. **Targeted context eval**：以公开完整图/上下文 builder 为 seam，低触发阈值强制摘要。对较早对话埋入一条稍后才需要的案件要求；之后验证目标继续、用户撤销的旧条件没有复活、参考球员仍被排除、需要时能按事件/evidence ref 找回原始证据。另测压缩失败、ref 过期和恢复。
2. **真实配对消融**：仅在 baseline 短预检通过后，复用已有五臂 CLI 和固定 Barcelona 长对话脚本，比较 legacy、projection、evidence、unified、summarized；固定模型/快照/脚本/预算/配置，执行顺序轮换。至少五个完整配对重复，并计入摘要调用成本；未完成脚本/模型超时是失败样本，不得从 token 汇总里挑成功部分做结论。

验收先看正确性：有效要求和最新更正保留、本人/拒绝对象不推荐、精确游标连续、每位合格候选覆盖与身份不被改写、数值/单位/样本不变、证据可追溯、缺失不变成零、摘要不声称不存在的事实。再看总模型输入量、summary/tool-read 次数、端到端与首个有用进度延迟、checkpoint 大小/读写、usage 覆盖率。未知 token 用量必须在报告中标为 unknown。

保留当前 `legacy` 默认值，直到至少一种新策略满足：所有关键正确性用例通过；在完整、可复现的长任务上有明确净输入 token/延迟收益；摘要成本已计入；没有新增可复现的事实、身份或证据错误。若收益仅出现在低阈值强制摘要的定向测试，说明机制被覆盖到，不代表真实任务默认应自动摘要。

## 最小代码归属

延续模块化单体，保持招聘域内聚：

- `context.ts`：按阶段组装工作视图、预算、manifest 与降载决策，不持有业务真值。
- `case-evidence.ts`：证据注册、版本/案件校验、受限读取。
- `case-summary.ts`：摘要 schema、来源校验、版本和范围。
- LangGraph nodes：只编排何时投影、读取、摘要、暂停或继续，不复制上下文序列化逻辑。
- Harness：负责预检、配对运行、目标机制测试及实验报告。

暂不引入 Deep Agents、LlamaIndex Memory、独立向量聊天记忆或另一套 Agent runtime。当前业务已有 StateGraph、SQLite checkpoints、知识库和案件 evidence refs；先证明它们的投影边界与数据流有效。

## 主要来源

- [LangGraph Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) — checkpointer 与 Store 的生命周期分工、checkpoint 增长。
- [LangGraph Memory](https://docs.langchain.com/oss/javascript/langgraph/add-memory) — thread 短期状态、跨 thread 应用数据和按需读取 Store。
- [Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph) — State 保存 raw data，节点内格式化 prompt。
- [Deep Agents Context Management](https://www.langchain.com/blog/context-management-for-deepagents) — 大结果外置、阈值触发、完整历史归档、targeted eval。
- [Deep Agents Context Engineering](https://www.langchain.com/blog/context-engineering-deep-agents-remember) — 预览 + 原始文件恢复、按需加载能力、隔离噪声工作。
- [Anthropic Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — 压缩的召回/精度取舍、工具结果清理、结构化笔记。
- [OpenAI Agents SDK Sessions](https://openai.github.io/openai-agents-js/guides/sessions/) 和 [Streaming](https://openai.github.io/openai-agents-js/guides/streaming/) — 调用前历史筛选与会话后压缩延迟。
- [Google ADK Compaction](https://adk.dev/context/compaction/) — token 触发、近期 raw events 保留与 sliding window。
- [LlamaIndex Memory](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/) — FIFO 短期历史与可选 memory blocks 的预算化组合。
- [OpenAI Prompt Caching](https://developers.openai.com/api/docs/guides/prompt-caching) — 缓存依赖相同前缀的 Provider 行为，不是跨模型通用的压缩规则。
