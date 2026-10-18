# Planner history 无损序列化实验

Status: claimed

## 需求

避免工具 JSON 在案件 JSON 中被二次转义；保持原始用户文本、候选数量、字段、null/0、数组顺序、失败工具内容及白名单校验。不得用减少候选或丢弃指标制造提速。

## 实现

structuredPlannerHistory 只解析 assistant/tool 的 JSON 对象或数组，用户文本、普通通知、坏 JSON 和标量保持原样。投影不修改 checkpoint 中的 history。最终仍使用原受限 schema、策略门和 Reviewer。

## 可复跑实验

从仓库根目录执行 `node --import tsx .scratch/planner-context-serialization/paired.mts`。先创建 `.data/evaluations/planner-context-experiment/`。要求本机 Ollama 中有 tactiscout-qwen3.5:9b。固定20人合成样本，最高每90值候选分钟未知；显式禁止额外按分钟筛选。交错顺序 baseline→structured、structured→baseline、baseline→structured。两臂使用相同模型、temperature=0、reasoning_effort=none、128输出token上限和任务，只改变 JSON 表达形式。结果写入 Git 忽略目录。

## 当前证据

三对共六次选择全部正确，输出均20token。baseline 1497输入token，structured 1434（-4.2%）；字符4458→3814（-14.4%）。冷缓存配对43833→37716ms；热缓存两对4169→4706ms、4731→4074ms。缓存命中数在结果中保留。不能从此声称稳定提速或推荐质量提升。此前未明确禁止分钟筛选的实验两臂均遗漏分钟未知的最高候选，因此不用它支持质量验收。

## 未完成

当前版本后端 631/631 回归通过；前端 SSE 8/8 已通过；API/Web 构建及差异格式检查通过。真实整图已完成：343245ms，expand超时60097ms后扩页，conclude响应213866ms，6279输入/408输出token；仅usedMultipleModelActions失败，报告证据检查通过。该运行与回归测试存在资源竞争，只验证兼容性，不用于耗时对照。端到端延迟目标继续进行中。

## 长尾调查补充

实际conclude墙钟时长超过180秒配置。但本机真实HTTP响应头先到、响应体持续写入空白并延迟2.5秒完成的测试，在OPENAI_TIMEOUT_MS=1000时约1秒正确退出。因此“SDK只管headers不管body”的假设未复现，不据此添加超时包装。测试位于 planner-output-bounds.test.ts，验证响应体持续读取期间仍遵循截止。实际超时差异可能包含客户端准备/解析或资源调度，尚未归因。

## 来源指令消融（进行中）

生产 investigate/reorient 改为只注入当前来源的专属规则，mosaic 保留 ASA 与组合源规则；reorient 同时保留当前来源的具体数据范围。通用需求、身份、位置、候选与引用约束仍保留。Understat 调查完整指令现6878字符；基线公共部分7723字符，另有Understat专属说明。来源规则及既有Planner测试12/12、API构建、diff检查通过。

可复跑脚本 `node --import tsx .scratch/planner-context-serialization/provider-pairs.mts` 使用固定基线commit 12d17fe，仅切换系统指令。完整生产Planner、schema和冻结两人xA样本均相同，按三对交错顺序验证。输出保存在 `.data/evaluations/provider-instructions/results.json`。当前exec session 74500仍在运行，下一次先查询该handle，不重复启动。未经结果验证不声称性能收益。

## 来源指令结果

三对顺序：baseline/active、active/baseline、baseline/active。耗时分别63205/69567ms、74915/27996ms、112731/41375ms；median 74915→41375ms（-44.8%）。一对变慢，两对变快，不提供p95推断。系统字符8963→6878，输入4868→3776token（-22.4%），输出328→204token。输出变短来自模型行为变化，不声称固定输出长度下推理吞吐提升。

初版valid仅检查候选ID与指标键，错误接受了基线虚构报告引用。运行结束后按相同完整引用规则重算全部原始动作，原结果不覆盖：reviewed-results.json中strictReferenceValid基线0/3、active3/3，基线三次均引用未检索的fixture-a文档。不能把这一局部检查当作完整球探质量或自由文本措辞正确性评估。

通过生产Planner、同一schema、同一冻结证据，只改变来源指令。该证据支持保留指令精简，适用范围仅限本机模型和此两人案例；不能声称已消除完整巴萨对话的长尾。最终conclude路径使用独立提示词，不直接受这项改动影响。

当前来源指令版本验收：后端633/633、前端SSE8/8通过；API/Web构建通过；git diff --check通过。三对消融均已完成，exec session 74500已退出；下一步无需重启此实验。当前任务仍claimed，因为完整对话长尾目标未达成。

## 最终输出字段消融（进行中）

真实LangGraph→当前Understat/FM仓库生成30条已评估记录的冻结输入，存于Git忽略的 `.data/evaluations/conclusion-context/input.json`，采集脚本在同目录下对应的scratch文件capture-conclusion.mts。为到达最终路径，实验Planner显式模拟了一次expand超时；这是受控路径采集，不是自然模型完整运行的性能结果。

`createRecruitmentPlanner({conclusionOutput:"selection"})` 仅在conclude且有brief/constraints时实验性使用：wire不再要求模型重写needSummary/capabilityProfile，返回后按同一已确认brief生成这两个展示字段。原候选、指标键、报告ID白名单保留，追问、限制与推荐选择仍由模型决定。默认仍为full，尚未上线实验模式。

`node --import tsx .scratch/planner-context-serialization/conclusion-pairs.mts` 顺序full/selection、selection/full、full/selection；同一冻结30人输入、模型、schema引用约束，记录用量、候选/证据合法性、重复ID与不存在的报告引用。结果保存在 `.data/evaluations/conclusion-context/results.json`；进程session 74819仍在运行，继续时先查询，不重新启动。

schema与brief展示的公开接口定向回归通过；尚需真实生产适配器配对结果和最后整图验收。端到端长尾尚未解决。

最终输出实验中间结果：full首两次26253/126051ms，输入6279、输出408；selection首两次100691/56588ms，输入6327、输出379。四次结构引用校验通过，但selection总token从6687增至6706；目前没有可采纳的成本收益证据。默认保持full。最后一对仍复用session74819执行，后续先查询同一handle。

冻结记录诊断：30条评估记录中28条有相关指标，2条为空；空指标记录约475字符。故不采用删候选来缩短上下文。指标元数据共享原型仅节省6.45%历史字符，增加查表负担，未实现到生产。

## 输出字段实验结论：不采用

全部三对完成。full：26253/126051/68268ms，selection：100691/56588/63615ms，引用检查均通过；中位数68268→63615ms（约-6.8%），一对显著变慢。总token6687→6706，没有成本收益，故撤回selection接口、presentation生成及相应实验测试；生产没有保留实验开关。负结果代码保存在selection-experiment.patch，需显式恢复该patch才可重跑conclusion-pairs.mts。该patch仅作实验复现记录，不应用于生产。

## 最终阶段来源说明精简（进行中）

最终阶段仅允许ask_user/finish，不携带inspect_candidate_group、inspect_match、翻页预算等调查操作说明。保留来源范围、年龄未知、位置标签/相邻/缺失、历史与逐场范围、xG等口径、环境非因果、minMaxPlayerStats不可作百分位、比较组、快照与SLA边界。原2052字符，现1349字符；完整输出schema、候选数、指标、ID白名单和Reviewer保持不变。

复现：`node --import tsx .scratch/planner-context-serialization/final-instructions-pairs.mts`。同一真实冻结输入，仅替换最终系统指令；记录provider报告的cached_tokens，避免混淆缓存与提速。基线指令保存于baseline-final-instructions.txt。当前session54031运行中，继续先检查同一handle。

最终阶段指令实验首对：baseline25191ms，cached_tokens=6275/6279；phase174854ms，cached_tokens=0/5908。两臂引用检查通过，输出408/405token。两臂缓存状态明显不匹配，故不用于性能因果推断。实际输入6279→5908（-5.9%），总token6687→6313。后续以缓存可比的配对核对；session54031仍在执行。


最终阶段说明精简的三对已完成：baseline25191/84607/95286ms、phase174854/85703/82128ms；输入6279→5908，输出408→405，六次引用检查通过。首对缓存不匹配，不参与耗时归因；后两对均近全缓存，一对稍慢、一对较快，稳定提速证据不足。保留更少的无关工具说明，但只声称输入减少5.9%。

## 生产图自动token流消融（进行中）

真实StateGraph.streamEvents(v3,custom)会把未显式禁用streaming的ChatOpenAI.invoke切换成stream=true，直接Planner微基准是非stream请求。此前把两者混为同一路径的推断不成立。已增加真实StateGraph+HTTP wire回归：修复前stream=true断言失败，createChatModel显式streaming=false后通过。前端阶段/候选SSE仍使用custom事件，不依赖模型token流。

`node --import tsx .scratch/planner-context-serialization/graph-stream-pairs.mts`，同一真实冻结30人输入、同一完整schema、同一模型、同一图v3/custom事件消费，仅改变自动token流开关。三对auto/off、off/auto、auto/off，记录实际wire的stream值。结果保存graph-stream-results.json；session60266运行中，继续时先查询同一handle。尚不能声称线上提速已验证。

## 扩围失败恢复修复

原策略把案件级partial一律视为继续翻页的理由，即使已有至少三条记录各自覆盖全部可测需求，也会在模型超时后自动扩页并进入下一次最终模型调用。现仅在失败恢复时保留这批证据齐备的考察线索，needSummary明确“扩围未能完成”，仍报告完整partial覆盖状态；普通模型决策不受此策略影响。低于三条联合覆盖记录仍精确补查，不用聚合覆盖人数代替逐记录证据。

公开expansionPlannerFallback同一输入的preserveExistingEvidence开/关对照：开启finish并保留3条有goals+assists证据的记录；关闭使用精确nextOffset=20查询。完整createRecruitmentConversation回归验证：扩围Planner超时后仅一次候选查询、没有conclude/reorient调用，生成3名证据支持的线索，partial仍可见。既有数据不足时继续精确翻页的测试通过。该实验只证明失败控制流与证据引用，不证明真实排序质量，也不把有限恢复报告当成完整调查。

图环境stream实验v1因为遗漏生产的raw JSON解析回退而停止，旧结果弃用。v2补齐回退，session65377仍在运行，输出graph-stream-results-v2.json；60266已退出130，不再轮询。已完成两对auto/off、off/auto，四次合法，输出和token一致（5908输入+405输出）；耗时一对更快一对更慢，尚无稳定速度收益。

## 图环境 stream 消融结论：不采用自动 token 流

三对已全部完成（v2，含生产的 raw JSON 解析回退）：auto 61101/55813/53108ms，off 55824/67420/86342ms；六次动作与引用校验全部通过，输出 token 与输入 token一致（5908 输入 + 405 输出）。耗时中位数 55824 → 55813ms，方向不稳定（一对快、两对慢），不构成可采纳的性能收益。

真实 StateGraph.streamEvents(v3, custom) 会把未显式禁用 streaming 的 ChatOpenAI.invoke 切换成 stream=true；本机 Planner 微基准是非 stream 请求，此前把两者混为同一路径的推断不成立。生产 `createChatModel` 现在显式 `streaming: false`：图进度完全走 custom 事件，Planner action 只在完整 Zod 校验后才被消费，token 流对这个产品没有任何 UI 价值，却让请求语义与微基准不一致。回归见 `tests/recruitment/chat-model-streaming.test.ts`（真实 StateGraph + 拦截 fetch，断言 wire 中 stream=false）；`tests/recruitment/brief-model-integration.test.ts` 的旧“第二次调用 stream=true”断言已随该决策更新。
