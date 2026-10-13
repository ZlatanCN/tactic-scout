# 动态规划与固定工作流的公平消融

研究日期：2026-10-10。范围：交互式、多步工具 Agent 中，LLM 在运行时选择下一工具/动作，与预先固定工作流之间的效果差异。本文只总结一手论文可支持的评测先例，并标明项目化建议；不是完整系统综述。

## 结论

在核查的来源中，**没有找到一篇论文给出完全匹配本问题的标准协议**：同一个 Agent、同一套工具与交互任务，只改变“运行时动态选择下一步”对“冻结的通用工作流”，并同时控制模型、数据、总预算和答案揭示时机。最可用的组合是：借鉴 τ-bench / ToolSandbox 的状态化多轮任务与终态验收；借鉴 BenchAgent 的统一运行/记账接口；再用 token 匹配的 Web Agent 研究控制总推理成本和重复运行。下列具体协议是这些来源启发的**实验设计建议**，不能称为已有论文的标准。

## 一手来源能支持什么

| 来源 | 论文直接展示的做法 | 对本消融的适用边界 |
|---|---|---|
| [τ-bench](https://arxiv.org/abs/2406.12045) | 将任务建模为 Agent、用户模拟器和 API 工具之间的动态交互；标注的目标状态只用于用户模拟与评估，Agent 通过工具观察/更改状态；以最终数据库状态和必要回复内容评分。作者对每任务限制最多 30 个 Agent 动作，主结果每任务至少 3 次，Agent 温度 0、模拟用户温度 1。 | **强相关的任务与答案隔离先例**，但论文比较模型/Agent 方法，没有动态 Planner 对固定工作流的受控因果消融。三次运行是该研究的设置，不证明普遍足够。 |
| [ToolSandbox](https://aclanthology.org/2025.findings-naacl.65/) | 提供有状态工具、工具间隐含状态依赖、用户模拟器和 on-policy 多轮交互；使用中间里程碑和最终里程碑评估任意轨迹。 | 支持选择会让不同动作顺序、状态依赖或用户补充信息产生后果的任务，并按轨迹/状态评估；本身不是动态与固定策略的公平对照协议。 |
| [BenchAgent](https://arxiv.org/abs/2606.05670) | 在单 Agent、固定多 Agent 和演化多 Agent 流程间使用统一 benchmark loader、工具访问、答案契约、使用量记账和轨迹记录；一组对照固定到 GPT-4.1。 | 是**统一执行面与记账**的相关先例；比较对象是 Agent 数量/工作流家族，不是同一单 Agent 的动态规划与固定动作流程。论文另列的外部 GAIA 对照也不能单独证明规划策略效果。 |
| [预算约束 Web Agent 研究](https://arxiv.org/abs/2606.15017) | 把 workflow/skill/memory 的所有 LLM 调用计入总 token；将增强 Agent 与同总 token 预算的 Vanilla 基线比较，并报告每任务 token 量、三次独立运行均值/标准差及任务级变异。作者指出只匹配动作步数会掩盖辅助模块消耗。 | 支持**总推理 token 匹配/记账和多次运行**；研究对象为 WebAgent 增强模块，不是固定业务工作流对动态工具规划，不能外推其效果结论。 |

这些来源各自支持一部分协议，不能把“交互 benchmark”“同模型对比”或“token 匹配”单独当作已完成的动态规划消融。

## 建议的可复现实验

### 仅改变行动规划策略

- 两臂运行在**相同 runner / 框架 / evaluator** 中，复用同一模型版本、system/task 提示的共同部分、工具封装、权限和终态评分。只替换 next-action 决策：动态臂每轮按当前观测选择下一动作；固定臂执行预先冻结的通用流程，并且流程可对已观察到的工具结果做预先定义的分支。这样评估的是规划策略，而不是 LangGraph 与另一框架的总体差别。共同的 benchmark/tool/answer/trace substrate 与 [BenchAgent](https://arxiv.org/abs/2606.05670) 的控制思路相符；“同一 runner 只替换策略”是本报告的设计推论。
- 两臂给出**相同的任务初始请求、工具目录/描述、数据快照、工具服务语义、用户模拟规则和最大交互预算**。同一确定性沙箱按各臂实际动作与当时状态返回结果，不强行把不同工具调用的输出做成相同。状态化模拟器按相同语义规则回应不同问法；用户补充信息只在 Agent 真正询问后出现。任务答案或期望动作只交给 evaluator，绝不预填给其中一臂。τ-bench 明确将隐藏的用户侧任务指令/目标注释与 Agent 可见输入分开；它也指出无需相同措辞轨迹，只要达到唯一正确终态即可评分。[τ-bench](https://arxiv.org/abs/2406.12045)
- 采用逐 case 配对：冻结并记录每个 case 的数据/环境版本、任务输入、用户模拟随机种子（或固定答复规则）、模型/权重、采样参数、提示版本和流程版本。若真实 API 无法冻结，优先用同一确定性沙箱/响应 fixture；若使用 live API，将其结果列为带外部漂移的单独复验。

### 预算、结果与泄漏控制

- 两臂设相同的每任务**硬上限**（模型调用数、总输入/输出 token、工具动作数、超时）；所有 Planner、审核、重试及辅助调用均计入。不要只匹配工具步数，因为多出来的计划调用也消耗推理预算。[预算约束 Web Agent 研究](https://arxiv.org/abs/2606.15017) 直接比较过总 token 匹配并统计所有模型调用。主结果同时列成功率、任务级配对差、工具动作/模型调用数、tokens、时长和失败轨迹；报告成功-成本曲线，避免只看不同实际耗费下的准确率。
- 主要成功判据用任务终态/验收断言（例如检索出的实体集合、数据状态、必须遵守的约束），不要以最终自然语言是否相似作为唯一标签。τ-bench 用终态数据库校验；ToolSandbox 增加中间与终态里程碑。对本项目，可另列工具选择/参数、重复调用、是否问到必要问题、根据答复是否改计划、证据覆盖等轨迹诊断，但不与终态正确率混成一个分数。
- **避免 hindsight leakage：**在实验前冻结固定流程，并只用独立开发集修订它；评测 query/case 及其答案、标注目标、理想工具路径、运行轨迹均不可作为固定流程的逐 case 提示或实现输入。若把测试答案手写进每个固定脚本，这测的是“每案 oracle 程序”而非通用固定流程。τ-bench 的答案/目标只作模拟器和 evaluator 输入，为此提供直接先例；开发/测试分割是由此推出的实验控制建议。
- 每个 case 在两个臂都重复多次并逐 case 报告；至少三次只能作为探索性波动检查的起点，不是统计把握度保证。τ-bench 至少 3 次；预算研究也做 3 次并展示 run-to-run variance，指出固定温度下仍存在模型/环境变异。[τ-bench](https://arxiv.org/abs/2406.12045) · [预算约束 Web Agent 研究](https://arxiv.org/abs/2606.15017)

## 适用性判断与不确定性

交互式多步任务的环境/评分结构已有直接参考（τ-bench、ToolSandbox）；匹配共享执行协议和推理预算也有邻近先例（BenchAgent、预算约束 Web Agent 研究）。但在上述核查范围内，没有发现论文同时满足“单 Agent 内、动态下一步 vs 冻结通用工作流、相同模型/工具/数据/答案揭示与总成本”的直接 ablation。故建议将它作为**本项目自己的预注册配对实验**，不要写成复刻某篇论文协议。

一个相邻但不同领域的例子是 [AsgardBench](https://arxiv.org/abs/2603.15888)：其受控家务场景要求根据执行中的观察修订计划，且每轮重新计划但只执行首个动作；然而它是视觉具身任务，没有做同模型下动态 Planner 对冻结 workflow 的对照。因此可借鉴“同一指令产生不同必要动作序列”的任务构造，不可据此宣称本任务已有等价协议。

## 来源

- Yao et al., [τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045), 2024。
- Lu et al., [ToolSandbox: A Stateful, Conversational, Interactive Evaluation Benchmark for LLM Tool Use Capabilities](https://aclanthology.org/2025.findings-naacl.65/), Findings of NAACL 2025。
- Fu et al., [Do More Agents Help? Controlled and Protocol-Aligned Evaluation of LLM Agent Workflows](https://arxiv.org/abs/2606.05670), 2026 preprint。
- Hajimiri et al., [Are Online Skill and Memory Modules Always Worth Their Tokens? A Budget-Constrained Study of Web Agents](https://arxiv.org/abs/2606.15017), 2026 preprint。
- Tupini et al., [AsgardBench—Evaluating Visually Grounded Interactive Planning Under Minimal Feedback](https://arxiv.org/abs/2603.15888), 2026 preprint。

网页来源访问日期：2026-10-10。
