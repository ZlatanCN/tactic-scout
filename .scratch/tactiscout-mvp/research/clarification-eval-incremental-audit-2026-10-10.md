# 澄清评测增量核查：单变量职责缺口与 `−ask_user` 消融

核查日期：2026-10-10。基线：[对话式球探 Agent：澄清、同案续跑与工具编排评估](conversational-clarification-langgraph-evaluation-2026-10.md)。本次仅新增研究记录；未改应用代码、未运行本地模型。

## 结论

基线中的 LangGraph 中断恢复、清楚请求控制、隐藏答复脚本、逐项工具断言和 `−ask_user` 思路仍然适用，不需改架构。建议下一轮把评测收敛成一个**只差“具体中场职责是否写明”**的配对场景，并与 `ask_user` 开/关交叉：清楚需求验证 Agent 不盘问；职责缺失验证 Agent 是否在有用的初始球探证据后提问、同案恢复并把回答带入后续决策。

本次增量只细化了测量办法：最新适用于“先搜索、再澄清”的研究把终端任务效果、歧义识别、问题效用和交互成本分别报告；最新的工具 Agent 研究还提醒，单变量配对比单一总体分数更能暴露行为是否响应了真正变化的需求。后一项为 2026-10-04 的 arXiv 预印本，主题是授权与行动，下面只借用配对和实行动作评估方法，不把它当作球探需求澄清的直接证据。

## 官方 LangGraph JS 语义核对

截至核查日，当前官方 JavaScript 文档仍明确：

- `interrupt()` 需要 checkpointer 和配置中的 `thread_id`；中断状态通过 checkpointer 保存，`__interrupt__` 将中断负载返回调用方。恢复时使用**同一个** `thread_id`，以 `new Command({ resume: answer })` 再次 `invoke()`；resume 值成为 `interrupt()` 的返回值。[官方 Interrupts 文档](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- 恢复时从调用 `interrupt()` 的整个节点开头重跑；中断前的代码会再执行，非幂等副作用可能重复。因此澄清节点应轻量，把副作用放在中断之后或独立节点，并保证可重复调用安全。[Interrupts：恢复规则与副作用](https://docs.langchain.com/oss/javascript/langgraph/interrupts#rules-of-interrupts)
- `MemorySaver` / `InMemorySaver` 仅存 RAM，进程重启会丢失 checkpoint；若产品要承诺重启后继续同一案件，应使用持久 checkpointer，并用进程重启恢复验证该承诺。[官方 Persistence 文档](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- 官方测试指南指出，直接调用 `graph.nodes[name].invoke()` 会绕开编译图的 checkpointer；单节点测试不能证明中断、状态保存和续跑。完整图测试可以用独立的 `MemorySaver`、相同 `thread_id` 和实际 graph invoke；`updateState` / `interruptBefore` 适合从中间状态测局部路径。[官方 Test 文档](https://docs.langchain.com/oss/javascript/langgraph/test)
- 文档现在补充了中断回复的可选 `responseSchema`：Zod schema 支持从 LangGraph `1.4.16` 起，可让调用方取得结构并验证 resume 值；纯 JSON Schema 会原样暴露为 schema，但 LangGraph 不负责校验 resume 值。仓库当前安装版本为 `1.4.18`。这是可选 UI/API 契约能力，不改变自由文本澄清和同案恢复的基本设计；只有确实要让用户填结构化选项时才值得启用。[Interrupts：回复 schema](https://docs.langchain.com/oss/javascript/langgraph/interrupts#define-an-interrupt-response-schema)

**设计审计：不需改设计。**此前研究对 `thread_id`、节点重跑、持久 checkpointer 和“node 测试不等于图续跑测试”的结论仍正确。新增 schema 是方便的 typed-input 能力，不是澄清策略评测的新要求。

## 最新可借鉴的评测协议

1. **DiscoBench（2026-06 arXiv v2）最贴近 TactiScout 的多步检索链。**它把任务分成可执行 checkpoint，并在每一步区分 `Search`、`Ask`、`Answer`；分别报告最终任务效用 / checkpoint 通过、歧义识别、提问质量与回答是否推进、工具和交互成本。作者还指出，识别歧义和问出有用问题不是同一能力；重复搜索本身不会弥补关键歧义。TactiScout 可采用其分维度报告和“澄清后必须让搜索轨迹向正确目标推进”检查，不需要引入它的 QA 数据集或 LLM 用户模拟。[论文与版本记录](https://arxiv.org/abs/2606.27669) · [论文全文：任务动作、评价与指标](https://arxiv.org/html/2606.27669v2)
2. **AskBench（Findings of ACL 2026）提供 rubric/checkpoint 风格的澄清评估。**它覆盖必须问的缺失意图和需要纠正的错误前提，以交互轮次中的显式 checkpoint 评估覆盖、终答与多余追问。可以继续采用“答复只揭示问句覆盖的槽位”和“清楚请求控制组”；但不要采用单模型同时模拟用户和裁判来决定本项目真值。[ACL Anthology 原文](https://aclanthology.org/2026.findings-acl.845/)
3. **DelegationBench（2026-10-04 arXiv v1，未同行评审）是最新的邻近工具 Agent 协议，不是本领域结论。**它把成对场景设计成只改一个事实，并比较模型仅判断动作与真正带工具执行时的行为；作者建议把配对响应度、提问与行动分别报告。可借鉴严格的单变量干预和真实 action trace；不可把“请求用户授权”结果泛化为“澄清球探角色”规律。[arXiv 版本 / 摘要](https://arxiv.org/abs/2610.05532) · [论文全文：匹配对及实行动作协议](https://arxiv.org/html/2610.05532v1)

## 下一轮：最小可执行配对实验

### 冻结两个只差一项的 case card

建议以当前 `barcelona-under-23-midfielder` 请求作为清楚控制，并复制成缺少具体职责的变体。句子只增删职责描述，俱乐部、年龄、宽位置、能力偏好、数据快照和工具预算均相同：

| 条件 | 用户首句（示例） | 隐藏标注 |
|---|---|---|
| 清楚控制 | “为巴萨找一名 23 岁以下的中场，优先 8 号位，重点评估推进和前场压迫。” | 目标球队、MID、年龄上限、能力维度和职责均已明确；应直接调查，不为职责再追问。 |
| 职责缺失 | “为巴萨找一名 23 岁以下的中场，重点评估推进和前场压迫。” | 其余约束不变，只缺 6/8 等具体职责偏好；case card 预先定义这会改变比较侧重。标准补答：“偏组织型 8 号位，不找纯防守后腰。” |

职责标签只是用户的偏好，不得伪装成数据集能验证的注册位置或球员事实。如果来源只有粗略 `MID` 位置或没有职责专属指标，补答只能影响可观测证据的解释方向；报告须披露该职责无法直接验证。候选排名没有独立球探标签，本实验不打分、不声称 shortlist 更准。

在 case card 预先锁定“最早合理问点”：Agent 已查看目标队/可用候选的初步证据之后、形成职责敏感的最终推荐之前。这样可以检验现有的 evidence-first 策略，且不把任意一句“你能补充吗？”计为成功。清楚控制应在相同工作流阶段直接进入结论，不因提示词要求问问题而增加一轮。

### 四格消融与执行顺序

| 场景 | 正常 Harness | `−ask_user` |
|---|---|---|
| 清楚职责 | 调查并完成报告；不应出现 `ask_user`。 | 应与正常 Harness 行为一致；不应因该开关改变工具轨迹或报告终态。 |
| 职责缺失 | 初步调查后问一个目标为职责偏好的问题；确定性答复器只在问到职责时返回预设补答；同一案件恢复并产出受证据约束的报告。 | 屏蔽 `ask_user`；不可注入隐藏补答、猜一个默认职责或把不完整名单包装成已满足意图。首次遇到必须补充的职责时，以现有 `needs_input` 响应安全暂停；评测记录将缺项标记为 `role_unresolved`，不新增 API 状态。 |

消融只改一项：用户澄清能力是否可用。正常组和消融组固定相同模型/量化、prompt、graph、候选数据 hash、工具、工具与步骤预算、采样设置、case 文本及隐藏答案；运行间用独立 `thread_id`。最好按配对顺序交错执行，减少本地模型服务负载时变对两臂的影响。`−ask_user` 到首次必要提问处就结束，**不能**把模型被迫猜测的结果作为另一臂，否则测到的是“猜测策略”而非提问能力。

最低成本采用每格 1 次作为端到端 smoke（4 次），确认流程/trace可运行后再做每格 3 个独立案件（12 次）作为探索性重复。三次重复只是这组冻结场景内的可复验行为样本，不能估计普遍可靠性；若要报告策略通过率或外推到别的职责/球队，应先增加不同的 case pair，而不是只重复同一句话更多次。记录本机模型与 prompt/graph 版本、数据 hash、run ID、开始时间、每格原始 pass/n 和失败轨迹类别；不把运行当成独立 case 计数。

### 预注册硬断言和报告指标

- **是否该问：**职责缺失正常组应在最终推荐之前发出职责相关问题；清楚组不得为同一职责追问。逐 run 报 `ask_needed` 与 `ask_clear_control` 原始计数。
- **问得是否对：**问题语义须覆盖“具体中场职责/角色”；不能把询问年龄、预算、联赛、国籍或一个复合问卷算作命中。case card 预先列允许的意图，不按逐字文本匹配。语义判分由不知该次臂结果的人工审阅者按 rubric 评；不让生成问题的模型自评。
- **是否在合适时机问：**trace 要显示至少一个已登记的初步信息工具结果先于问题，问题先于职责敏感的报告/结论。不得只根据最终对话文本倒推顺序。
- **补答是否推进：**只在 `ask_user` 问及职责时提供标准补答；同一 `thread_id` / 案件 ID 恢复。结构化 state 和后续工具/Planner trace 必须保留球队、`MID`、年龄上限及能力偏好；不得由回答覆盖这些旧约束。最后检查报告是否按可用证据解释并披露职责数据缺口。
- **消融是否安全、造成什么差异：**`−ask_user` 臂没有答案时安全标为 `role_unresolved`；不得报成完成的角色适配名单。两臂分别报告完成报告 / 合法安全暂停，不把安全暂停算作 hallucination，也不把它并成模型成功完成；同时报告不必要/必要问题数、追问轮数、工具调用数和端到端耗时。
- **运行时是否正确：**另用确定性编译图验收：实际 checkpointer；中断结果可见；相同 `thread_id` 通过 `Command({ resume })` 恢复；补答进入预期 state 并约束后续调用；新 `thread_id` 不得读出旧案件状态；节点中断前的 trace/副作用不会因重跑而重复或不幂等。该组是 LangGraph runtime 契约，不和模型是否正确判断“该不该问”合并成一个分数。

主结果按场景与 arm 报行为表和原始失败，不造综合分，不拿工具调用变多当作思考质量；清楚控制与职责缺失对照是核心机制消融，不是 LangGraph 与其他框架的比较。

## 来源清单

- LangChain 官方：[LangGraph JS Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)、[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[Test](https://docs.langchain.com/oss/javascript/langgraph/test)。
- Tao et al.：[DiscoBench arXiv record](https://arxiv.org/abs/2606.27669)、[HTML full text v2](https://arxiv.org/html/2606.27669v2)。
- Zhao et al.：[AskBench ACL Anthology publication](https://aclanthology.org/2026.findings-acl.845/)。
- Pochampally：[DelegationBench arXiv record](https://arxiv.org/abs/2610.05532)、[HTML full text v1](https://arxiv.org/html/2610.05532v1)。
