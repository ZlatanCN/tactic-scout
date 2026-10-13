# TactiScout Agent Harness 消融实验设计

研究日期：2026-10-10。范围：本地 LLM + LangGraph 的 Planner/工具编排、`ask_user` 中断续跑和 Reviewer 证据门；目标是判断组件对可观察 Harness 行为的贡献。**本报告不把流程通过率解释为球员排序质量。**

## 结论

最小可解释实验应使用同一模型、同一数据快照、同一查询脚本和同一工具预算，只改变一个 Harness 组件；至少比较完整系统与 Planner、澄清回合、Reviewer 的三个单组件消融。过程行为、证据支持质量、候选名单质量是不同结果，须分别计分。该设计是对现有 Agent 评测论文和 TactiScout 当前接口的项目化推断，不是文献证明这些组件必然提升表现。

## 一手来源支持的设计原则

| 来源结论 | 对实验设计的约束 |
|---|---|
| ReAct 将语言推理与环境动作交错，并对 reasoning-only、acting-only 等基线做比较；论文把该对照用于其具体问答和交互任务。[ReAct, ICLR 2023](https://arxiv.org/abs/2210.03629) | **项目推断：**将 Planner 自主决定下一工具/动作，与预先固定的工具顺序做对照，可以回答“动态计划是否带来额外价值”。固定计划必须仍使用同一工具和数据，否则会同时改变证据可用性。ReAct 的结果不能直接预言 TactiScout 的结果。 |
| τ-bench 把用户、工具/API、政策和多轮任务放在同一交互环境里，用终态数据库与标注目标比较，并提出 `pass^k` 衡量同一任务多次运行都成功的可靠性；实验至少每任务运行 3 次，agent 温度设为 0、模拟用户温度为 1。[τ-bench 原文](https://arxiv.org/abs/2406.12045) | **项目推断：**对澄清与续跑，应有任务级断言和重复运行；只检查最终回答文本不足以验证“确实问了必要问题、使用了用户回答、恢复到同一案”。论文中的 3 次是其协议示例，不构成普遍充分样本数。 |
| LangGraph `interrupt()` 需要 checkpointer 与 `thread_id`；用同一 thread ID 和 `Command({ resume })` 恢复。恢复时会从触发 interrupt 的节点开头重新执行，因此 interrupt 前的副作用可能重放。[LangGraph Interrupts 文档](https://docs.langchain.com/oss/javascript/langgraph/interrupts) | **项目推断：**澄清评测必须核对同案状态与确认条件是否保留、是否重复调用工具/副作用，以及新 thread 是否错误地丢失上下文。需要分清“模型何时提问”的策略质量和“LangGraph 是否正确恢复”的运行时正确性。 |
| LangGraph 官方测试文档支持编译完整图后运行，也支持直接测试单节点；直接调用节点会绕过 checkpoint。[LangGraph Test 文档](https://docs.langchain.com/oss/javascript/langgraph/test) | **项目推断：**确定性的状态路由、Reviewer 条件边和 interrupt/checkpoint 契约可用固定模型响应/工具夹具做低成本回归；单节点测试不能替代对 checkpoint 恢复的链路检查。线上模型重复运行应留给随机性与整体行为评估。 |
| ARES 将 RAG 的 context relevance、answer faithfulness、answer relevance 分开评估；FActScore 将生成拆成原子事实，再统计有可靠来源支持的事实比例。[ARES, NAACL 2024](https://aclanthology.org/2024.naacl-long.20/) · [FActScore, EMNLP 2023](https://aclanthology.org/2023.emnlp-main.741/) | **项目推断：**Reviewer 消融应统计事实/推荐主张与证据字段的支持关系及证据缺口，不应只比较报告流畅度；检索到资料、引用支持事实和名单符合需求是不同问题。 |
| AgentBench 把 agent 放入多轮交互环境评测；τ-bench 也按任务目标检查交互终态，而不只匹配最后一条回复。[AgentBench](https://arxiv.org/abs/2308.03688) · [τ-bench](https://arxiv.org/abs/2406.12045) | **项目推断：**Harness 结果应由状态/轨迹断言验证，例如工具与参数、澄清及恢复、预算、终态报告、证据门结果；可读性或最终字符串相似度不能代替这些检查。 |

## 变量控制

以下为**项目实验建议**。每条 case 在所有实验臂中复用同一份输入脚本、回答脚本、数据内容与数据版本；用逐 case 配对结果比较版本。记录 Git commit、模型名/权重或 Ollama manifest、量化方式、提示词/图版本、采样参数与可用 seed、工具输入/输出 fixture 或数据快照 hash、各工具调用预算/超时/分页策略、运行日期及机器并发负载。若某臂改变候选池、统计指标、prompt 中的球探要求或模型，不应再把差异归因给消融的 Harness 组件。

模型可用时固定 temperature、top-p、重复惩罚、最大输出长度与随机种子；温度为零也不代表不同运行环境绝对确定。每轮工具预算应相同并记录实际调用数；若完整图因 Reviewer 重试多调用一次，需同时报告结果与额外调用成本，不可悄悄给它更多上限。将检索/统计结果缓存为同一 fixture 可控制数据漂移；另跑真实工具链时，应单独报告外部数据与时延变化。

## 三组结果，分别报告

### 1. 端到端 Harness 行为

对每个场景检查：是否选择允许的工具及参数；是否遵守调用/重试预算；必要时是否询问关键缺项；收到回答后是否在同一 `thread_id` 恢复、保留确认槽位并进入后续检索；是否正确终止并输出报告；Reviewer 是通过、要求补查，还是证据不足后收窄/撤回建议。按 case 报通过/失败及失败类别，并保留 trace。当前仓库的 Harness 评测本就基于 trace 工具和决策事件、汇总每场景通过率与延迟；注册案例包含巴萨已明确需求及拜仁凯恩替代者的澄清续跑。[Harness 场景与断言](../../../src/evals/harness-evaluation.ts#L55) · [本地评测 CLI 的 `--runs 1–10`](../../../src/evals/local-model-agent.ts#L20)

### 2. 证据与报告质量

从最终报告逐条抽取可核实主张，关联到候选球员、指标/来源字段、赛季、样本上下文；报告支持率、字段/身份/赛季引用正确率、未支持主张数、缺数披露率，以及 Reviewer 对错误的检出率和误拦率。Reviewer 可能通过重查减少未支持主张，也可能拒绝本来有证据的推荐；因此同时记“证据精确性”和“覆盖/误拦”，不要只报告拒绝是否成功。原子事实和分项维度是参照评测方法；针对球探主张怎么拆、怎样匹配字段仍属于项目 rubric。[FActScore](https://aclanthology.org/2023.emnlp-main.741/) · [ARES](https://aclanthology.org/2024.naacl-long.20/)

### 3. 短名单质量

只有在相同冻结候选池上、至少两位评审独立盲评并完成匿名裁决后，才比较按 query 计算的 `nDCG@5`（用于分级相关度排序的折损累计增益指标）；同时报告未知/缺失和评审分歧。[Järvelin & Kekäläinen, ACM TOIS 2002](https://doi.org/10.1145/582415.582418) 现有 issue 124 明确记载：盲评流程与评测输入已实现，但尚无真实球员判断，且一条 query 不能证明一般推荐质量。[Issue 124：真人短名单评测闭环](../issues/124-close-the-human-shortlist-evaluation-loop.md) 因此现阶段实验可先证明 Harness 如何影响工具、追问、证据门与报告；没有真实标签时，短名单质量列为“不可评”，不得用模型自评或通过率补成排名正确率。

## 最小消融矩阵

**建议先固定 4 个实验臂，保持同模型、同 case、同数据、同工具响应、同其余组件：**

| 实验臂 | 唯一改动 | 主要诊断问题 |
|---|---|---|
| 完整 Harness | Planner、澄清中断/续跑、Reviewer 全开 | 基准行为与成本。 |
| `−Planner` 固定计划 | 取消 LLM 对下一动作/工具的选择；按预先写好的顺序调用同一工具，仍保留相同输入证据与预算 | 自主编排是否改善工具顺序、避免无效重复、适应不同 case？ |
| `−ask/resume` 单轮输入对照 | 不发起用户追问/中断；将该 case 的标注答案作为已知约束预填入首轮状态，其他部分保持不变 | 这是“已有完整约束时省去交互回合”的参考上界，不能用来评判提问好坏；提问质量须另按应问槽位、问题主题和答案后的状态断言评。 |
| `−Reviewer` 旁路证据门 | 不执行 Reviewer 的重查/抑制分支；固定同一数据快照、工具实现与总调用预算 | Reviewer 是否降低未支持主张；是否因此增加误拒或少报候选？若 Reviewer 触发补查，则允许完整臂实际多用一次调用，但记录成本与新证据。 |

每个消融只关一个组件。`−ask/resume` 的答案预填会改变交互信息到达时间，所以它不是严格的“移除 interrupt 但一切别的都相同”；应把它解释为交互回合价值对照，并单独做 LangGraph resume 契约检查。否则会把“用户输入少了”误归因于状态机。

**最简分层场景建议（项目推断）：**从仓库已有的拜仁凯恩替代者澄清续跑、巴萨明确年龄/位置/能力需求开始；再加一个模型/工具证据不足场景和一个筛选无结果/需经同意扩大位置的场景。为每个场景预定义必需工具、必需/禁止问题、回答后的确认约束、候选检索范围、证据门预期和最终状态。四臂 × 4 类场景 × 3 次重复 = 48 次完整运行，可作为较小的早期筛查方案；这不是统计把握度证明。如本地运行开销高，先用确定性夹具验证状态与接口，再只对最能触发组件的 2–3 个场景做真实模型运行，并标注样本边界。

## 样本数、随机性与可解释边界

不存在脱离目标差异、波动和显著性/把握度要求的通用“够用样本数”；NIST 的样本数设计明确依赖目标检出差异、显著性水平与统计功效。[NIST：样本量设计](https://www.itl.nist.gov/div898/handbook/prc/section2/prc242.htm) τ-bench 至少每任务跑 3 次是一个已发表的交互 Agent 实验先例，但不能从中推出 TactiScout 的 3 次足以证明可靠性。[τ-bench](https://arxiv.org/abs/2406.12045)

本地最小方案可对完整臂与三个消融臂按相同 case 配对重复 3 次，作为**探索性稳定性检查**：报告每臂 `n/N`、case 级通过情况、候选集合/顺序变化和延迟分位数。已有 CLI 支持每场景 `--runs 1–10`，可对代表场景扩至 10 次观察变异；小样本仍只够暴露明显抖动，不能支持广泛可靠性声明。[评测 CLI](../../../src/evals/local-model-agent.ts#L20) 多次运行同一 query 是该 query 内的重复，不是新增独立 query。若准备声称两个版本的通过率有差异，应先确定有意义的最小差异和功效，再扩展场景；用与评测指标/配对结构相符的统计检验或区间，报告每个 case，而非只看汇总均值。[Dror et al., ACL 2018](https://aclanthology.org/P18-1128/) 对通过率这类小样本比例，NIST 提醒失败数或总样本数很小时，正态近似置信区间可能不准确，应采用精确二项区间并显示分子/分母。[NIST：精确二项区间](https://itl.nist.gov/div898/software/dataplot/refman2/auxillar/exacbino.htm)

## 执行顺序

1. 先用确定性 fake Planner/固定工具 fixture 对每个单组件开关跑状态转移断言；LangGraph 的单节点测试可以隔离纯逻辑，但 interrupt 的同案恢复必须运行带 checkpointer 的编译图。[LangGraph Test](https://docs.langchain.com/oss/javascript/langgraph/test) · [LangGraph Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
2. 冻结 4 类代表 query 与对应回答，跑四臂各 3 次；保存 trace、状态变化、报告、配置及失败类别。
3. 对 reviewer 全开/旁路臂做人工 claim 支持抽查；在盲评标注足量前，把名单质量保持为不可评。
4. 只在发现稳定失败模式后增加场景或重复数，并保持每次只改变一个开关。不要把一个本地模型、少数 case 的成功直接泛化到“LangGraph 比固定流程更准”；结果只支持本模型、当前工具/数据快照和这些场景下的观察。

## 2026-10-10 补充：规划诊断与 LangGraph 交互边界

APB v3 将规划能力拆为 holistic planning、反馈条件下的 step-wise planning，以及工具缺失/噪声等鲁棒性场景；论文指出只报告 end-to-end success 难区分规划失败与执行失败，并把规划诊断视作 execution benchmark 的上游补充。[APB v3](https://arxiv.org/abs/2606.04874) 因此 TactiScout 的展示应分别呈现控制流、工具结果、证据约束与终态，不把 29/29 行为检查扩写成“推荐准确”。此文献跨域结果不直接预测本项目效果。

LangGraph 官方 JS 指南把可恢复工具错误、需要用户补充的信息和不可预期错误分作不同控制路径，并说明 checkpoint 与 `thread_id` 承载 interrupt/resume 状态。[Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph) 对 TactiScout 而言，用户追问与复核回退应在观测和消融中作为不同机制记录，避免把所有重试归入一个总成功率。

## 来源与访问日期

所有网页来源访问日期：2026-10-10。

- [ReAct: Synergizing Reasoning and Acting in Language Models, ICLR 2023](https://arxiv.org/abs/2210.03629)
- [τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045)
- [LangGraph JS Interrupts 官方文档](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LangGraph JS Testing 官方文档](https://docs.langchain.com/oss/javascript/langgraph/test)
- [ARES, NAACL 2024](https://aclanthology.org/2024.naacl-long.20/)
- [FActScore, EMNLP 2023](https://aclanthology.org/2023.emnlp-main.741/)
- [Järvelin & Kekäläinen, Cumulated gain-based evaluation of IR techniques, ACM TOIS 2002](https://doi.org/10.1145/582415.582418)
- [AgentBench: Evaluating LLMs as Agents](https://arxiv.org/abs/2308.03688)
- [Agent Planning Benchmark v3, 2026-10-05](https://arxiv.org/abs/2606.04874)
- [LangGraph JS: Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)
- [Dror et al., The Hitchhiker’s Guide to Testing Statistical Significance in NLP, ACL 2018](https://aclanthology.org/P18-1128/)
- [NIST/SEMATECH：样本量设计](https://www.itl.nist.gov/div898/handbook/prc/section2/prc242.htm)；[精确二项区间](https://itl.nist.gov/div898/software/dataplot/refman2/auxillar/exacbino.htm)
