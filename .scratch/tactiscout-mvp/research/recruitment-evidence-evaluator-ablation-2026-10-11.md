# 招募证据评估器：整图消融设计与结论边界

研究日期：2026-10-11。来源访问日期：2026-10-11。

## 结论

`RecruitmentEvidenceEvaluator` 是确定性证据构造器，不是球员排序器：它按来源 ID 加载已发现候选、对照可比样本、投影来源实际提供的指标、按规则决定是否显示同组百分位，并描述样本和数据限制。它的机制价值应以**证据处理是否遵守这些可核验规则，以及这些证据是否改变完整 LangGraph 调查的可观察行为**来验证。

建议采用两层验证：

1. **规则符合性验证**：用固定数据快照和已知字段的对抗性夹具，逐项核对评估器输出。此处评估器、预期输入和结果均可确定，不需要 LLM，也不需要球探排序标签。
2. **整图配对消融**：同一 `createRecruitmentConversation` / Harness、同模型与配置、需求与补答、工具和数据快照、Reviewer 及预算，比较正常评估器与显式“无能力证据”适配器。一次只切换评估器；按场景逐对记录候选评估、能力证据覆盖、工具轨迹、报告引用和安全检查。由此可以观察评估器证据在完整链路中的贡献，但仍不能评价候选是否真适合球队。

无真实足球评审标签时，**推荐质量应继续为 `not_evaluable`**。候选被处理、证据覆盖增加、引用有效、Harness 检查通过或报告文字变动，都不是排序正确率、球探共识、未来表现或转会成功率。

## 项目现状

- [issue 146](../issues/146-deepen-recruitment-evidence-evaluator.md) 已把来源记录加载、精确来源身份去重、同位置/赛事/赛季比较组、能力证据投影、百分位与证据说明从 LangGraph 对话模块中提取到单一 evaluator 接口。LangGraph 仍负责 Planner 决策、工具预算、状态、追问/恢复和 Reviewer。
- 当前 evaluator 会先把请求 ID 与本轮已发现且合格的 ID 求交，再用 `PlayerRepository` 读取来源记录；比较样本限定为同来源、赛事、赛季、位置；缺失指标不生成数值；百分位遵循本项目 900 分钟门槛以及至少 5 个符合门槛的同组样本。[实现](../../../src/agent/recruitment-evidence-evaluator.ts) · [比较规则](../../../src/domain/evidence-comparison.ts)
- 已有 Reviewer 消融研究只隔离报告证据复核门，证明“报告复核”与“能力证据构造”不是同一机制。[issue 132](../issues/132-controlled-evidence-review-ablation.md)
- [issue 119](../issues/119-human-labeled-shortlist-benchmark.md) 与评测指南表明，项目还没有真人候选适配判断；空数据集返回 `not_evaluable`。Evaluator 消融不能绕过这条边界。[评测指南](../../../docs/evaluation.md#球员短名单质量评测)

## 一手资料给出的实验原则

| 一手来源 | 对本实验的设计含义 |
|---|---|
| LangGraph 官方测试指南支持为每次测试创建新图与 checkpointer、运行编译图，也提供单节点和部分执行测试；它明确指出单节点调用会绕过 checkpointer。[LangGraph Test](https://docs.langchain.com/oss/javascript/langgraph/test) | **项目推论：**评估器规则可独立验证，但“证据如何影响调查状态、Planner 和最终报告”必须另跑编译后的完整图；两种证据不能互相替代。 |
| LangSmith 官方评估文档区分有参考答案的离线数据集评估与没有参考答案的线上 trace 评估；它将 human、code、LLM-as-judge 列为不同评估方法，并建议对关键组件定义可检查的质量标准。[Evaluation](https://docs.langchain.com/langsmith/evaluation) · [Evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts) | **项目推论：**评估器中可形式化的规则用代码和固定预期值核验；语义性球探适配属于需要真人标签的独立问题。不能把无参考答案的 trace 统计混称为答案正确性。 |
| `τ-bench` 在带政策和 API 的多轮用户/工具环境中，以标注终态比较任务目标，并用 `pass^k` 关注重复运行的一致性。[原论文](https://arxiv.org/abs/2406.12045) | **项目推论：**要检验完整对话，应核对状态/轨迹和明确的案件终态；重复次数应逐场景公开。其零售/航空任务与足球招募不同，不能直接借用其成绩或宣称本项目的可靠性。 |
| `ToolSandbox` 将状态化工具执行、工具间状态依赖、按策略行动、信息不足以及中间/最终里程碑纳入多轮评估。[原论文](https://arxiv.org/abs/2408.04682) | **项目推论：**证据消融应区分评估前的候选发现、评估器实际给出的数据、评估后的 Planner/工具动作与报告；不能只比较终端文本或工具调用总数。此基准不定义足球评估指标。 |
| `FActScore` 将长文本拆成原子事实，并以可靠来源检查事实支持度；该方法评估的是事实支持，不是事实对用户目标的适配价值。[EMNLP 原论文](https://aclanthology.org/2023.emnlp-main.741/) | **项目推论：**“主张能否追溯到来源统计”与“该球员是否适合拜仁/巴萨”必须分开。前者能做来源支持审计，后者需要独立的场景化足球判断标签。 |

以上是设计参照，不是对任何组件收益的证明。下文的候选场景、适配器边界和指标是基于 TactiScout 代码的实验建议。

## 两层验证协议

### A. 固定快照下的确定性规则核验

先为 evaluator 的当前接口建立可复现的输入/预期表；每个案例保留来源、赛季、球员来源 ID、字段缺失状态和样本分钟。至少包括：

1. 请求中混入未发现 ID 和重复 ID：未发现球员不得进入评估；重复来源记录按精确身份规则去重，不能按姓名猜测合并。
2. 同名或 ID 数字相似、但 provider/namespace/外部 ID 不同的记录：身份保持分开。
3. 插入位置、赛事、赛季不同的干扰球员：不得进入候选的 peer cohort。
4. `null`/缺字段与真实 `0`：缺字段不输出证据，不得补成零；真实零仍是观察值。
5. 候选样本小于 900 分钟、样本未知、有效同组人数少于 5，以及刚好达到两个边界：分别验证保留直接指标但正确隐藏百分位，或按实现显示比较结果。
6. 每个 Supplementary metric 的来源字段、定义、单位、样本和 provider provenance：描述文本必须与结构化证据一致。

这些预期来自数据模式与项目规则，不是球探的主观好坏判断。错误应分成输入解析/来源仓库错误与 evaluator 计算或描述错误；provider 失败仍按现有工具失败策略处理。

### B. 完整 LangGraph 配对消融

**处理变量只有一个：能力证据 evaluator 是否向图提供其派生的结构化能力证据。**

- **Full arm**：使用当前生产 evaluator。
- **Ablation arm**：使用仅供评测的透明弃权适配器；它保留图的 typed action/result 形状，但不提供指标值、百分位或伪造的零分，并明确 trace 标记为证据 evaluator 已关闭。候选发现、通用候选记录、方法 RAG、球员报告工具、Planner、用户补答、策略门、Reviewer 和报告模型仍是同一份实现。
- 两臂都运行同一编译后的 LangGraph；不可把完整图与独立脚本、另一种 Agent 框架或少一段用户交互的流程对比。LangGraph 官方测试资料支持图级验证，已有公开接口与现有 Harness CLI 见 [issue 146](../issues/146-deepen-recruitment-evidence-evaluator.md) 及 [issue 132](../issues/132-controlled-evidence-review-ablation.md)。
- 在任何运行前冻结：登记的男性足球 query 与回答脚本、数据快照及内容哈希、知识库快照、应用/代码 commit、模型名称和 manifest/量化、系统提示和 rubric 版本、temperature/top-p/max tokens/可用 seed、超时、各工具和 Reviewer 重试预算、并发环境。每对共享仓库与知识快照但使用独立 checkpoint/thread；Full/Ablation 运行顺序交错或平衡。
- 先做一个固定 Planner/action replay 的整图对照，确保两臂到达同一评估请求并隔离直接的证据对象差异；再用现有实时 Planner 做配对 Harness 运行，观察模型消费证据后的后续动作。后者的动作/报告差异是 evaluator 对图行为的**路径效应**，不是另一层直接的球员排序测量。若当前注入点或 CLI 无法在图构造时只替换 evaluator，应先新增评测专用依赖注入 seam，再执行实验；不要通过改 prompt、禁用 Reviewer 或换候选工具来代替消融。
- 建议先选 3 类互补场景：证据充足且同组样本足够；用户要求至少一个数据源缺失的能力；低样本/同组不足、并含位置或赛季干扰记录。每场景可先做 3 对探索性运行、交错顺序，并逐对列出结果。3 对是项目的初步机制检查规模，不是统计功效或可靠性阈值；重复运行不能增加独立 query 数。
- 评估器是确定性的，固定快照下相同输入应给出同一 evaluator 结果。即便 temperature=0，Planner/报告模型以及本机运行时仍可能造成整图轨迹差异；没有受控 seed 时不得把配对称为逐 token 匹配。若只变化下游文本/工具路径，逐场景展示路径即可，避免总体显著性或因果效应量说法。

若弃权臂触发更多 Planner 搜索或 Reviewer 退回，这应作为 evaluator 不可用后整张 Agent 图如何反应的观察结果；但需将其与 evaluator 的直接计算正确性分开展示。Reviewer 在两臂中保持开启，避免同时移除复核门；记录它对弃权所作的退回、保留或压制，以揭示可能的补偿/掩盖机制。

## 预先定义的观测量

数值只汇总这些可核验量；显示每个场景的分子/分母和原始重复，不将候选卡、候选批次或一次对话中的工具步骤当成独立用户 query。

| 维度 | 观测量 | 可支持的解释 | 不能支持的解释 |
|---|---|---|---|
| 候选处理 | 已请求且有资格的不同 candidate ID 数；返回 evaluation 数；未发现/不合格 ID 被评估的数量；重复 source record 去重数；错误或未完成批次 | evaluator 是否处理了目标集合、是否遵守 discovered/eligible 边界 | 市场召回率、候选是否优秀、不同姓名记录是否为完整的自然人身份全集 |
| 比较样本 | 每个候选/指标实际 peer 数及有效分钟；异位置/赛事/赛季流入数量；低样本或样本未知时百分位被错误显示次数 | cohort 键与样本门槛是否按项目规则工作 | 百分位代表跨联赛实力或被观察记录代表完整同位置人群 |
| 指标与缺口 | 能力需求→允许 metric key 的覆盖数/需求数；证据存在/缺失/unknown 分项；missing-as-zero 违例；值、单位、definition、sample 和 source provenance 校验失败数 | 数据仓库可观测证据覆盖与 evaluator 映射是否忠实 | 未覆盖代表球员能力差；覆盖率高代表能力适配好 |
| 工具轨迹 | 首个 eval action 前后的有序工具/策略动作、Planner 请求数、球员报告读取数/状态、追问/恢复/回退和预算耗尽；按时间点对照两臂差异 | evaluator 可用与否是否改变了这些冻结案件的调查路径/证据获取行为 | 工具调用多/少本身等于更好；轨迹符合模型隐藏推理；一般 Agent 能力 |
| 报告与证据 | 评测器结构化证据的来源/球员/指标/赛季引用有效数；报告引用指向真实评估记录的比例；用户明确能力项的已覆盖/缺失状态；Reviewer 修复、退回、撤回或未改变的次数 | 报告能否追溯到本次运行的已观察证据；Reviewer 是否补偿弃权 | 自由文本理由语义上完全正确；所引统计充分证明足球适配 |
| 安全/边界 | 未发现 ID、不可用指标、错误 cohort、低样本百分位、虚构来源字段/样本、无证据的当前效力/合同/身价/伤病/转会可行性、姓名归并/越过男足范围的逐类违规计数 | 是否触碰已声明的数据和产品边界；Full 与 Ablation 是否以安全弃权 | 保障了所有潜在风险或形成法律合规认证 |
| 运行成本 | 实际模型 invoke/usage token、工具调用和 wall time 分开按臂报告，标缺失字段；列出预算上限与超时 | 冻结环境里的观测开销 | 普适延迟结论或成本公平比较。由于上下文和步骤可随证据变化，两个臂可能不是 token-matched |

直接 evaluator 正确性至少应该由以上 A 的明确预期结果验证；整图 Harness 检查应把“合法证据可被读取/引用”和“缺失信息不伪造”分开。若要报告自由文本 claim 支持率，须先由独立评审按原子主张逐条判定来源支持；不能让被评估的模型自行充当 gold label。即便 claim-support 得分可靠，它仍不是 shortlist nDCG。

## 混杂与对抗性检查

- **模型随机性/次序效应**：同一 query 的两次 Planner 可能本来就选不同动作。固定可配置采样参数、平衡 A/B 顺序、留存全部配对 trace；报告逐案结果和失败类别，而非只有平均分。必要时用固定 Planner replay 隔离评估器直接输出。
- **Evaluator 与 Reviewer 的交互**：Reviewer 可能通过压制或重查弥补缺少证据，也可能因 Full arm 给出更多证据而改变审核对象。Reviewer 固定开启并记录其动作；其行为差异属于整图传导结果，不可单独归因成 evaluator 的纯计算效果。
- **数据漂移/数据 snapshot 代表性**：live provider 在实验两臂之间变化会同时改变证据；固定仓库快照、provider 版本、知识库和 hash。固定快照又不能代表当前足球市场或其他赛事。
- **场景选择/重复伪样本**：有证据的 query 可能偏向 evaluator 容易通过的例子。至少覆盖证据充足、缺字段、低样本/混杂 peer 三类，并按场景报告；同一 query 的重复不是更多独立招募需求。
- **处理泄漏**：若 ablation prompt、工具、Planner 预算、Reviewer、报告 schema 或候选发现也被改，差异不能归因给 evaluator。弃权 adapter 应只改变能力 evidence 输出，并明确其关闭状态；不以零值模拟缺失。
- **自动 Harness/文本检查的边界**：文本关键词或结构检查只能检验被定义的契约；它可能漏掉同义表达或误判边界措辞。通用 pass rate 不能证明报告所有主张均被来源语义支持。
- **排行榜/质量标签的混用**：用 `evidence coverage` 或 `nDCG` 之外的机制结果推断适配质量，或把公开表现指标当作球探 preference label，属于构念替换。现有人评基准为空，不能生成“准确率”。

## 结论措辞模板

如果实验结果显示 Full arm 确实生成了符合规则的能力证据，而弃权臂报告相应缺口，可写：

> 在固定的 X 个男子足球数据快照与 Y 个登记需求中，开启确定性证据 evaluator 后，图对已发现候选生成了可追溯的指标、样本和同组比较信息；关闭后，同一图按弃权路径暴露相应证据缺口。该配对实验验证的是 evaluator 的数据处理与证据传递机制，不评价候选排序质量。

只有观察到了实验支持的事实再填 `X/Y`；公开时同时给场景数、每场重复数、快照范围、覆盖定义、Harness 结果和失败数。不要写“推荐准确率提高”“更懂足球”“找到更好球员”“适合当前转会市场”或“证明 LangGraph 更优”。短名单质量仍需冻结相同候选池，由至少两位独立评审盲评并匿名裁决，再由项目的逐 query nDCG 协议评估；在标签收集前为 `not_evaluable`。

## 一手与项目来源

- [LangGraph JS Test 官方文档](https://docs.langchain.com/oss/javascript/langgraph/test)：compiled graph、单节点与部分执行验证方式。
- [LangGraph JS Thinking in LangGraph 官方文档](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)：按状态、节点、决策和转换建模工作的指导。
- [LangSmith Evaluation 官方文档](https://docs.langchain.com/langsmith/evaluation)：离线/线上评估与人评、代码、模型评审、pairwise 的工具分类。
- [LangSmith Evaluation concepts 官方文档](https://docs.langchain.com/langsmith/evaluation-concepts)：离线 reference datasets、run traces、代码 evaluator 与多次 experiment 的定义。
- Yao et al., 2024. [τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045)：多轮 Agent/User/Tool、终态目标检查及多次运行一致性指标。
- Lu et al., 2024/2025. [ToolSandbox: A Stateful, Conversational, Interactive Evaluation Benchmark for LLM Tool Use Capabilities](https://arxiv.org/abs/2408.04682)：状态化工具、隐式状态依赖、对话式评估及中间/最终里程碑。
- Min et al., 2023. [FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation](https://aclanthology.org/2023.emnlp-main.741/)：原子主张与可靠来源支持检查，非球探适配排序评测。
- 项目内：[issue 146](../issues/146-deepen-recruitment-evidence-evaluator.md)、[issue 119](../issues/119-human-labeled-shortlist-benchmark.md)、[issue 132](../issues/132-controlled-evidence-review-ablation.md)、[Harness 消融协议](agent-harness-ablation-design-2026-10.md)、[评测指南](../../../docs/evaluation.md)、[领域术语](../../../CONTEXT.md)。
