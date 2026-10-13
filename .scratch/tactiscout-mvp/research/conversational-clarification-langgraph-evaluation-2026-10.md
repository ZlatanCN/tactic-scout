# 对话式球探 Agent：澄清、同案续跑与工具编排评估

研究日期：2026-10-10。目标是为 TactiScout 的自然语言招募调查设计一套可复核的评估方法，覆盖“判断何时追问 → LangGraph 中断 → 用户补答 → 同一案件恢复 → 使用工具 → 形成有证据边界的报告”。本研究只整理方法，不改应用代码，也没有调用外部推理或数据服务。

## 结论

把这条链路拆成三个不可互相替代的评估对象：

1. **澄清策略**：缺失项是否真的会改变下一步调查；是否在有必要时问到关键点，也能在无需澄清时直接调查。单测“问了问题”会奖励过度提问。
2. **LangGraph 运行时契约**：图是否在正确位置中断、把状态存入 checkpointer，并在同一 `thread_id` 收到补答后继续。它验证图运行正确，不证明提问有用。
3. **端到端调查行为**：补答是否进入案件状态、约束后续工具参数；工具结果是否受限于真实返回；报告是否遵守证据和数据限制。这不等于球员排序质量。

最强的早期证据应来自**冻结场景、隐藏答案卡、逐项状态/工具断言和单组件配对消融**。短名单没有独立球探判断时，只能报告调查行为与证据契约，不能宣称推荐准确、名单质量提高，或 LangGraph 优于其他框架。

## 一手来源与对 TactiScout 的启示

### LangGraph：中断恢复是运行时能力，不是提问策略评测

LangGraph 官方文档说明，`interrupt()` 会把图状态写入 checkpointer 并等待外部输入；恢复时必须复用中断时的 `thread_id`，通过 `Command({ resume })` 把答案交回中断节点。节点从开头重新执行，因此中断之前的代码也可能重跑。`MemorySaver` 的状态只在内存中，进程重启后丢失；持久恢复需使用持久化 checkpointer。[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) · [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)

因此应分别验证：

- 等待用户时返回了预期中断，而不是普通完成或错误；
- 案件 ID 到图 `thread_id` 的映射稳定；恢复使用同一个 `thread_id`；
- 恢复后的状态保留原需求、已确认槽位及此前工具证据，并把本次答案写入正确槽位；
- 下一个工具动作使用补答后的过滤条件，且实际发生在补答之后；
- 中断前节点可能重跑，不能把工具副作用“恰好执行一次”当作 LangGraph 保证；需把副作用放在中断之后或采用幂等设计，并检查重复调用；
- 若产品承诺进程重启后续聊，还要以持久 checkpointer 做一次重启恢复验收。仅用 `MemorySaver` 的测试不证明该承诺。

官方测试指南支持编译完整图后做状态/路径测试，也支持单独调用 node；但直接调用 node 会绕开 checkpointer。故单节点断言适合测纯逻辑，不能代替带真实 checkpointer 与 `thread_id` 的中断续跑链路。[LangGraph Test](https://docs.langchain.com/oss/javascript/langgraph/test)

### 澄清研究：要同时覆盖“该不该问”“问什么”“问后能否完成”

AskBench 把任务做成多轮：每条样例带有明确 rubric/checkpoints，模型提问后，模拟用户只补充它明确询问的信息；最后一轮要求作答。其指标分别报告最终答案正确率 `Acc.`、回答前已解决全部 checkpoint 的覆盖率 `Cov.`，以及 checkpoint 已解决后仍发出至少一个不必要问题的样例比例 `Unq.`。论文显示只提高提问倾向可能造成冗余；其结果也指出澄清覆盖和最终正确性不是同一件事。[AskBench 原文（Findings of ACL 2026）](https://aclanthology.org/2026.findings-acl.845/) · [PDF](https://aclanthology.org/2026.findings-acl.845.pdf)

AskBench 的局限也适用于本项目：它是从 QA 数据构造的离线基准，用户由 LLM 模拟，使用固定轮数和单一 judge；作者将真实用户数据、开放演化目标和 judge 偏差审计列为限制。因此 TactiScout 的早期本地评测优先用预写用户回答与可执行断言，语义问题再人工抽查；不要让被测模型兼任用户、裁判和答案键生成者。[AskBench limitations](https://aclanthology.org/2026.findings-acl.845.pdf)

开放域澄清研究的 ClariQ 工作同时包含“无需澄清”的清楚请求与有歧义请求，给问题对应的 facets，并要求用户回答与实际问题一致；其多轮阶段还通过真人对话评估交互。这支持加入明确需求控制组，并以用户意图/信息 facet 评问题目标，而不是要求模型复现某句标准问法。[Aliannejadi et al., EMNLP 2021](https://aclanthology.org/2021.emnlp-main.367/) · [论文 PDF](https://aclanthology.org/2021.emnlp-main.367.pdf)

τ-bench 将工具 API、领域规则、用户模拟和任务终态放在同一对话任务里；其成功判定结合工具环境终态与必要的用户答复，并用 `pass^k` 描述同一任务多个随机试次全部成功的比例。论文主实验每个任务至少跑三次，但任务设计阶段曾对低/零通过任务做超过 40 次试跑以排查歧义。**三次是论文实验设置，不是充分样本数的证明。**[τ-bench 原文](https://arxiv.org/abs/2406.12045) · [HTML 全文](https://arxiv.org/html/2406.12045v1)

## 建议的 TactiScout 场景协议

每个冻结的 case card 至少包含以下隐藏标注：

- 原始用户表达、真实招募意图和本案范围；
- 已知、未知、必需、可选的需求槽位；必需槽位缺失时，它具体会怎样改变下一步搜索/报告；
- **何时**有足够调查证据、应在何阶段追问，还是不应追问；
- 一个或多个可接受的问题目标（按语义 facet/槽位描述，不规定逐字措辞）；
- 预写用户回答：仅回答模型实际问到的信息，不能把隐藏答案偷偷注入上下文；对含糊或纠正性回答另列预期状态更新；
- 可复现的数据快照/工具 fixture、允许工具、调用预算、查询字段及预期结果状态（成功、零匹配、失败彼此区分）；
- 后续允许的动作、工具参数约束、完成/安全暂停条件，以及报告必须披露的数据限制。

最小场景集应同时有正反控制：

1. **需求足够清楚**：不问多余问题，直接走必要调查工具；
2. **关键职责未知**：先取得能帮助理解候选与数据边界的调查证据，再问一个会改变候选方向的问题；
3. **补答后续跑**：答案确认为 ST 等范围后，同一案件恢复；后续搜索必须用已确认位置，评估与报告不能绕过；
4. **无匹配与扩围许可**：精确搜索为零时询问是否扩大；拒绝即如实收束，只有同意后才使用更宽过滤条件；
5. **重复/无关追问控制**：已回答的槽位不得重问；可选偏好未影响当前决策时不做问卷式盘问。

这些 case 评的是规划与执行契约，不预设“某个球员必须上榜”。TactiScout 当前登记的两步澄清与位置扩围场景可从 [issue 14](../issues/14-agent-harness-evaluation-suite.md) 开始扩展。

## 必须分开的指标

| 层次 | 建议度量 | 说明与解释边界 |
|---|---|---|
| 何时问 | 必需澄清召回率；清楚需求的直接处理率；未解决必需项时过早完成率 | 按 case 统计。单独报告“至少问过一次”会鼓励模型逢事就问；清楚 case 是必要反例。IN3 的 `Ask` / `Dir.` 也分别看含糊任务提问与清楚任务直接响应。[AskBench PDF](https://aclanthology.org/2026.findings-acl.845.pdf) |
| 问什么 | 必需 checkpoint 覆盖；无关/未标注目标率；重复已解决槽位率 | 问句按意图/槽位映射，不按字面相似度打分。多个不同说法都可能正确。对主观语义标签用人工抽查或双人编码，并保留分歧。 |
| 何时问 | 阶段/动作顺序通过率；过早提问率；关键证据出现后才询问决策缺项的比例 | 在 case card 预先标注最早合理提问阶段。不能单凭“最终答案正确”推定提问时机合理。 |
| 是否结束 | 最终报告/安全暂停率；最终答案前 checkpoint 完成率；不必要追问 case 率 | 把无法完成、继续追问到步数耗尽、合法安全暂停区分开。可借鉴 AskBench `Acc/Cov/Unq`，但需为 TactiScout 明确分母并逐 case 展示；避免只在已成功结束样例上算覆盖率而隐藏无终态运行。 |
| 状态与续跑 | 正确中断、同 thread 恢复、答案槽位写入、旧约束保留、正确后续节点 | 这些是 LangGraph/runtime 硬断言，不使用 LLM judge，也不能以文本中提到“已记住”代替状态检查。 |
| 工具编排 | 工具名/参数/顺序正确率；未授权扩围次数；重复/越界调用；工具结果状态保真 | 记录是否调用、输入过滤器、结果 ID、成功/零命中/失败和调用预算。推荐对象必须来自实际评估结果，工具事实与报告引用可逐条对照。 |
| 成本与体验 | 澄清轮数、总用户回合、LLM/工具调用次数、整轮与按操作耗时 | 报告原始计数及分位数。几次运行的 p95 极易被单个慢请求支配，不可当服务 SLA。 |
| 候选质量 | 暂记 `not_evaluable`，直到冻结完整候选池并获得独立双人盲评与裁决 | Harness 通过、工具用对、证据引用合规都不能代替球探适配标签或 nDCG。遵循 [TactiScout 评测边界](../../../docs/evaluation.md)。 |

## 最小可解释消融

先做确定性 runtime 检查，再做配对的真实本地模型行为实验；固定模型及量化/服务配置、提示版本、图版本、case/回答脚本、数据快照哈希、工具 fixture、每回合工具预算和采样参数。不同臂使用独立案件 ID，但每一臂内部答案和数据相同。将下列变量分别隔离，不能同一次比较里同时改 Planner、问题策略和 Reviewer。

| 实验臂/对照 | 唯一变化 | 能回答什么 | 不能据此声称什么 |
|---|---|---|---|
| 完整自适应 Harness | Planner 按当前 state 决定调查、追问、续查或完成；通过 LangGraph interrupt/checkpointer 处理补答 | 基准链路在冻结 case 中怎样表现 | 不是框架比较，也不是推荐准确率 |
| `−ask_user` | 屏蔽用户澄清动作，其他工具与预算保持一致；缺信息时允许安全暂停/披露未知 | 必要澄清在本组 case 中对过滤正确性、提前收束/误猜的影响 | 不能要求它访问从未得到的隐藏用户答案；也不是 LangGraph 中断可靠性的测试 |
| Oracle 补答 | 将 case 的标准补答事实在初始状态提供，其余 Planner、工具、Reviewer 与预算不变 | 如果关键信息已知，下游搜索/证据/报告还能否正确工作；这是诊断上界 | 不证明交互提问有价值，信息到达时机不同，须标成 oracle 条件 |
| 固定流程基线（可选） | 用预登记的工具/问题顺序替换动态 Planner；保持同一工具和数据可用性 | 动态决策相较固定流程在多类 case 上是否减少无效动作或适应不同结果 | 若每个 case 的脚本都由人工针对答案精心写出，它是特定任务脚本/上界，不是公平的通用竞品，也不能证明 LangGraph 优越 |

**LangGraph 中断的机制验收单独做**：同一 case 先 invoke 到 `__interrupt__`，检查持久 checkpoint 与 `thread_id`；以 `Command({ resume })` 和相同 ID 恢复；断言补答进入 state、后续查询只在恢复后发生且使用确认过滤条件。用错误/新 `thread_id` 作为负向测试，预期它不会误读原案件 checkpoint。若声称进程重启可恢复，再用持久 checkpointer 做关闭/重开测试。该组验证运行时语义，不与 `−ask_user` 的策略效果混为一谈。

若想声称 **LangGraph 是最佳框架**，还需要在相同 Planner、提示、工具、状态、数据和故障条件下实现另一个运行时作为对照，比较中断恢复、失败恢复、状态丢失/重复副作用、开发复杂度和延迟。当前设计只能支撑“本项目使用 LangGraph 的明确原因及其能力得到验证”，不能推出相对其他框架的优越性。

## 小样本本地模型的解释边界

- **运行次数不等于独立 case 数。**同一自然语言场景重复十次，可观察采样/服务波动，不代表测试了十种球队、转会需求或用户。至少同时报每个 case 的 `pass/n`、失败类型和原始轨迹摘要；不要只给一个全局平均数。
- τ-bench 每任务至少三次是其论文实验设置，但该研究有多领域任务集，并在任务建设时多次验证歧义。TactiScout 的 3 次重复只能叫探索性复验或回归检查，不是可靠性证明。[τ-bench 原文](https://arxiv.org/html/2406.12045v1)
- 小 `n` 的二项通过率区间很宽；NIST 指出失败数或样本数小时，正态近似区间可能不准确，应考虑精确二项区间并保留成功数/总数。[NIST 精确二项区间](https://itl.nist.gov/div898/software/dataplot/refman2/auxillar/exacbino.htm)
- 相同模型和服务配置下的多次运行可能共享系统偏差；`temperature: 0` 不会把少数场景变成外部有效性证据。记录模型/权重、量化、服务版本、提示与图版本、采样设置、数据 hash、日期、硬件/并发条件，以及是否能够固定 seed。
- 成对消融应逐 case 对照，报告哪些 case 变好/变坏及差值；重复 run 嵌套在 case 中，不能把所有 run/action 当作独立样本。先用更多不同 case 扩大行为覆盖，再增加每 case 重复次数以观察方差。没有预设目标效应与功效分析，不报告“统计显著”。
- 语义评判若依赖单个 LLM-as-judge，存在裁判偏差与自我偏好风险；AskBench 本身也把单 judge 和 LLM 用户模拟列为限制。首要断言尽量使用结构化状态、工具 trace、case rubric 和人工抽查；模型裁判只作辅助诊断，并公开其模型和 rubric。
- 结论范围限于“指定 Qwen/Ollama 配置、指定图与提示版本、指定 fixture/数据快照、所列 cases 与日期”。不外推为普遍 agent 能力、真实市场覆盖或推荐有效性。

## 对当前项目的执行建议

1. 复用已有 [Harness 行为评估套件](../issues/14-agent-harness-evaluation-suite.md) 的工具/进度/`thread_id` 断言，先把新场景整理成有正反例、可回答的固定 case cards；避免先扩充大规模题库。
2. 用 fake Planner + 固定工具响应验证 LangGraph 中断/恢复状态机；完整图验收必须使用 checkpointer，node 测试只测纯逻辑。
3. 对 2–4 个最能触发不同路径的 case 做完整臂和 `−ask_user`；增加 clear-request 与 no-match 控制。若已有成本允许，再跑 oracle 补答定位下游缺陷。先报告每 case `pass/n` 和错误类型，不将样例总数伪装成候选质量数据。
4. 语义问题质量由 rubric 覆盖、无关提问和阶段时机检查；用户回答按脚本只透露被问到的内容。若人工评审结论较主观，保留两人分歧，不按模型自评定真值。
5. 将机制结果与球员质量分开呈现。真实短名单 nDCG 仍需冻结候选池、两份独立盲评和匿名裁决；当前若无这些数据，显示 `not_evaluable`。

## 参考来源

- LangChain 官方，[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)、[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[LangGraph Test](https://docs.langchain.com/oss/javascript/langgraph/test)。
- Zhao, Fang & Cheng, 2026，[When and What to Ask: AskBench and Rubric-Guided RLVR for LLM Clarification](https://aclanthology.org/2026.findings-acl.845/)；[论文 PDF](https://aclanthology.org/2026.findings-acl.845.pdf)。
- Aliannejadi et al., 2021，[Building and Evaluating Open-Domain Dialogue Corpora with Clarifying Questions](https://aclanthology.org/2021.emnlp-main.367/)；[论文 PDF](https://aclanthology.org/2021.emnlp-main.367.pdf)。
- Yao et al., 2024，[τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045)；[原文 HTML](https://arxiv.org/html/2406.12045v1)。
- NIST/SEMATECH，[Exact Binomial Confidence Limits](https://itl.nist.gov/div898/software/dataplot/refman2/auxillar/exacbino.htm)。
