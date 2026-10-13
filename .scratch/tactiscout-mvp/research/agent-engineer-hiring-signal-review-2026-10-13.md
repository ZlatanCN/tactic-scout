# Agent 工程岗位招聘信号与 TactiScout 作品集差距

检查日期：2026-10-13
取样范围：中国与国际雇主的一手招聘页面；只纳入雇主招聘官网或从雇主招聘官网直达的正式职位申请页。
样本共 6 个岗位，覆盖腾讯、OpenAI、Anthropic。此为有目的的案例取样，不代表市场比例、普遍门槛或所有 Agent 岗位。

## 招聘页面样本

| 雇主 / 职位 | 地点 / 页面标注经验 | 页面状态（检查日） | 页面反映的工作重点 |
|---|---|---|---|
| 腾讯：[WorkBuddy-Agent Harness 研发工程师](https://careers.tencent.com/jobdesc.html?postId=2098252452842352640) | 深圳；职位页标注“不限” | **看起来仍开放**：官方职位记录可见，更新于 2026-09-21，并有申请入口。腾讯职位页是动态页面；本次用官网职位记录的索引正文核对职责与要求。 | 以真实用户任务表现迭代 Harness；自行定义评测标准和数据集；研究上下文编排、工具使用、多 Agent、长期记忆和长程任务；要求能把研究想法落地，且有 Rust/Go/C++ 等系统开发能力。 |
| 腾讯：[智能体套件-全栈开发工程师-CodeBuddy/WorkBuddy](https://careers.tencent.com/zh-cn/jobdesc.html?postId=2074756587444158464) | 深圳；3 年以上 | **看起来仍开放**：官网职位记录更新于 2026-10-08，页面保留申请入口。职位详情为动态页面；本次用官网职位记录的索引正文核对。 | 企业 Agent 产品的端到端交付；TypeScript/Node.js、Python、Java、Go 与 React 等工程组合；Agent 编排、工具集成、RAG、模型服务、质量监控、私有化部署、租户隔离与沙箱运行时。 |
| 腾讯：[微信视频号直播-AI Agent 高级算法工程师](https://careers.tencent.com/jobdesc.html?postId=2072877991679143936) | 广州/深圳；页面标题区域写 2 年以上，职位要求正文写 3 年以上 | **看起来仍开放**：官网职位记录更新于 2026-10-08，仍显示申请入口。页面对经验年限存在内部不一致，应以申请时职位页为准。 | Agent 系统架构和真实业务迭代；Multi-Agent、上下文工程、记忆、Tool Use、RAG；从设计、开发到上线的项目经历；要求理解模型训练/优化；LangChain/LangGraph、开源项目或 0→1 上线经历被列为相关项。 |
| OpenAI：[Software Engineer, API Agents](https://openai.com/careers/software-engineer-api-agents-san-francisco/) | 旧金山；7 年以上专业工程经验 | **看起来仍开放**：官网职位页显示 Apply now。 | 共享 Agent harness 和可复用后端基础能力；连接上下文、搜索、计算机使用、记忆、工具执行、委派与多 Agent；安全执行、权限、可观测性、评测、可靠性，以及成本/延迟优化；把模型和真实工作流转化为可衡量的任务完成改善。 |
| OpenAI：[Software Engineer, Agent Infrastructure](https://openai.com/careers/software-engineer-agent-infrastructure-san-francisco/) | 旧金山、纽约、伦敦 | **看起来仍开放**：官网职位页显示 Apply now。 | Agent 训练与生产运行平台；FastAPI/gRPC、基础设施即代码、集群编排、容器与虚拟化；从 0→1 快速建立系统并扩展；性能、可靠性和研究/产品团队协作。它偏资深基础设施岗位，和应用型 Agent 工程不是同一层级。 |
| Anthropic：[Staff+ Software Engineer, Claude Managed Agents](https://job-boards.greenhouse.io/anthropic/jobs/5395767008) | 旧金山/纽约；至少 8 年后端、分布式系统或基础设施经验 | **看起来仍开放**：页面有 Apply，申请按滚动方式审阅、无截止日期。该申请页可由 Anthropic 官方 Careers 招聘列表打开。 | 生产 Agent 平台的会话、执行环境、工具、状态、记忆、权限、沙箱、错误恢复和多租户隔离；持续运行和断线恢复；以真实客户任务评测 Harness；将可靠性、延迟和成本作为产品能力；设计长期稳定的 API。 |

## 重复出现的招聘信号

这 6 条职位描述中，反复出现的不是“会写 Prompt”或“会用某个 Agent 框架”，而是以下可交付能力：

1. **完整工程闭环。** 从模糊需求和问题定义开始，做到系统设计、实现、上线/运行，再根据真实任务或用户反馈迭代。腾讯 WorkBuddy Harness 和全栈岗位、OpenAI API Agents、Anthropic Managed Agents 都写到类似责任。
2. **评测驱动迭代。** 要自己定义任务成功标准、构建评测数据或基准，并能说明 Agent/Harness 改动是否提升实际任务表现。腾讯 Harness 和 Anthropic 都将评测作为职责；OpenAI API Agents 明确连接 traces、evaluations 与任务完成、成本和延迟指标。
3. **Harness 与运行时。** 工具路由、上下文组织、记忆、长流程状态、错误恢复、权限和安全执行，比单纯增加 Agent 数量更接近平台团队描述的核心工作。中国全栈岗还直接提到 Agent Runtime 和沙箱隔离。
4. **生产工程质量。** 后端与 API 设计、可观测性、可靠性、权限/隔离，以及 token、延迟或成本效率是重复信号。资深基础设施岗位另要求分布式系统、容器和高性能运行时；这属于特定岗位深度，不应机械复制到单机作品集里。
5. **产品判断与复合能力。** 不只实现图和工具，还要让复杂能力通过简单、稳定的接口和可理解的交互服务真实任务。腾讯全栈和 OpenAI API Agents 都强调产品/开发者体验；Anthropic 强调 API 本身是产品。

### 对求职目标的解释

这不是岗位数量统计。按这组实际页面，TactiScout 的 TypeScript + LangGraph 全栈实现能对上腾讯的 Agent 全栈/应用工程方向；它不应声称自己已经达到 OpenAI/Anthropic 的资深分布式平台岗位门槛。作品集最有力的定位是：**能构建并验证一个带真实状态、工具、追问、来源与安全边界的 Agent 应用；同时诚实说明排序质量和生产部署仍有哪些缺口。**

## TactiScout 现有证据对照

对照检查了仓库当前的 [README](../../../README.md)、[面试演示路线](../../../docs/demo-walkthrough.md)、[架构说明](../../../docs/architecture.md)、[评测说明](../../../docs/evaluation.md) 和 issue 地图。

| 招聘信号 | 仓库已能展示的证据 | 仍然缺少的证据 |
|---|---|---|
| 状态化 Agent / 工具 Harness | README 与架构说明记录 LangGraph Planner、typed tool executor、结构化 evaluator、条件路由、`interrupt`、SQLite checkpoint 和同案恢复。演示页给出自然语言调查、追问、恢复、Reviewer 到报告的体验路线。 | 当前完整运行主要是单机、本地单进程原型；SQLite saver/进程内互斥没有证明多实例运行能力。目标应是说明清楚运行边界，而非给原型加上并未验证的“生产级”标签。 |
| 真实任务评测、策略验证 | `docs/evaluation.md` 和 README 已记录动态规划、追问、Reviewer、RAG、能力评估器及搜索新鲜度等整图消融；Harness 核查动作、工具、证据和报告。部分实验记录 Planner token 用量、工具/阶段延迟与小样本波动。 | 这些是冻结场景的机制/行为检查，不是球探排名准确率，也不证明普遍泛化。项目自己明确将真实短名单质量标为 `not_evaluable`。 |
| 运行可靠性和安全约束 | 有 request-scoped 取消与结果丢弃、幂等请求、已暂停案件恢复、来源处理门控、模型地址回环约束和重定向拒绝；工具轨迹和进度事件与真实执行对应。 | 没有已验证的部署、多租户/跨进程协调或生产级 sandbox。没有必要为贴近资深平台岗位而虚构这类能力。 |
| 交互与可观察性 | 工作台呈现实际 LangGraph 阶段、工具结果计数、断线恢复、取消状态及完整调查轨迹；`/showcase` 可离线浏览真实历史运行摘要。 | 免模型 showcase 是脱敏录制摘要，不是新任务的实时运行；现场 Agent 演示需要本机 Ollama 和有边界的数据路线。可持续完善但要明确区分静态展示和 live run。 |
| 有根据的领域输出 | 报告将确定性数据指标、候选来源、样本覆盖和缺失能力分开；不把缺失值当 0，不用邻近字段冒充目标能力，也不把历史赛季说成现役转会结论。 | 当前 Understat 互动源不是完整注册名单，缺年龄等字段，自动采集/留存/模型处理/公开展示权限尚未核实；真实转会市场能力不能声称已解决。已有 Wyscout 历史样本允许按 CC BY 4.0 署名作本地历史验证，但不能替代现役市场。 |

## 差距排序

排序依据是对 Agent 开发岗位的证明力、目前未解决程度和可执行成本；它不是岗位需求频次的统计结论。

| 优先级 | 差距 | 作品集 / 招聘价值 | 可行性与边界 |
|---|---|---|---|
| **P0** | **没有人工短名单质量标签，所以没有可解释的 nDCG/排序质量结果。** 这是 README、`docs/evaluation.md`、issue 119 都明确承认的核心限制。 | 最高。它直接区分“Agent 工具链跑通”与“Agent 是否帮助做出更好的领域决策”，契合招聘中以真实任务和评测驱动迭代的信号。 | 评测器、双盲包导出器、匿名评审和裁决界面已经存在（issues 119–124、180；最近已有匿名样本包记录）。只需使用现存冻结快照和本地评审流程；需要真实独立评审者。不能生成合成标签、反向使用模型理由作真值，或不完整时强行算分。 |
| **P1** | **行为消融覆盖多个控制机制，但仍是少数冻结场景的小样本；评测结果不支持一般化声明。** | 高。多个对照实验已经是项目特色；下一步增加有效场景覆盖能让“评测能力”从机制演示向持续迭代更进一步。 | 只能围绕现有固定 fixture/许可清楚的快照扩展并报告每个场景边界；不能冒充随机生产用户分布，也不能以 Harness pass 代替候选质量。比 P0 更容易由开发者独立完成，但边际价值稍低。 |
| **P2** | **当前是本地单进程运行，不具备分布式 Agent Runtime/多租户/生产部署证据。** | 对高级平台/基础设施岗位有价值；对目标级别 Agent 应用开发岗位价值中等。 | 当前架构已如实标注边界。以为了招聘关键词而提前造多租户、容器 sandbox 或分布式 checkpoint，成本高、增加攻击面，也与目前单用户作品集场景不匹配。适合在明确面向平台岗位后，再用独立 issue 做最小、可验证的部署目标。 |
| **P2** | **真实当前球员数据源字段和使用权限有局限。** | 影响领域产品可信度与实时演示说服力。 | 现有决策优先尊重来源、隐私与处理许可；不要靠绕过来源限制、扩大爬取或把局部网页样本说成全市场来填补。可继续保留来源范围说明并等待许可明确的数据路线。 |

## 推荐的下一项 issue

**建议下一张 issue：使用现有冻结候选包完成第一轮“人工双评 + 裁决”的本地质量评测。** 这是 P0，也最贴合岗位页面反复强调的真实任务评测；它复用已实现的 `issue 119` 质量评测器、`issue 120/121` 匿名包导出与 `/review`、`/adjudicate` 工作台，优先使用已存在的 Wyscout 2017/18 冻结样本，不采集新球员数据、不调用模型生成标签、不公开原始包或答案键。

建议验收条件：

- 选定一个已有冻结 query 和候选池；先检查盲评包中的每项展示字段都来自该快照并有来源说明。
- 全部候选在揭示身份/系统排名前由两位彼此独立的评审者完成 0–3 或 `unknown` 评分；未知不能算作 0。
- 在查看答案键之前锁定评分并完成匿名分歧裁决；评分、裁决、系统排名的关联只由既有本地 `/adjudicate` 流程完成。
- 仅在每位候选都满足双评且裁决完整时计算该 query 的 nDCG@5；否则维持 `not_evaluable` 并列清缺项。
- 结果只作为这份历史快照、这个角色需求和这批参与评审者的场景级观察；不外推到现役球员、其他 query 或“球探客观金标准”。保留匿名展示字段可能泄露身份的说明，文件只留在本机忽略目录。

此项需要人类评审参与，代码助手不能代替独立球探判断。若暂时找不到合适评审者，项目应继续诚实显示 `not_evaluable`，不要把这一空白换成合成基准。

## 一手招聘来源与状态核对

- [腾讯招聘：WorkBuddy-Agent Harness 研发工程师](https://careers.tencent.com/jobdesc.html?postId=2098252452842352640)（职位更新日：2026-09-21；检查日 2026-10-13）。
- [腾讯招聘：智能体套件-全栈开发工程师-CodeBuddy/WorkBuddy](https://careers.tencent.com/zh-cn/jobdesc.html?postId=2074756587444158464)（职位更新日：2026-10-08；检查日 2026-10-13）。
- [腾讯招聘：微信视频号直播-AI Agent 高级算法工程师](https://careers.tencent.com/jobdesc.html?postId=2072877991679143936)（职位更新日：2026-10-08；检查日 2026-10-13）。
- [OpenAI Careers：Software Engineer, API Agents](https://openai.com/careers/software-engineer-api-agents-san-francisco/)（检查日 2026-10-13，官网职位页显示 Apply now）。
- [OpenAI Careers：Software Engineer, Agent Infrastructure](https://openai.com/careers/software-engineer-agent-infrastructure-san-francisco/)（检查日 2026-10-13，官网职位页显示 Apply now）。
- [Anthropic Careers / Job Application：Staff+ Software Engineer, Claude Managed Agents](https://job-boards.greenhouse.io/anthropic/jobs/5395767008)（检查日 2026-10-13，官方申请页显示 Apply，rolling basis、无截止日期；职位由 [Anthropic Careers](https://www.anthropic.com/careers/jobs) 列出）。

以上“看起来仍开放”仅依据检查时官网职位页/申请页仍展示申请入口或职位记录，不能保证雇主之后仍接受申请。中国腾讯职位页为动态内容；若后续页面下线，当前记录日期和直链用于说明本次检查依据。
