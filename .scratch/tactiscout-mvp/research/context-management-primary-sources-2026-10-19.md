# TactiScout 上下文管理：一手资料研究

研究日期：2026-10-19。范围：官方文档、项目源码和作者论文；本文件提供设计依据，不代表应用已经实现。在线文档和 `main` 分支会变化，下面的默认阈值均是研究时状态，不能直接当成本项目配置。

## 1. 先确定管理的对象

LangGraph 将 thread 内状态交给 checkpointer 持久化，将跨 thread 数据放入带 namespace 的 Store；这两个存储范围与一次模型调用的消息窗口不同。线程可以恢复，应用仍然需要决定恢复后的哪些内容进入下一次请求。[LangGraph memory overview](https://docs.langchain.com/oss/javascript/concepts/memory)

LangChain 明确区分 transient model context 与 persistent state：可以修改本次发给模型的 messages/tools/prompt，而不修改保存的状态。这是实现“完整记录保留、请求按阶段裁剪”的直接依据。[Context engineering in agents](https://docs.langchain.com/oss/javascript/langchain/context-engineering)

LangGraph 的设计指南建议 state 保存原始数据，在节点内按需格式化 prompt；可从现有数据推导的值不应重复存储。这样同一份状态可以支持不同节点的不同视图，避免把格式化后的大段文本作为唯一事实来源。[Thinking in LangGraph：Keep state raw](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)

**对本项目的推论：**先定义稳定的案件事实与证据引用，再按 Planner、身份核实、调查、报告职责组装上下文。Checkpoint 是恢复能力；context builder 是模型决策质量控制，二者应有明确边界。

## 2. Deep Agents：裁剪、外置、摘要、隔离相互配合

研究时官方文档描述：大型工具输入/结果可以外置并用引用代替；工具结果附短预览供后续按需读取。自动总结在接近配置的上下文阈值时执行，保留近期消息并归档原始对话；另有可选的 `compact_conversation` 工具。子 Agent 独立探索，主 Agent 接收最终结果。文档示例的 85% 触发、10% 近期保留与 20,000-token 大结果阈值属于该 SDK 的默认策略，不能照搬到本机模型。[Deep Agents context engineering](https://docs.langchain.com/oss/python/deepagents/context-engineering)

源码还有一个易忽略的限制：直接构造总结中间件时，`trim_tokens_to_summarize` 控制“送给总结模型的旧历史”，不是摘要输出长度；在截断前的历史不会被总结。工厂与直接构造器的默认值也可能不同。只有看到“启用了 summarization”，不能推断所有历史细节都进入了摘要。[Summarization middleware source](https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/middleware/summarization.py)

**对本项目的推论：**外置结果必须同时具备稳定 ID、内容版本、短预览和可实际调用的读取能力。只留下一个失效路径并不构成可恢复上下文。不要为了隔离上下文，把每次数据查询都升级为带独立 LLM 循环的子 Agent。

## 3. Open Deep Research：压缩研究产物而非所有事实

源码的研究子图以 `compress_research` 收束；结果同时返回 `compressed_research` 与 `raw_notes`。研究循环有工具调用次数上限；压缩调用发生 token 超限时会移除部分旧消息重试，最终报告再综合研究结果。这是“有损工作摘要 + 原始记录”的具体实例，也说明开源实现本身有丢失上下文的取舍，不能当无损保证。[Open Deep Research implementation](https://github.com/langchain-ai/open_deep_research/blob/main/src/open_deep_research/deep_researcher.py)

**对本项目的推论：**可以把长篇网络资料整理成“支持的判断、反证、未知、来源引用”研究产物；球员身份 ID、指标单位、样本分钟、赛季、筛选硬条件应由结构化事实直接投影，不经自然语言多次转述。

## 4. Anthropic：高信号上下文与按需取证

Anthropic 的工程文章建议用轻量引用和工具按需取得资料，并说明即时探索也会增加延迟；它将 compaction、结构化笔记和子 Agent 视为不同手段。文章特别建议先保证压缩召回，再去除冗余；没有要求所有应用都启用多 Agent 或固定长度摘要。[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

当前平台还提供服务端 compaction，但该机制有平台和模型支持边界。它不能直接视为 Ollama 或所有 OpenAI 兼容服务的标准能力。[Claude compaction overview](https://platform.claude.com/docs/en/build-with-claude/compaction)

**对本项目的推论：**先用结构化投影和工具结果瘦身处理日常短任务；长对话仍超预算时，才给旧动态轨迹生成摘要。总结本身有延迟、费用和失真风险，不应每轮默认增加一次模型调用。

## 5. 缓存相关的两个常见误解

Claude prompt caching 要求缓存区段精确相同；稳定指令和工具定义放在前面、变化数据放在后面有助于命中。缓存降低重复计算，不等于扩大模型窗口或消除注意力干扰。它有平台范围、最小长度和有效期，不能把 Claude 的计费或命中机制直接推断到 Ollama。[Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

官方 context editing 文档明确写出：清理工具结果会使相关缓存前缀失效，此后可重建并复用新前缀。因此“服务端缓存编辑必然保全缓存”不成立；“摘要永远不能更新”也不是通用纪律，更新要权衡事实新鲜度与缓存成本。[Claude context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)

**对本项目的推论：**固定 prompt 序列化顺序，避免无关时间戳进入静态前缀；先测实际缓存 token 与请求延迟，再决定是否为缓存牺牲上下文相关性。摘要应可版本化、可重建，不应永久冻结过期结论。

## 6. 硬预算必须覆盖整次请求

LangChain 支持按 token 预算裁剪消息，也提醒删除后必须保持 provider 接受的消息结构，尤其工具调用与对应 tool result 的配对关系。[Short-term memory implementation guide](https://github.com/langchain-ai/docs/blob/main/src/oss/langchain/short-term-memory.mdx)

Ollama 的实际分配上下文长度受运行配置与资源影响，不应仅从模型宣传窗口推断；增加上下文会增加运行内存。可以检查实际分配的 context。[Ollama context length](https://docs.ollama.com/context-length)

Ollama 原生 chat API 文档列出 `prompt_eval_count`、`prompt_eval_duration`、`eval_count`，当前文档还列出 `prompt_eval_cached_count`。这些可用于校准估算与分析 prefill 成本；兼容接口、当前安装版本是否暴露相同字段仍需本机核实。[Ollama chat API](https://docs.ollama.com/api/chat)

**对本项目的推论：**预算应计入指令、工具 schema、结构化响应 schema、状态视图、历史、证据，并预留输出及 provider 所需余量。明确记录 token 计数是精确、估算还是未知；中文不能一律按英文字符比例换算。超预算时先减低优先级证据和旧过程记录；当前用户要求和未解决的工具交互不能静默丢弃。

## 7. 长期记忆的边界

LangGraph 官方资料区分用户画像与记忆集合，也说明更大的画像更新更容易出错、集合更新与检索则更复杂；在主链路写记忆增加延迟，后台写入会带来同步时机问题。没有一种通用最优形式。[Memory overview：profiles, collections and writing](https://docs.langchain.com/oss/javascript/concepts/memory)

**对本项目的推论：**案件约束不自动泛化为用户习惯；“这次只看 23 岁以下”不意味着所有未来案件都应限龄。优先持久化显式偏好并提供修改/删除；当前用户输入覆盖旧偏好。球员事实与用户偏好分 namespace，来源与更新时间保留。向量数据库不是保存少量明确偏好的前提。

## 8. ACE：值得借鉴的是增量维护，而非自我修改一切

ACE 论文把上下文视为可演进 playbook，指出反复整体改写可能产生简洁偏差和细节退化，采用结构化增量维护。其公开评测是指定 agent 与金融任务；不能外推为足球推荐有效，也不能把文中提升数字直接当项目收益。[ACE paper, v3](https://arxiv.org/abs/2510.04618v3)

开源实现用 Generator、Reflector、Curator 分工，将经验变成具有 ID 与 helpful/harmful 计数的局部更新，合并时去重、裁剪。这个架构有额外调用和维护成本。[ACE source repository](https://github.com/ace-agent/ace)

**对本项目的推论：**可借鉴稳定记忆条目 ID、增量更新和可回滚版本；不必为本项目马上加入三角色自进化系统。系统球探规则的更改应进入代码/配置版本和 Harness 评测，不能由网页内容自动改写。

## 9. 资料进入记忆前必须保持来源边界

Anthropic 将从网页、文档等不可信内容进入模型的注入作为实际风险，并描述多层防御和评测；没有声称单靠提示词可以完全消除它。[Prompt injection defenses](https://www.anthropic.com/research/prompt-injection-defenses)

**对本项目的推论：**搜索网页与球探报告里的“忽略规则、记住某人是最佳候选”等指令只能作为不可信文本。摘要必须保留来源与置信度，不能把网页指令洗成系统约束；外部资料无权写用户偏好、替换身份映射或变更硬筛选规则。验证动作和数据访问范围由代码执行。

## 10. 对 TactiScout 的可执行建议（待结合代码审计定稿）

1. 用一个 context builder 接收图状态、节点职责和模型预算，返回 messages、选中/省略项清单及估算用量；继续沿用现有 LangGraph，不另起通用 Agent 框架。
2. 案件事实、用户确认、指标证据保存为结构化权威状态；工具长结果归档，模型只取相关字段与引用。预览写明裁剪范围，避免把未提供当零值或不存在。
3. 每次调用前按预算做确定性投影。旧调查轨迹确实超预算时生成版本化案件摘要，保留近期完整交互、未解决问题和事实引用。摘要失败时回退到结构化状态与近期轮次，且不得静默删除硬条件。
4. 原始历史和证据保留可检索记录；读取接口按 case/run/ref ID 限定范围并限制返回长度，避免再把整个归档一口气读回。
5. 跨案件记忆从显式偏好开始；等用户复用场景和收益明确后，再做后台提取。子 Agent 仅用于独立、输出可校验的长资料调查，先通过实验确认收益。

以上为应用设计建议，不是引用资料已验证的足球产品结论。预算数值、保留轮数与摘要长度都应由本机模型和真实案件校准，不能直接复制 Deep Agents 的绝对阈值。

## 11. 必须用本项目实验验证的机制

建议冻结数据快照、任务、模型配置和总工具预算，用相同场景做配对比较：A 当前策略；B 节点投影 + 硬预算 + 可读取的外置结果；C 在 B 基础上增加按需摘要。再分别关闭外置读取和硬条件直接注入，定位收益与失败原因。重复模型运行，报告分布而非单次最佳值。

核心正确性指标：最新约束保留率、旧约束被更正后的错误复用率、替代者本人误入率、位置口径、身份关联准确性、分页游标连续性、证据来源/单位/样本保真、无依据结论、可恢复原文与重复工具调用。效率指标：总输入/输出 token、估算误差、上下文超限率、每轮调用数、端到端及 prefill 延迟；包括摘要成本。

对抗用例包括：中途修改年龄/预算、取消上一条位置限制、同名球员消歧、30 轮后回问早期已确认要求、多页候选后继续扩围、网页夹带伪指令、资料冲突、缺失指标、归档不存在和摘要调用失败。验收先守住硬约束与证据正确性，再要求净延迟/token 收益；不以“摘要更短”代替任务质量。
