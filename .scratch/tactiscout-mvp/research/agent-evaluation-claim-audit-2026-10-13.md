# TactiScout Agent 评测声明审计

审计日期：2026-10-13。范围：README、面试演示与评测文档、issues 14/153/174，以及匿名短名单人工评审 issues 119/120/123/124/141/168。本文增量核对已有的[Harness 消融设计](agent-harness-ablation-design-2026-10.md)、[招募证据评估器消融研究](recruitment-evidence-evaluator-ablation-2026-10-11.md)、[人工评分协议](human-shortlist-rating-adjudication-methods-2026-10.md)和[短名单评估协议](scouting-recommendation-evaluation-protocol-2026-10-06.md)，重点审计当前简历说法能被什么证据支撑。

## 结论

当前最强证据是**一个冻结历史案例上的整图机制消融**：它支持“证据评估器产出的来源指标会进入报告；屏蔽这些指标时，系统按约束弃权”。Harness 与消融测的是动作、状态、工具和证据契约；它们没有测候选是否适合拜仁/巴萨或排名是否更好。短名单质量仍为 `not_evaluable`：盲评设施和 20 张匿名卡已准备好，但 issue 168 尚无真实评分。

这一区分符合框架和研究实践：LangSmith 将最终答案/参考答案评估与 ReAct 工具调用轨迹检查分别举例；OpenAI 的评测指南也把功能正确性、工具选择及参数精度列作不同评测目标。AgentBench 将 Agent 放在多轮交互环境中测推理与决策，说明仅看最终文本会漏掉过程行为，但这些过程分数本身仍不是领域结果真值。[LangSmith 评测类型](https://docs.langchain.com/langsmith/evaluation-types) · [OpenAI 评测最佳实践](https://developers.openai.com/api/docs/guides/evaluation-best-practices) · [AgentBench，ICLR 2024](https://proceedings.iclr.cc/paper_files/paper/2024/hash/e9df36b21ff4ee211a8b71ee8b7e9f57-Abstract-Conference.html)

## 声明逐项核对

| 当前声明 | 仓库证据 | 审计判断 |
|---|---|---|
| `415/415` 确定性测试与 API/Web 构建通过 | `docs/evaluation.md` 记录 2026-10-12 完整回归；issue 169 同日记录 `415/415`。 | 支持当时工作树的确定性接口/状态契约和构建结果；不是模型可靠性、球探判断或实时数据质量证据。它与 Harness 的 `31/31` 是不同分母，不能相加。 |
| 一次本机 Understat/Qwen 整链 `31/31` | 评测文档与 demo 记有 3 次 Planner 请求、6 次工具调用、29 条进度事件及所读样本量；同时披露全体 20 条为低分钟样本，并注明来源处理权限未核实。 | 支持那次运行完成登记流程并满足预设行为检查。样本、模型、来源权限和一次运行的范围使其不适合作为“推荐有效”或市场覆盖声明。README 也将 Understat 定位为来源样本而非可授权的简历质量结果。 |
| 证据评估器三组配对消融 | issue 153 固定 Wyscout 2017/18 快照、Qwen 3.5 9B、同一图/Planner/Reviewer/工具/预算，只切换评估证据；按三对交错运行。开启臂 3/3 为 `31/31`，每次产出 3 条线索、6 条证据引用；屏蔽臂 3/3 满足显式无证据契约且不推荐，普通能力覆盖检查为 `29/31`；三对下游 Planner/工具轨迹相同。issue 174 逐项核对并把该结果写入中英文简历。 | **支持本案例的证据传递与弃权机制。** 29/31 应与无证据控制契约分开陈述；它不是控制臂通过了普通 Harness。三对和一个 query 是探索性重复，不支持显著性、普遍可靠性或候选质量结论。指标、Reviewer 与报告规则来自同一产品实现，因而也不是独立足球专家验证。 |
| README 中 Planner、追问、Reviewer、RAG、历史旁注等其他消融 | README 链接到 `docs/evaluation.md` 中逐项协议/结果；文档披露条件差异与限制。例如追问对照同时改变答案可用性；Reviewer 只在一个测试场景修复引用，另一场景无影响；方法 RAG 验证引用进入报告但未改变候选决策。 | 可作为机制观察与成本/轨迹描述，必须逐场景说明干预变量，不能合并成“LangGraph 使推荐更准”或“组件普遍有效”。动态 Planner 的更多 token 只说明额外开销，不是质量收益。 |
| 项目已有 nDCG/人工排名评测能力 | issue 119/120/123/124 完成的是评测器、盲评包和本地录入/裁决流程；issue 141 准备了一组 20 卡历史进攻地面对抗包，其中系统仅实际排出 3 名。issue 168 为 `open / ready-for-human`，明确没有评分、裁决或 nDCG。 | **工具链已建成，评测结果未产生。** “支持计算 nDCG”可以说；“nDCG 显示推荐质量”现在不能说。20 张卡属于一个历史职责/query，不是 20 个独立招募任务。即使此包日后可评，也只回答这一固定样本问题。 |
| 0–3 适配分、评审一致率或置信度已校准 | ADR 0008 与评测文档明说锚点是项目约定、尚未校准；`2^grade−1` 的 nDCG gain 假设等级效用指数递增；当前只报告描述性一致率，不称可靠性系数。项目没有概率置信度校准结果。 | 只能称作**试用中的 query-specific 评分量表**。nDCG 是在预设 gain/位置折损下的排序指标，不是置信度校准或真实球探分值。概率校准要求比较预测分布与实际结果，并用合适评分规则；TactiScout 当前没有这样的预测/结果配对。[Gneiting & Raftery, 2007](https://doi.org/10.1198/016214506000001437) |

## 样本与测量边界

- 三次配对适合检查“这个冻结案例中机制是否按设计起作用”，但没有预先定义最小有意义效果、功效或精度目标；不宜做显著性或总体成功率声明。不存在适用于任何问题的通用样本数，样本设计应先对齐推断目标、效果大小与精度。[Lakens, *Sample Size Justification*, 2022](https://doi.org/10.1525/collabra.33267)
- 双人盲评和裁决是正确的起点，但 0–3 仍是主观、有序且未经校准的量尺；原始一致率不是量表可靠性。保持原始分歧、单列 `unknown` 是优点，不应将 unknown 变 0。TREC 的 qrels 也绑定特定 query、语料和判断集合；nDCG 应解释为固定池内的排序结果，而非完整转会市场真值。[TREC relevance judgments](https://trec.nist.gov/data/reljudge_eng.html) · [Hayes & Krippendorff, 2007](https://doi.org/10.1080/19312450709336664) · [Järvelin & Kekäläinen, 2002](https://doi.org/10.1145/582415.582418)
- 盲评软件不能验证评审者真实独立、足球资历或是否在流程外看过答案键；issue 124 与 issue 168 已明确这项限制。结果应写为“足球知识评审者对这组历史来源证据的 query-specific 判断”，不写成客观职业球探标准答案。

## 可用于简历的最强表述

> 在冻结的 Wyscout 2017/18 巴萨 U23 进攻地面对抗案例中，我对同一 LangGraph 调查图做了三组证据评估器开关对照：启用组每次通过 31/31 项预设行为检查，并输出 3 条带 6 条来源证据引用的考察线索；屏蔽组每次按无证据契约弃权（普通能力覆盖检查 29/31），三对下游 Planner/工具轨迹一致。该实验验证证据进入报告的机制，不代表候选排序质量；人工球探评分尚未收集。

这与 README 和 `docs/demo-walkthrough.md` 的现有简历说法一致，且是当前最引人注目、又能被 issue 153/174 逐项复核的量化结果。

## 避免的说法

- “推荐准确率/质量提升”“找到了更好的凯恩替代者”“符合职业球探判断”。
- “LangGraph 比固定工作流或其他框架更准/更可靠”；当前消融没有框架对照。
- “模型或 0–3 适配分的置信度已经校准”“评审一致率证明评分可靠”。
- 把三对运行或每轮 31 个检查当作 93 个独立样本，或据此报告统计显著/长期可靠。
- 把 20 张匿名卡说成 20 个不同需求，或把 `not_evaluable`、unknown、没排名候选当成 0 分。
- 用一次 Understat 当前池运行声称最新完整市场覆盖，或忽略该来源当前的处理/留存/展示授权未核实状态。

## 下一步

最高价值工作是完成 [issue 168](../issues/168-collect-independent-one-on-one-review-labels.md)：将现成的 20 卡盲评包分别交给两位具足球知识的评审者，独立提交后再由裁决者逐卡判定；先锁定裁决，再揭示答案键。保留每位评审原分和分歧，unknown 不作零分。只有全部卡有两份独立评分和数值裁决时才计算该固定 query 的 nDCG@5；若仍有 unknown，就保留 `not_evaluable`。随后另建多个彼此不同的冻结需求和候选池，先明确希望支持的推断/精度，再谈跨场景推荐质量。盲评包和独立答案键目前均存在于 Git 忽略的 `.data/evaluations/`；issue 168 记录无人工标签，不需再做代码工作。

## 主要一手来源

- LangChain， [LangSmith Evaluation Types](https://docs.langchain.com/langsmith/evaluation-types)：参考答案/指标、Agent 工具调用轨迹、成对比较与人工/代码评估的边界。
- OpenAI， [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)：按应用目标分别测输出正确性、工具选择和参数精度；强调代表性样本与人工反馈。
- Liu et al., [AgentBench, ICLR 2024](https://proceedings.iclr.cc/paper_files/paper/2024/hash/e9df36b21ff4ee211a8b71ee8b7e9f57-Abstract-Conference.html)：多轮环境中的 Agent 决策评测。
- Lakens, [Sample Size Justification, 2022](https://doi.org/10.1525/collabra.33267)：样本量需按推断目标、效果大小、功效或精度说明，而非采用通用阈值。
- Gneiting & Raftery, [Strictly Proper Scoring Rules, Prediction, and Estimation, 2007](https://doi.org/10.1198/016214506000001437)：校准属于预测分布与实际观测之间的统计性质。
- NIST TREC，[English relevance judgments](https://trec.nist.gov/data/reljudge_eng.html)；Järvelin & Kekäläinen, [graded relevance and nDCG](https://doi.org/10.1145/582415.582418)：query、候选集合、判断标签相互绑定，分级 nDCG 衡量给定集合内的排序。
- Hayes & Krippendorff, [A standard reliability measure for coding data](https://doi.org/10.1080/19312450709336664)：原始完全一致率不能替代量表可靠性分析。
