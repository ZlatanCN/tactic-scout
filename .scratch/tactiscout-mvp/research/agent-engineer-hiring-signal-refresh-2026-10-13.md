# Agent Engineer 招聘信号复核：TactiScout 作品集差距

检查日期：2026-10-13  
范围：从 2026-10-13 的招聘信号审查中复查原有六个职位，并补充当前中国雇主职位。只使用雇主招聘官网或雇主自己的招聘页；不把职位聚合站或媒体报道作为证据。

## 当前职位快照

“当前列出/开放”只描述本次检查时雇主页面仍列出职位或显示投递入口。职位可能随时关闭；不等于雇主承诺仍接受申请。动态页面的更新日、职位内容和投递入口可能在检查后变化。

| 雇主 / 职位 | 检查时页面状态 | 招聘信号 |
|---|---|---|
| 腾讯：[WorkBuddy-Agent Harness 研发工程师](https://careers.tencent.com/jobdesc.html?postId=2098252452842352640) | 官方详情仍列出，更新于 2026-09-21，页面有申请入口。 | 用真实用户任务改进 Harness；自行定义评测与数据集；关注 Context Engineering、工具使用、多 Agent、长期记忆、长程任务；从研究想法落到可运行工程。职位也要求 Rust、Go、C++ 等静态语言和高性能系统能力。 |
| 腾讯：[智能体套件全栈开发工程师 CodeBuddy/WorkBuddy](https://careers.tencent.com/zh-cn/jobdesc.html?postId=2074756587444158464) | 官方详情仍列出，更新于 2026-10-08，页面有申请入口。 | WorkBuddy Enterprise 全链路交付；TypeScript/Node.js 与 React 等工程栈；Agent 编排、模型服务、质量监控、部署、多租户/私有化和 Agent Runtime。岗位还明确提到 spec、context、harness 层的方法。 |
| 腾讯：[混元 Agent 强化学习框架工程师](https://careers.tencent.com/jobdesc.html?postId=2061654749727600640) | 官方详情仍列出，更新于 2026-09-30，页面有申请入口。 | 统一模型/工具/任务执行/上下文/Trace/结果收集/评估组件，支持数据生成、自动评估、实验复现；工程要求覆盖异步并发、Kubernetes、模块化测试与稳定性。它是本次补充的中国岗位中与 Harness 工程最直接的一条。 |
| 腾讯：[微信视频号直播 AI Agent 高级算法工程师](https://careers.tencent.com/jobdesc.html?postId=2072877991679143936) | 官方详情仍列出，更新于 2026-10-08，页面有申请入口。 | 真实业务场景中的 Agent 架构、Multi-Agent、上下文和工具调用、迭代上线；也包括模型训练/优化。页面标题区域写两年以上、正文要求写三年以上，存在内部不一致；本报告不推断其最终职级门槛。 |
| 字节跳动 Seed：[招聘热招岗位](https://seed.bytedance.com/zh/career) | 10-13 检查时页面仍将岗位列为“热招岗位”，北京/上海社招，并提供“立即投递”。 | 可确认当前招聘方向包括“大语言模型 Code Agent 算法工程师”和“大语言模型通用 Agent 算法工程师”。该页面没有展示完整职位说明，因此这里只据此确认职位名称、地点与招聘页投递入口，不推断技术要求或岗位层级。 |
| 百度：[FDE 工程师（前沿部署工程师）J106469](https://talent.baidu.com/jobs/social-list) | 百度官方社招职位列表在检查日仍显示该职位，标注 2026-10-12；职位详细申请状态在列表抓取中未完全呈现。 | 这不是标题为 Agent Engineer 的职位，但职责明确要求把模糊客户需求转成验收标准，用大模型、Agent、RAG 做 0→1 POC，完成代码、系统集成与上线，并用评测与监控优化任务完成率、准确率和响应速度。是中国市场端到端应用交付信号的直接证据。 |
| OpenAI：[Software Engineer, API Agents](https://openai.com/careers/software-engineer-api-agents-san-francisco/) | 官方职位页显示 “Apply now”，检查日可见。 | 共享 Agent Harness、搜索/上下文、工具执行、记忆、委派、长流程、安全、可观测、评测、可靠性、成本与延迟；描述明确把 traces/evaluations 和任务完成改进联系起来。要求 7 年以上经验，属于资深后端平台岗，不能直接当作入门岗位标准。 |
| OpenAI：[Software Engineer, Agent Infrastructure](https://openai.com/careers/software-engineer-agent-infrastructure-san-francisco/) | 官方职位页显示 “Apply now”，最近一次职位页检查可见。 | Agent 训练与生产执行平台，涉及规模化环境、系统部署及 Research/Product 协作。定位更偏资深系统/基础设施岗位。 |
| Anthropic：[Staff+ Software Engineer, Claude Managed Agents](https://job-boards.greenhouse.io/anthropic/jobs/5395767008) | Anthropic 官方职位申请页检查日可访问；Anthropic Careers 列表最近可见该职位和 “Apply” 入口。 | 托管 Agent 的 Harness、持久会话、执行环境、工具、记忆、权限、恢复和稳定 API；要求至少 8 年后端/分布式系统/基础设施经验及生产运行经验。是 Staff+ 平台标杆，不是 TactiScout 应照搬的规模目标。 |

原审查中的 OpenAI 与 Anthropic 职位仍能在官方页面找到；国内样本增加了腾讯 Hunyuan Harness 与字节 Seed 通用/代码 Agent 招聘信号，以及百度较新的 Agent/RAG 交付岗位。样本已覆盖腾讯、字节跳动、百度、OpenAI、Anthropic 五家雇主，其中三家为中国雇主。阿里招聘主页本次没有提供可直接核对的 Agent 工程师单职位页，故未把它计入职位样本。

## 可重复的招聘信号

1. **把 Agent 当系统交付。** 需要从需求/任务拆解出发，贯穿规划、工具、上下文、执行、错误处理、上线或交付。腾讯全栈岗和百度 FDE 岗尤其强调端到端；OpenAI/Anthropic 的资深岗把这一闭环抽象成可复用平台。
2. **评测必须指导改进。** 腾讯 Harness/Hunyuan 岗要求定义评测、数据集或自动评估；百度要求监控任务完成、准确性和响应速度；OpenAI 明确把运行 Trace 与评测结果连接到任务完成、成本和延迟。单纯“用了 LangGraph”不是招聘证据。
3. **Harness 可复用性和运行安全。** 工具调用、上下文管理、状态、持久化、错误恢复、权限、可观测和可靠性重复出现。Kubernetes、沙箱、分布式系统、多租户属于某些平台/企业岗位的重要附加要求，不应因看到这些关键词就给单机作品集加无验证的生产承诺。
4. **研究/算法岗与应用工程岗并不相同。** Seed 的 Code/General Agent 岗位在官方页上属于算法工程师招聘；页面只证明招聘方向。腾讯直播 Agent 算法岗还要求模型训练背景。它们可作为 Agent 能力方向信号，但不宜直接等同于 Agent 全栈工程岗位。

这组有目的样本不是市场统计，也不能推出所有雇主或职位的通用门槛。OpenAI/Anthropic 的职位明确为资深/Staff+；它们能说明平台工程的能力上限，但不能据此要求个人项目模拟其分布式生产规模。

## 与 TactiScout 当前证据的对照

核对了 [README](../../../README.md)、[面试演示路线](../../../docs/demo-walkthrough.md)、[评测说明](../../../docs/evaluation.md)、[框架选择 ADR](../../../docs/adr/0010-langgraph-stategraph-for-recruitment-cases.md) 及现有本地 issue 地图。

| 招聘信号 | 仓库已有证据 | 仍缺的证据 / 不能声称的事 |
|---|---|---|
| Agent 应用端到端交付 | 全 TypeScript 的 React/Vite、Fastify/Zod 与 LangGraph StateGraph；自然语言开案、工具执行、追问中断/恢复、Reviewer、报告、SQLite checkpoint、浏览器计划保存均在 README 与演示路线中说明。README 提供离线 `/showcase` 入口，免装模型/API 即可看一次脱敏真实运行摘要。 | 项目是本地单用户原型；没有公开部署、多租户或生产运行承诺。数据源范围也受许可和字段完整性约束。 |
| Harness、可观测与故障边界 | LangGraph 实际阶段/工具进度、请求去重、取消传播和恢复都有实现与检查；CLI 可跑真实本机模型，并记录任务检查、工具/评估数量、tokens 与延迟。CI 跑确定性 Agent 回归测试和 API/Web 构建。 | Harness 的 “pass” 是已登记行为/证据契约，不是推荐质量或真实用户任务成功率。在线真实模型复跑依赖本机配置，且并非 CI 每次提交都会运行。 |
| 评测驱动迭代 | `docs/evaluation.md` 记录追问策略、Reviewer、动态规划、证据评估、历史旁注、RAG 等核心机制整图对照；当前 `/showcase` 也为评审者提供无需模型的结果浏览路线。 | 许多消融样本量为每场景三组配对，使用冻结场景/本地模型，只能做机制行为推断。真实候选排序质量仍为 `not_evaluable`：没有独立球探双评与裁决标签；不能把候选数、字段覆盖或 Harness pass 冒充准确率。 |
| Agent 产品取舍 | 把模型决策与确定性工具/evaluator 分开；追问只在关键字段缺失时发生；缺数据标明为缺口；来源门控在运行时 fail closed；框架选择 ADR 对比 StateGraph、`createAgent`、手写循环和 Vercel 的边界。 | 当前交互依赖本机 Ollama，现场效果和耗时受小模型/本机硬件影响。应用面已经明显超过“聊天壳子”，但没有多租户/沙箱/云部署实证。 |

招聘信号与现有作品集的贴合处是清晰的：TypeScript Agent 应用、真实状态化工具编排、评估与安全边界都有代码/文档/实验可核对。最重要的诚实差距仍是“推荐是否更好”缺少独立标注；现有 review/adjudication 工具已实现，但实际双人评审是人类任务，不能靠代码代理伪造。第二个可由开发者独立推进的差距是实验结果目前有多处人工维护，降低了消融结果的复现/审计便利性。

## 建议新增的独立 issue

### 为动态规划整图消融导出身份自由、可复算的结果摘要

**依据：**当前评测说明明确写着 `--summary-output` 只支持普通 Harness，和 `--compare-*` 消融选项一起使用会在访问模型/数据前失败；规划消融结果现在需要从完整本地运行结果整理为公开展示数据。[评测说明的身份自由摘要段落](../../../docs/evaluation.md#真实模型-harness) 和[动态规划消融](../../../docs/evaluation.md#动态调查规划消融)记录了这个差距。动态规划是项目的重要 Agent 工程对照；招聘页面反复要求把任务评测、Trace、任务完成、延迟和成本放在一起看。

**目标：**给现有 `--compare-investigation-planning` 增加一个显式选择的 `--summary-output <path>`，写出稳定 schema、最小字段的配对聚合结果，供 `/showcase` 的动态规划卡片和评测文档使用。第一版聚焦这个已有对照，不顺便把所有 Harness 实验格式泛化成报告框架。

**建议验收条件：**

- 仅输出预先白名单字段：两臂/配对数、Harness 检查通过数、工具/评估/推荐计数、真实 provider token 汇总及覆盖状态、耗时 p50/p95；缺失用量保持 missing，不推算成 0。
- 摘要、stderr 和失败路径都不包含球员/球队名称或 ID、原始用户需求/补答、报告正文、提示词、trace/进度载荷、模型端点或任意 free-text。
- 纯函数测试检查字段 allowlist、`missing` 处理和敏感哨兵值不泄露；CLI 测试检查 `--compare-investigation-planning --summary-output` 行为、目标已存在时拒绝覆盖、文件权限与原始日志仍留在 Git 忽略目录。
- 用同一快照和同一登记场景生成脱敏结果，并核对展示卡片数值由该摘要生成/更新；页面仍说明三组配对是探索性行为实验，不代表推荐排序准确率或统计显著性。
- 其他 `--compare-*` 选项在本 issue 中仍明确拒绝与该摘要模式组合，避免未审计的任意结果泄露。

它是一项纯本地工程任务，可由代码独立完成，不依赖新的球员来源或人类判断；能让面试官核对展示数字来自同一套 CLI 实验结果，并把 tokens、延迟和行为变化置于同一可复现证据格式中。它不会弥补没有真实球探标签的问题，也不会提升或证明推荐质量；独立双评/裁决仍是之后唯一可信的排序质量路线，见 [issue 168](../issues/168-collect-independent-one-on-one-review-labels.md)。

## 来源状态及限制

- 腾讯职位详情为动态网页；职位更新日来自官方页搜索索引结果，申请入口/详情以 2026-10-13 检查状态为准。
- 字节 Seed 招聘页展示岗位标题、“社招北京/上海”和“立即投递”，但无完整 JD；不据职位名猜职责，也不从第三方职位页补写详情。
- 百度社招页本次显示其职位列表和 2026-10-12 更新岗位，但页面抓取未确认具体职位申请表是否仍收件；因此状态只称“仍列出”，不称已验证接受申请。
- Anthropic Staff+ 职位要求至少八年后端、分布式系统或基础设施经验；OpenAI API Agent 岗要求七年以上工程经验。仅借其 JD 提取 Harness/平台信号，不能把资深生产级要求当作 TactiScout 项目已经具备的能力。
- 招聘页状态会变化；如用于实际申请，应在投递当天重新打开雇主官方职位页核验。
