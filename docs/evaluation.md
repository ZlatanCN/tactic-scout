# 评测与复现

本文区分确定性测试、真实模型 Harness 和 RAG 来源级检查。三者回答不同问题；任何单项通过都不代表球员推荐质量已验证。

## 确定性验证

```bash
pnpm test
pnpm build
pnpm build:web
```

确定性测试经 Fastify HTTP 边界、LangGraph runtime 和前端 API 契约验证追问/恢复、工具顺序、来源处理门控、报告证据和同案队列释放；模型规划器、embedding 与球员数据由固定实现注入，不需要 API key 或在线来源。2026-10-12 当前工作树完整验证：`pnpm test` 415/415、`pnpm build`、`pnpm build:web` 与 `git diff --check` 均通过。测试覆盖 FPL/FBref 与远程模型端点的早期拒绝、Understat/ASA/mosaic 的 loopback 路径与活动依赖取消、StatsBomb 男足赛事/赛季过滤，以及身份自由 Harness 摘要导出。确定性测试、真实模型 Harness 与数据源研究的边界由 [issue 14](../.scratch/tactiscout-mvp/issues/14-agent-harness-evaluation-suite.md) 和 issue map 维护。

### 工具取消传播

停止请求通过实际 `createApp` HTTP turn 进入编译后的 LangGraph，再由 tool executor 传至候选搜索、RAG 和候选评估。取消活动中的候选查询后，HTTP 回合以取消终态结束，Planner 不会重启，也不会继续生成报告；另有运行时与同案队列回归覆盖原有停止语义。Understat、ASA 和 mosaic 的适配器验证了来源请求 signal、请求体读取与共享请求订阅行为。

在固定整图 fixture 上，对照工具适配器收到 signal 与刻意不转发 signal：开启臂 3/3 次在取消终态前结束底层来源工作；屏蔽臂 3/3 次在终态时各剩余 1 项活动工作，随后由测试明确释放。它只证明这个 fixture 的信号传播会改变终态后的剩余工作，不代表真实源站延迟或一般性能收益。Transformers.js embedding 和 LanceDB 当前调用无法被该信号强制中断；取消前启动的单次本地调用可能完成，但其结果不会触发后续调查动作或报告。定向验证入口为 `node --import tsx --test tests/recruitment-cancellation.test.ts tests/app-composition.test.ts tests/understat-provider.test.ts tests/asa-provider.test.ts tests/multi-source-provider.test.ts`；整套测试及 API/Web 构建结果见本节首段。

## 真实模型 Harness

配置 `.env` 中的 OpenAI-compatible 模型与需要使用的数据模式后运行：

```bash
pnpm eval:local-agent -- --scenario all
```

代表场景包括巴萨年轻中场需求，以及拜仁凯恩接班人调查。后者检查 Agent 先调查、在职责不明确时追问、用户补答后恢复同一案件、中锋无匹配时征求扩围、只评估用户批准范围内候选、经过 Reviewer 后再生成报告。

重复运行以观察本机模型的运行波动：

```bash
pnpm eval:local-agent -- --scenario all --runs 3
```

也可以指定 `--scenario bayern-kane-replacement`、`--scenario barcelona-under-23-midfielder` 或 `--scenario barcelona-attacking-one-on-one-forward`。自定义自然语言任务可用 `--message "..."`，并重复传入 `--answer "..."` 提供每轮补答；`--expected-position ST` 可校验自定义场景的位置范围。每次运行使用新的案件 ID。

Harness 记录安全工具 trace 和与工具调用对应的进度事件；不输出密钥、原始查询、对话内容或模型隐藏推理。它检查候选确实来自数据工具、已评估后才推荐、能力证据与需求对齐、追问状态与同案恢复，以及失败/零匹配状态是否区分。它不评推荐排序准确率，也不把小语料 RAG 检索称作已验证相关性。

默认 Harness 的标准输出包含完整运行 JSON，stderr 包含逐事件 trace/进度；运行数据可能包含来源候选 ID 和报告细节。需要持久保存验收结果时，普通运行可改用身份自由摘要：

```bash
mkdir -p .data/evaluations
TACTISCOUT_DATA_MODE=understat pnpm eval:local-agent -- \
  --scenario understat-five-league-xg-creation \
  --summary-output .data/evaluations/understat-summary.json
```

CLI 在访问数据或模型前检查目标路径；既有目标会被拒绝，实际写入也使用独占创建，防止并发覆盖。摘要文件权限为 `0600`，仅保存 Harness 检查、耗时分位数、模型 token 汇总、工具调用/匹配/返回数量、进度条数和报告/候选计数。重复运行下的候选、推荐与来源记录计数是跨运行观察次数，不代表去重人数。摘要不保存候选姓名/ID、具体场景 ID、用户需求、报告正文、数据源/模型端点、trace 或进度载荷；summary 模式也会抑制 trace/进度终端输出。该模式当前只接受普通运行，消融输出形状尚未纳入其字段白名单，使用 `--summary-output` 与任何 `--compare-*` 会在数据/模型访问前失败。摘要仍只是该次链路的行为证据，不验证推荐质量，也不授予来源采集、留存、模型处理或展示权限。

此前一次 Qwen 3.5 9B 凯恩场景从 FPL 2026/27 仓库到 LangGraph Reviewer 报告：两轮补充后同案恢复，首轮观察到 79 条宽泛前锋匹配记录，中锋确认结果为 0，获准扩围后读取 40 条并评估 30 人；仓库显示 667 条英超游戏球员记录，球员报告语料 0 命中。29/29 Harness 检查通过，10 次工具调用、55 条进度事件，用时 173.422 秒。单次运行只验收行为与证据契约，不验证推荐排序质量、市场完整度或长期可靠性；报告明确指出射门终结和进攻接应缺少直接指标。

2026-10-10 当前工作树再次运行 `bayern-kane-replacement`：本机 Qwen 3.5 9B 经本地 API 使用 FPL 当前赛季仓库，首轮安全暂停在 `needs_input`，两次匹配补答后同案完成；三次候选查询分别观察到 79 条宽泛匹配、0 条中锋匹配及扩位后的 79 条匹配记录，实际读取两页共 40 条并评估 30 人。Planner 检索到 2 个方法片段、球员报告语料 0 命中；Reviewer 完成并输出报告。29/29 检查通过、14 次决策、10 次工具调用、55 条进度事件、无 Planner fallback 或策略覆盖，用时 165.432 秒；报告有 2 条候选结果。该单次运行验证本次交互/工具/证据契约，不验证候选排序质量、市场完整度或长期可靠性。缺直接指标的射门终结与进攻接应继续列为数据缺口；脱敏汇总之外的原始结果留在 Git 忽略目录 `.data/evaluations/fpl-live-harness-2026-10-10.json`。

此前 `mosaic` 多来源整链运行 28/28、141.570 秒，报告快照为 332 条/9 个赛事。详细历史和限制见 [issue 14](../.scratch/tactiscout-mvp/issues/14-agent-harness-evaluation-suite.md)。

2026-10-11 使用当日 Understat 当前五联赛池和本机 Qwen 3.5 9B，对 xA/关键传球/npxG 场景完成一次自然语言需求到 Reviewer 报告的整图运行：31/31 Harness 检查通过，3 次模型请求、6 次工具调用、151.976 秒。候选查询命中 654 条，本轮详细检查 20 人并报告 3 人；两项请求能力均为 20/20 有指标支持，共观察到 220/340 个预期指标值，全部 20 人属于低分钟样本。方法语料返回 2 个片段、1 个来源，获准球员报告语料 0 命中。单次运行只验证这条链路的行为和证据契约，不证明排名质量或长期稳定性；原始细节留在 Git 忽略的 `.data/evaluations/understat-live-harness-2026-10-11.{json,log}`。协议、数据限制与更早的三次复验见 [issue 94](../.scratch/tactiscout-mvp/issues/94-understat-five-league-conversation-chain.md)。

2026-10-12 以同一本机 Understat/Qwen 配置重新运行登记的五联赛自然语言场景：31/31 Harness 检查通过，3 次模型请求、6 次工具调用、29 条进度事件，用时 107.674 秒；服务端报告输入/输出/合计 token 为 8,688/746/9,434。候选查询匹配 650 条来源记录，本轮只读一页 20 条并分两批评估；评估器返回 220 个指标值。方法语料返回 2 个片段/1 个来源，球员报告语料 0 命中，Reviewer 通过。该次只保存上述聚合验收摘要，没有把球员姓名、来源 ID 或原始响应写入仓库；单次通过不证明排序质量、长期可靠性或数据源许可。Understat 的采集、留存、模型/RAG 和展示权限仍未核实。

随后使用 `--summary-output` 验证最终身份自由导出：31/31 检查通过，用时 53.195 秒；Planner 3 次请求、8,688/746/9,434 输入/输出/合计 tokens；650 条匹配记录、20 条评估记录、220/340 个预期指标值、20 条低分钟样本、3 条报告候选线索和 2 个方法片段。文件位于 Git 忽略的 `.data/evaluations/understat-identity-free-summary-verified-2026-10-12.json`，模式为 `0600`，没有姓名、ID、需求文本、报告正文、trace 或进度载荷。候选和报告数量是本次运行的观察计数；低分钟样本提示和来源权限边界仍适用。

### 能力证据评估器整图消融

用完整 LangGraph 比较确定性能力证据评估器的两种状态。开启臂通过真实评估器返回来源指标和比较信息；控制臂只保留已发现候选的身份、明确屏蔽指标/百分位，继续使用相同 Planner、候选与报告工具、Reviewer、策略和预算。控制臂的报告将 `evidenceAvailability` 标为 `experimentally_withheld`，能力覆盖保持未评估；它不把屏蔽解释成来源缺字段或数值 0，也不能据此推荐候选。

固定男足 curated 快照并运行单个登记场景的三组配对：

```bash
mkdir -p .data/evaluations
TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- \
  --scenario barcelona-attacking-one-on-one-forward --compare-evidence-evaluator --runs 3 \
  > .data/evaluations/evidence-evaluator-one-on-one.json \
  2> .data/evaluations/evidence-evaluator-one-on-one.log
```

也可用 `--scenario all` 运行三种登记场景，每个场景仍要求至少三对。`curated` 仓库显式要求 `TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED=true` 才能将该 Wyscout 衍生数据交给本机模型；Harness 不会设置或修改这个权限，也不改写 `.env`。运行前应核实你已允许本次处理。未开启时，`--help` 与参数校验仍可用；有效评测命令会在读取数据快照或联系模型前给出简洁的闸门提示。对照次序按配对交错；两臂复用模型、快照、需求与补答脚本、知识库、整图和 Reviewer。

JSON 对每臂分别列普通 Harness 检查和实验计数，另列控制臂 `withheldContractPassRate`，检查控制组确实没有指标值、能力覆盖或无证据推荐。控制臂普通 Harness 检查按描述性结果保留，不把它与该臂的控制契约混为一谈。逐对摘要包含评估请求/结果数、请求能力指标覆盖、推荐与证据引用计数，以及评估之后的脱敏 Planner/工具轨迹；比较摘要不包含球员姓名或 ID。原始运行和完整轨迹若由调用方自行保存，应留在 Git 忽略的 `.data/evaluations/`。

如果开启臂没有返回与登记需求直接相关的指标，应报告该场景“未能观察到评估器机制”，不能把 Harness 通过率、推荐条数或指标键数量解释成能力判断。三对是探索性复跑，不是统计功效或长期稳定性证明。该消融验证的是证据构造及其在冻结 LangGraph 案件中的传递/缺失行为；真人球探标签收集前，候选排序质量仍为 `not_evaluable`。

2026-10-11，Qwen 3.5 9B 在 Wyscout 2017/18 curated 快照（SHA-256 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`）完成三组交错配对。开启臂 3/3 次通过 31/31 Harness 检查；每次评估 20 名候选、返回 194 个指标值，两个直接相关的一对一指标键均被观察到，报告 3 名推荐并引用 6 条证据。屏蔽臂 3/3 次通过显式无证据契约：零指标值、能力覆盖保持未评估、零推荐和零证据引用。其普通 Harness 每次为 29/31，失败的两项正是预期依赖能力证据的覆盖检查。每对的下游 Planner/工具轨迹相同。该冻结案例支持“评估器证据进入可见报告并支撑候选推荐”的行为结论；不证明推荐质量，三对也不足以推断普遍可靠性。原始 JSON 与日志仅保存在 Git 忽略目录 `.data/evaluations/evidence-evaluator-one-on-one-2026-10-11.{json,log}`。协议与完整限制见 [issue 153](../.scratch/tactiscout-mvp/issues/153-ablate-recruitment-evidence-evaluator.md)。

### 澄清互动消融

比较正常补答与“首次追问后不提供答案”的控制组，只允许选择单个已登记场景并固定 `curated` 数据快照：

```bash
mkdir -p .data/evaluations
TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- \
  --scenario bayern-kane-replacement --compare-interaction --runs 3 \
  > .data/evaluations/clarification-bayern.json \
  2> .data/evaluations/clarification-bayern.log
```

完整臂只在模型实际提出与预登记槽位匹配的问题后，才收到对应的脚本补答；职责问题和位置扩围许可分别核对。控制臂不接收任何脚本答案，在第一个用户可见的 LangGraph interrupt 处保持 `needs_input`。对清晰的巴萨 U23 中场请求，两臂都应不追问并完成报告；对拜仁替代者请求，完整臂应在观察数据后追问职责、同案恢复，并在中锋零命中后再询问是否扩围。执行顺序在配对重复间交错。

该实验改变的是用户补答是否可用，不是 `ask_user` Planner 策略的开关，也不是 LangGraph 与其他框架的对比。三对运行仅作冻结场景内的探索性机制检查；运行通过、安全暂停、工具数量和报告都不衡量球员排序质量或长期可靠性。原始 JSON/trace 可能包含本地候选 ID，留在 Git 忽略的 `.data/`；公开结果只记录去标识化的逐臂汇总。协议与结果见 [issue 136](../.scratch/tactiscout-mvp/issues/136-clarification-interaction-ablation.md)。

2026-10-10，Qwen 3.5 9B 在 Wyscout 2017/18 curated 快照（SHA-256 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`）上完成每场景三组配对运行。拜仁替代者场景中，脚本补答臂 3/3 次都提出两次意图匹配的澄清、同案恢复并完成报告（29/29 检查）；不提供答案臂 3/3 次都在首个职责问题处以 `needs_input` 安全暂停，没有补答、暂停后工具调用或报告（9/9 检查）。清晰的巴萨 U23 中场请求中，两臂均 3/3 次不追问、不消费答案并完成报告（各 31/31 检查）。共 12 次运行通过各自预注册 Harness。该结果只说明这两个冻结场景符合交互契约，不证明普遍追问策略、推荐排序质量或长期可靠性；不提供统计外推。原始细节留在忽略的本机 `.data/evaluations/clarification-{bayern,barcelona}-2026-10-10.json` 与日志。

### Understat 历史档案旁注消融

比较同一个 Understat 或 mosaic 已登记场景中，报告是否附加精确 Reep → Wyscout 历史样本：

```bash
mkdir -p .data/evaluations
TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED=true \
TACTISCOUT_WYSCOUT_HISTORICAL_LOCAL_RETENTION_ALLOWED=true \
TACTISCOUT_DATA_MODE=understat pnpm eval:local-agent -- \
  --scenario understat-five-league-xg-creation --compare-historical-archive --runs 3 \
  > .data/evaluations/historical-archive-understat.json \
  2> .data/evaluations/historical-archive-understat.log
```

示例把两项历史档案 opt-in 限定在本次命令中；不要为了运行实验改写 `.env`。Runner 会在模型请求前验证 Reep SQLite 索引可读，并加载本机 Wyscout 档案。每组三次交错执行开启臂和关闭臂。关闭臂只在建图时屏蔽报告展示开关，随后立即恢复原环境值。

成对汇总只包含数据范围、Reep release、样本/覆盖计数、脱敏 Planner/工具轨迹和各项一致性判断，不输出球员姓名或 ID。每对会比较候选评估数、当前证据覆盖、用户能力覆盖、推荐身份顺序、推荐证据键及工具轨迹；意外变化会列出。开启臂没有任何历史匹配时，配对标为 `no_historical_sample_observed`，不能称为验证了身份桥接。即使所有 Harness 检查通过，也不代表球员排序准确或历史表现能代表当前能力。

2026-10-11，Qwen 3.5 9B 完成三组交错配对：开启/关闭臂均 3/3 通过 Harness。每个开启臂检查 20 名已评估候选，14 名通过精确 Reep 身份映射，5 名找到历史记录，共 6 条 Wyscout 2017/18 样本；覆盖为 `partial`。三组中非历史报告、候选评估数量、证据覆盖、用户能力覆盖、推荐顺序、推荐证据和 Planner/tool 轨迹完全一致，没有其他差异。执行发现 Understat 联赛内身份键与 Reep 原始 ID 的适配不一致，现由明确的 provider identifier 暴露原始 ID；Harness 也已补上推荐卡历史样本的一致性核对。该结果只支持此冻结场景的精确身份与报告旁注机制，不证明球员排序、当前能力、转会适配或一般可靠性。合成整图测试仍验证历史姓名不会进入 Planner。原始结果保留在 Git 忽略的 `.data/evaluations/historical-archive-understat-verified.{json,log}`。协议与结果见 [issue 147](../.scratch/tactiscout-mvp/issues/147-ablate-historical-archive-sidecar.md)。

### 追问策略消融

比较正常追问/补答与禁用追问的安全控制臂：

```bash
mkdir -p .data/evaluations
TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- \
  --scenario bayern-kane-replacement --compare-ask-policy --runs 3 \
  > .data/evaluations/ask-policy-bayern.json \
  2> .data/evaluations/ask-policy-bayern.log
```

该开关位于整张 LangGraph 的追问边界，覆盖确定性策略门和 Planner `ask_user` 动作。当前拜仁场景的首个职责追问由确定性策略门发出；只禁用 Planner 动作会让对照臂仍然追问，无法回答实验问题。禁用臂只显示固定的“关键需求未解决”暂停说明，不显示模型生成的问题、不接收脚本补答、不猜测职责、不生成报告；正常臂使用场景登记且意图匹配的问题与答案。对清晰的巴萨 U23 中场需求，两臂都应无追问地完成。

两臂使用相同的模型配置、登记请求、curated 快照、知识库、Reviewer 与工具预算；运行顺序在配对间交错。该对照同时改变“能否澄清”和“是否收到回答”，所以不能把完整报告差异单独归因于问题措辞或 Planner；既有 `--compare-interaction` 才单独检查答案可用性与同案续跑。结果只描述冻结场景内的 Harness 行为，不证明球员排序质量或一般追问策略优越性。详细协议与运行结果见 [issue 138](../.scratch/tactiscout-mvp/issues/138-ask-user-policy-ablation.md)。

2026-10-10 实测：本机 Qwen 3.5 9B、Wyscout 2017/18 curated 快照（SHA-256 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`），两个场景各运行三组配对，共 12 次完整图运行。拜仁接班人场景中，正常臂 3/3 次完成两次意图匹配澄清、同案恢复和报告（各 29/29 Harness 检查）；禁问臂 3/3 次均在观察到两项工具结果后，以固定未解决说明安全暂停（各 7/7），每次只抑制一个追问决策、没有脚本答案、后续动作或报告。端到端 p50/p95 为 68.579/134.463 秒与 18.061/19.620 秒；禁问臂更早暂停，二者耗时不可直接归因于策略效率。

清晰的巴萨 U23 中场场景中，两臂均 3/3 次零追问、零补答、完成报告且通过全部 31 项检查；每次各调用 6 个工具。端到端 p50/p95 为 104.580/185.704 秒与 101.634/101.944 秒。清晰请求未观察到禁问策略造成阻塞；样本只有三对，模型请求延迟波动，不据此推断性能或普遍误抑制率。报告质量和候选排序仍未评估。原始 JSON 与 trace 留在忽略的 `.data/evaluations/ask-policy-{bayern,barcelona}.json`。

### 证据复核门消融

当前 `review_recommendation` 是确定性证据门：对齐推荐引用、检查结论，必要时要求 Planner 补查一次，仍有缺口时收窄名单。它不是另一个 LLM Agent。为单独观察这道门对 Harness 结果的贡献，可在相同 curated 场景中配对运行默认图与旁路图：

```bash
mkdir -p .data/evaluations
TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- \
  --scenario bayern-kane-replacement --compare-reviewer --runs 3 \
  > .data/evaluations/reviewer-ablation.json
```

每一对复用同一登记需求/补答、模型配置、curated 仓库、知识库与工具预算；两个 graph 使用独立 thread，模型服务不保证共享随机种子。旁路臂只跳过证据对齐与结论检查，继续经过 Planner、数据工具、追问/恢复和后置 enrichment。JSON 对比逐次显示 Harness 检查、用时、推荐条数、引用条数和复核结果；报告明细仍可能含本地球员 ID，输出应留在 `.data/`，不要提交。复核 trace 只保留耗时、问题数、修复引用数和结果枚举，不保留问题原文或球员身份。

比较输出会记录候选数据快照的 SHA-256。`allPassed` 表示默认完整臂是否通过，`ablationAllPassed` 独立表示旁路臂是否通过；旁路检查失败仍会留在逐臂结果中，命令退出状态由默认臂决定。

将结果解释为该模型、该场景与当前数据快照上的探索性机制检查。通过率、候选数量或引用数量都不表示名单排序质量；真人双评与匿名裁决前，短名单质量仍为 `not_evaluable`。三对运行只用于暴露明显差异或波动，不提供通用的统计结论。

2026-10-10 首批配对结果：Qwen 3.5 9B、Wyscout 2017/18 curated 快照、拜仁凯恩场景各运行 3 次。完整臂 3/3 均为 29/29 检查通过；旁路臂 0/3 全通过，唯一失败项均为 `requestedCapabilitiesAreGrounded`。三对中的 Planner 决策与工具轨迹、最终推荐球员集合完全相同；完整臂每次由复核修复 1 条证据引用，报告有 2 条 focus evidence 引用；旁路臂各有 1 条。观察到的端到端 p50/p95 分别为 75.543/179.112 秒与 72.790/78.317 秒；一次完整臂运行耗时 179 秒，样本太小且 Planner 请求耗时波动较大，不能据此判断延迟差异。此结果只支持当前场景中证据引用修复这一行为贡献，不涉及推荐质量。

2026-10-10 第二场景配对结果（[issue 134](../.scratch/tactiscout-mvp/issues/134-cross-scenario-reviewer-ablation.md)）：Qwen 3.5 9B、同一份 Wyscout 2017/18 curated 快照（SHA-256 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`），巴萨 U23 中场场景各运行 3 次。完整臂与旁路臂均为 3/3 通过全部 30 项 Harness 检查；逐对 Planner/工具 trace、最终推荐集合及候选评估数相同（每次评估 20 人、推荐 3 人、引用 6 条）。六次执行都没有 `ask_user`，直接完成报告；这只描述本条明确写出位置、年龄和能力要求的请求，不估计一般追问策略质量。完整 Reviewer 每次 `passed`，问题数和修复引用数均为 0；旁路没有出现不同的名单或证据引用。因此前一场景的“修复缺失引用”效果没有在本场景复现，观察到的是报告本已通过证据检查时 Reviewer 不改变结果；三对中没有观察到误抑制，但样本不足以估计误抑制率。端到端 p50/p95 为 116.435/176.538 秒与 112.233/118.808 秒，受小样本及 Planner 延迟波动影响，不作延迟归因。两种场景合起来说明目前只观察到一类特定证据修复和一个无修复对照，不验证推荐质量，也不证明 Reviewer 对其他任务的普遍效果。

### Harness 延迟拆分

重复运行的 scenario summary 除整轮 `latencyMs` 外，还按 Planner 动作和已执行工具提供 `operationLatencyMs`：每项含事件样本数及 nearest-rank p50/p95。样本数是动作/工具事件数，不是 run 数；`policy_decision` 不进入结果。若策略覆盖了 Planner 提案，模型耗时按提案动作归类；确定性策略单独选择的动作不计入 Planner。无法解析动作或 Planner 走回退路径时记作 `unresolved`。排序固定按操作类型和名称，操作名必须是已知动作，耗时必须为有限非负数。

这里的 Planner 数值表示从进入规划步骤到发出决策 trace 的时长，包含模型请求/响应处理、动作解析及本地约束检查，不是模型服务端纯推理耗时。工具数值表示单次工具执行时长。操作耗时用于解释端到端等待，不能相加替代整轮 wall time；p95 是观测样本的 nearest-rank 统计，小样本下只描述本机运行。

同一 curated/Wyscout 2017/18 数据模式、本机 Qwen 3.5 9B 的拜仁凯恩场景重复三次，29/29 行为检查各自通过。将这三次已有的本地安全 trace 用新汇总函数重算后：端到端用时 p50/p95 为 64,953/164,455 ms；操作细分如下（所有数值均为毫秒）：

| 类别 | 操作 | 样本数 | p50 | p95 |
| --- | --- | ---: | ---: | ---: |
| Planner | `finish` | 3 | 25,059 | 68,813 |
| Planner | `search_candidates` | 9 | 10,531 | 27,755 |
| Planner | `search_methodology` | 3 | 7,530 | 28,814 |
| 工具 | `evaluate_candidates` | 9 | 9 | 32 |
| 工具 | `search_candidates` | 9 | 2 | 291 |
| 工具 | `search_methodology` | 3 | 95 | 1,405 |
| 工具 | `search_player_reports` | 9 | 3 | 8 |

这组样本显示等待主要出现在 Planner 决策；方法检索也有一次 1.405 秒的工具耗时，不能概括成所有工具都只有几十毫秒。之后一次真实 CLI 整链运行 29/29 通过，用时 200.443 秒，summary 确实包含上述操作维度；该单次观察中的 `finish` Planner 决策为 87.116 秒。三次数据是从本机保存的原始 trace 重新聚合，单次 CLI 运行用于验证新输出路径；结果不代表长期性能，也不验证候选推荐质量。LangSmith/OpenTelemetry 的观测边界与术语核对见[本地研究记录](../.scratch/tactiscout-mvp/research/agent-action-latency-observability-2026-10.md)。

## 方法 RAG 来源级基准

已有本地方法资料索引后，可运行：

```bash
pnpm eval:methodology-rag
pnpm eval:methodology-rag:v3
```

v2 是 34 条查询、两篇来源的不可变数据集；v3 是三来源的 10 条校准/留出集。它使用固定 multilingual E5 embedding，不调用 LLM、不访问远程 embedding 或抓取文章。当前结果只反映项目作者标注的固定中文查询，不能外推为线上用户分布或一般 RAG 质量。校准阈值、逐条结果和局限见 [issue 105](../.scratch/tactiscout-mvp/issues/105-methodology-rag-retrieval-benchmark.md) 与 [issue 106](../.scratch/tactiscout-mvp/issues/106-methodology-rag-abstention-threshold.md)。

### 方法 RAG Agent 整图消融

用整张 LangGraph 对照方法语料可用与不可用，而不是单独测 Retriever：

```bash
mkdir -p .data/evaluations
TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- \
  --scenario bayern-kane-replacement --compare-methodology-rag --runs 3 \
  > .data/evaluations/methodology-rag-agent-ablation.json \
  2> .data/evaluations/methodology-rag-agent-ablation.log
```

三组配对运行固定本地 Qwen 3.5 9B、需求与补答、Wyscout 2017/18 curated 快照、LangGraph 策略、Reviewer 和工具预算，并交错执行顺序。消融臂只屏蔽 `methodology` 语料的检索结果；球员报告语料和其余工具仍照常工作。原始 JSON/trace 留在 Git 忽略的 `.data/` 中，不应提交。

2026-10-10 实测：使用 SHA-256 为 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f` 的快照，六次整图运行都完成并通过 29/29 Harness 检查。方法语料可用的三次运行每次都由一次检索返回 2 个片段、1 个来源，最终报告包含这 2 个片段和该来源；报告引用均能对应到本次检索返回的来源。屏蔽方法语料的三次运行均检索到 0 个片段/来源，报告也没有方法来源引用。两臂的来源校验均通过；三对运行在剔除方法检索事件和耗时后，非方法工具轨迹与候选顺序一致。

这证明方法证据在该冻结场景中经过检索进入了报告，并保留来源约束；没有观察到它改变决策轨迹或候选排序。实验只有一个场景、一个本地模型和三组配对，不能证明 RAG 普遍提升推荐质量，也不测量球员排序质量。协议与逐项边界见 [issue 142](../.scratch/tactiscout-mvp/issues/142-methodology-rag-agent-ablation.md)；脱敏摘要展示在项目的 `/showcase` 页面，组件源码见 [ShowcaseMethodologyRagAblation.tsx](../web/src/ShowcaseMethodologyRagAblation.tsx)。

### 动态调查规划消融

该实验只在同一张 LangGraph 内对比动态调查与预先冻结的单页流程，不比较 LangGraph 与其他框架：

```bash
mkdir -p .data/evaluations
TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- \
  --scenario bayern-kane-replacement --compare-investigation-planning --runs 3 \
  > .data/evaluations/investigation-planning-ablation.json \
  2> .data/evaluations/investigation-planning-ablation.log
```

固定臂对所有案件使用同一条通用方法检索，然后只主动请求一页候选；若用户后来确认了具体位置或同意改变范围，图可以强制按新约束重查一次。其后的批量评估、球员报告检索、必要追问与恢复、Reviewer 和报告生成都由同一张图处理。两个臂都用同一个模型综合报告，区别是调查阶段由模型动态选动作，还是执行冻结的单页规则。运行顺序按配对轮次交错。CLI 仅接受单个登记场景和 `curated` 快照，并拒绝自定义需求、答案和其他消融开关。

摘要逐次报告 Harness 检查、Planner 调度次数、工具数、耗时、评估候选数、能力证据覆盖及报告结果。历史 `plannerRequestAttempts` 在调用模型 Planner 的 `decide()` 时递增：结论生成会计入，固定臂直接返回的规则动作不会计入；它发生在进入 `invoke()` 前，不能替代实际调用账本。下方 2026-10-11 新运行已在模型 `invoke()` 边界独立记录真实 provider usage；更早的 2026-10-10 运行没有这些数据，也不会回填。不同策略的上下文和生成内容不同，因此 token 总量不构成成本匹配；耗时也只作描述。这是针对冻结案例的探索性机制检查，不证明推荐排序准确、一般规划能力或 LangGraph 框架优越性。对照流程与无泄漏边界见 [issue 143](../.scratch/tactiscout-mvp/issues/143-dynamic-investigation-planner-ablation.md)，协议研究见[动态规划消融研究](../.scratch/tactiscout-mvp/research/dynamic-planning-vs-fixed-workflow-ablation-2026-10-10.md)。实测结果和边界见下文。

2026-10-10 实测：Qwen 3.5 9B、同一份 Wyscout 2017/18 curated 快照（SHA-256 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`），两个场景各三组配对，共 12 次整图运行，全部通过各自 Harness 检查。巴萨 U23 中场场景每臂 3/3 通过 31 项检查，均评估 20 人、调用 6 个工具；动态臂平均有 3 次模型 Planner 调度尝试并推荐 3 人，固定臂有 1 次并推荐 1 人。拜仁凯恩替代者场景每臂 3/3 通过 29 项检查，均在同案回答两次澄清、评估 30 人、调用 10 个工具，并推荐 1 人；动态臂平均有 5 次调度尝试，固定臂有 3 次。巴萨场景推进证据覆盖 20/20 人，压迫数据缺失；拜仁场景进球产出和创造机会覆盖 30/30 人，射门终结和进攻接应数据缺失。

这些差异显示，冻结样例中的行动策略会改变模型 Planner 调度尝试数和报告名单条数；Harness 通过不等于球探结论正确。四组臂各只有三次运行，模型端不保证共享随机种子，延迟分位数只作本机观察；当前也没有可信的排名标签或 token 总量记账，不能判断哪一臂推荐更准确或成本效率更高。脱敏汇总留在本节，带本地球员 ID 的原始 JSON 和运行日志保存在 Git 忽略目录 `.data/evaluations/investigation-planning-{barcelona,bayern}.{json,log}`。

本机 wall-time p50/p95：巴萨动态臂 110.935/208.257 秒，固定臂 70.939/82.957 秒；拜仁动态臂 81.883/242.391 秒，固定臂 67.527/180.369 秒。样本仅三组且模型响应变异明显，不从该数值推断策略本身的延迟优势。

2026-10-11，加入 Planner 实际调用边界的 token usage 账本后，在同一 Qwen 3.5 9B、curated/Wyscout 2017/18 快照（SHA-256 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`）重新运行两场景、各三组配对。巴萨两臂均 3/3 次通过 31/31 检查；拜仁两臂均 3/3 次通过 29/29 检查。拜仁首次诊断运行发现能力覆盖按 30 条已评估来源记录计数，而报告样本按 29 个候选身份组计数；现已修正覆盖分母为已评估身份组，同时仍逐条保留来源证据，不合并指标值或评分。修正后的三组复跑中，六次拜仁报告的候选覆盖均为 29，与报告候选分母一致。

| 场景 | 调查策略 | Harness 通过 | 实际 Planner 请求 | 输入 tokens | 输出 tokens | 总 tokens | wall-time p50/p95 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 巴萨 U23 中场 | 动态 | 3/3（31/31） | 9 | 26,118 | 1,515 | 27,633 | 37.897/89.554 秒 |
| 巴萨 U23 中场 | 单页固定 | 3/3（31/31） | 3 | 2,139 | 1,206 | 3,345 | 29.529/30.397 秒 |
| 拜仁凯恩替代者 | 动态 | 3/3（29/29） | 15 | 34,812 | 1,977 | 36,789 | 64.128/66.016 秒 |
| 拜仁凯恩替代者 | 单页固定 | 3/3（29/29） | 9 | 18,450 | 1,578 | 20,028 | 36.776/45.481 秒 |

36 次实际 Planner 调用均返回响应；输入、输出和总量字段分别在每次调用中全部有值，覆盖状态均为 `complete`。这与早期的 `plannerRequestAttempts` 调度计数不同：本表来自调用模型 `invoke()` 后的 provider usage。该历史 Harness 从 `conversation.turn()` 开始，只测量 LangGraph Planner；当时的独立需求解析 API 不在运行路径中，且现已在 issue 156 退役。模型明确上报 0 时保留为零，缺字段时不会推算。动态臂在这两个冻结案例中请求更多 Planner 次数并观察到更多总 tokens，但两臂请求上下文和生成内容不同，因此这不是 token 匹配实验，也不能说明哪个策略更准确或更具成本效益；token 数也不是金额估算。延迟是三次本机运行的描述性 p50/p95。完整脱敏汇总可由本地忽略文件 `.data/evaluations/investigation-planning-{barcelona,bayern}-usage-2026-10-11.json` 查看，原始 trace 仅保存在对应 `.log` 文件。

## 球员短名单质量评测

运行本地离线评测器：

```bash
pnpm eval:shortlist-quality
pnpm eval:shortlist-quality path/to/shortlist-evaluation.json
```

不传文件时读取空模板并输出 `not_evaluable`，不会伪造零分。输入按 query 固定候选池、来源快照元数据、系统排名、每位候选的独立评审分数与单独裁决。候选适配标签使用 0–3 或 `unknown`；每名候选必须至少有两个不同 `reviewerId` 的判断，并有 0–3 裁决，整条 query 才能计算 nDCG@5。评测器采用分级增益 `2^grade−1`、位置折损 `log2(rank+1)`，逐 query/系统报告；若有未双评候选、unknown/缺失裁决、快照字段不全，或全池裁决均为 0，nDCG 保持 `null`。

原始类别 pairwise agreement 按同一候选上所有无序评审配对统计；`unknown`/`unknown` 与数值/数值同为完全类别匹配，但只有两边均为数值评分的配对参与单独报告的 0–3 数值等级一致率。`unknown`/`unknown` 与 unknown/数值配对另行计数。所有这些比例只描述本批判断，不能证明评审者真实身份独立、量表可靠或推荐准确。评测器校验输入中声明的 SHA-256 格式和快照引用，但不会读取/重算上游数据文件；实际快照文件哈希核对与盲评卡导出见 [issue 120](../.scratch/tactiscout-mvp/issues/120-export-blinded-shortlist-review-packets.md)。

当前仓库只有空模板，尚未收集球员适配判断，因此没有可报告的 nDCG 或推荐质量分数。公开球探评分、青年选拔排序和 rubric 研究均不提供可直接复算的成年职业转会 query-specific qrels；审计结论见 [公开球探判断数据审计](../.scratch/tactiscout-mvp/research/public-scout-judgment-dataset-search-2026-10-11.md)。基准约束与后续标注边界见 [issue 119](../.scratch/tactiscout-mvp/issues/119-human-labeled-shortlist-benchmark.md) 和 [评测协议](../.scratch/tactiscout-mvp/research/scouting-recommendation-evaluation-protocol-2026-10-06.md)。

### 从真实 Harness 运行导出盲评包

#### 巴萨 U23 前锋：历史进攻地面对抗样本

2026-10-10 使用 Qwen 3.5 9B 和冻结的 Wyscout 2017/18 v2 快照运行 `barcelona-attacking-one-on-one-forward`。LangGraph Harness 的 **31/31 行为检查通过**；完整运行包含 7 次决策、6 次工具调用和 29 条进度事件，无 Planner fallback。共评估 20 名候选，报告实际推荐 3 人。此结果验证该次调查链路与证据契约，不代表排名质量或当前引援市场覆盖。

快照文件 SHA-256 为 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`。盲评上下文只请求两项直接匹配该历史角色的证据：地面进攻对抗每 90 分钟频次，以及按 `703 / (701 + 702 + 703)` 派生的明确胜出占比。20/20 张卡都有频次；明确胜出占比在 18 张卡有值，另外 2 张因没有可分类结果而标为 `unknown`，不能当成零。官方资料将该事件定义为地面进攻对抗，不等同于过人尝试；派生占比也不同于 Wyscout 独立的 `Successful` 口径。[Wyscout 事件文档](https://support.wyscout.com/matches-wyid-events) · [指标和数据集边界研究](../.scratch/tactiscout-mvp/research/attacking-one-on-one-evaluation-evidence-2026-10.md)

可用下面的命令复跑 Harness；审阅上下文模板固定在仓库中，运行输出、身份答案键和匿名包均留在 Git 忽略的 `.data/`：

```bash
mkdir -p .data/evaluations
TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario barcelona-attacking-one-on-one-forward \
  > .data/evaluations/barcelona-one-on-one-run.json

pnpm export:shortlist-review -- \
  --snapshot .data/tactiscout-datasets/tactiscout-wyscout-v1-401a88b80cc2-tactiscout-wyscout-events-v2.json \
  --evaluation .data/evaluations/barcelona-one-on-one-run.json \
  --review-context data/evaluations/barcelona-attacking-one-on-one-review-context.json \
  --reviewer-packet .data/evaluations/barcelona-one-on-one-blind-packet.json \
  --answer-key .data/evaluations/barcelona-one-on-one-answer-key.json
```

已生成的本机数据包有 20 张卡与 20 条表现记录，答案键只为报告实际列出的 3 人记录名次；其余评估候选保持未排名。结构校验确认匿名包不含球员/球队身份、模型身份或排名，且包与答案键为独立文件、权限为 `0600`。尚未录入任何人类评分；独立双人评分、裁决与答案键解锁仍未完成，所以 nDCG 和推荐质量仍为 `not_evaluable`。Wyscout 快照只覆盖 2017/18 等历史赛事，不是当前球员池；这份样本仅适合历史、单一职责的证据评审。

对本地 Wyscout/curated 数据运行并将 JSON 留在 Git 忽略的 `.data/`：

```bash
mkdir -p .data/evaluations
TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario barcelona-under-23-midfielder \
  > .data/evaluations/barcelona-midfielder-run.json
```

复制 [评审上下文模板](../data/evaluations/harness-review-context.template.json)，填写固定需求说明与实际希望评审的指标，然后运行：

```bash
pnpm export:shortlist-review -- \
  --snapshot .data/tactiscout-datasets/latest.json \
  --evaluation .data/evaluations/barcelona-midfielder-run.json \
  --review-context .data/evaluations/barcelona-midfielder-review-context.json \
  --reviewer-packet .data/evaluations/barcelona-midfielder-blind-packet.json \
  --answer-key .data/evaluations/barcelona-midfielder-answer-key.json
```

导出器只接受当前 schema 且全部检查通过的单次运行；它从成功的 `evaluate_candidates` 轨迹组成冻结候选池，从报告的实际推荐顺序形成排名，并逐一确认这些球员 ID 存在于快照。若 Wyscout 将同一球员拆成多支球队记录，schema v2 匿名包将这些来源行归为一张球员卡，每段比赛表现仍分开显示，不合并指标或样本量。系统没有排名的已评估候选仍会出现在匿名卡中，但答案键中的 system rank 为空；不会根据指标或报告文字替它们补排名。评审包和含身份/排名的答案键分别以仅当前用户可读的权限新建，已有文件会拒绝覆盖。

评审上下文和真实模型输出可能包含不适合公开的信息；默认应放在 `.data/`，不要提交。通过 Harness 只表示该次运行符合行为检查，不代表推荐排序质量；nDCG 仍需完整候选池的独立双人评审和裁决标签。

## 匿名候选证据卡

有一份已冻结的 Wyscout 快照、候选 ID 池和系统排序后，可离线导出独立评审包和答案键：

```bash
mkdir -p .scratch/tactiscout-mvp/reviews
pnpm export:shortlist-review -- \
  --snapshot .data/tactiscout-datasets/snapshot.json \
  --request .scratch/tactiscout-mvp/reviews/review-request.json \
  --reviewer-packet .scratch/tactiscout-mvp/reviews/reviewer-packet.json \
  --answer-key .scratch/tactiscout-mvp/reviews/answer-key.json
```

请求 JSON 固定 `queryId`、盲评用 `roleBrief`、按原始快照文件字节计算的 `snapshotSha256`、完整 `candidateIds`、该职责要看的 `metricKeys`，以及每个系统/运行的有序候选 ID。使用 `shasum -a 256 .data/tactiscout-datasets/snapshot.json` 取得快照哈希，再把 hash 和来源记录中的候选 ID/系统排名写入本地请求文件。导出器会重新计算并核对快照哈希，从本地数据仓库读取球员证据；不调用模型或数据源。答案键只由本地 CLI 单独写出，使用随机密钥生成卡片编号；评审文件和答案键都以仅当前用户可读写权限创建，已有目标文件时拒绝覆盖。

请求文件结构如下。`candidateIds` 是冻结的评审候选池；各系统排序只写自己实际排名的候选，并按名次顺序排列。所有 ID 必须来自同一份快照，不能从最终报告补全未观察到的候选或指标。

```json
{
  "queryId": "barcelona-progressive-midfielder-v1",
  "roleBrief": "为巴萨寻找具备向前推进能力的中场。按历史 Wyscout 快照评审，不判断当前效力或转会可行性。",
  "snapshotSha256": "replace-with-64-character-file-sha256",
  "candidateIds": ["snapshot-player-id-1", "snapshot-player-id-2"],
  "metricKeys": ["progressivePasses"],
  "systemRankings": [
    {
      "systemId": "tactiscout-qwen-run-1",
      "runId": "frozen-run-1",
      "candidateIds": ["snapshot-player-id-2", "snapshot-player-id-1"]
    }
  ]
}
```

评审包保留来源、许可证、数据集 ID、快照哈希、as-of 时间、派生规则、宽位置、年龄/缺失、赛事/赛季、样本分钟/场次以及每项请求指标的值/单位/定义/来源字段。没有观测到的属性保留为 `missing` 和 `null`，不会填零；若同一指标只在部分候选上有数据，缺失卡仍显示快照内一致的指标定义，但不借用其他候选的样本量。球员姓名、球员/球队 ID、球队名、系统标识和名次只出现在答案键。指标组合仍可能让知情读者推测身份，因此这属于去标识化，不是无法重识别的匿名数据。

把评审文件单独交给两名评审者，各自填写 0–3 或 `unknown`。先保存并锁定全部独立评分，再由第三位评审/共识流程记录裁决；锁定后才允许打开答案键核对身份/排名并合并。保留快照、评审包、答案键和标签文件的本地访问控制，不把私有答案键提交到公开仓库。当前项目没有真实人工标签，也没有生成任何候选判断。

评审包、`/review` 和 `/adjudicate` 使用同一组锚点：**0** = 有充分直接证据明确不符合冻结职责或违反明确硬条件；**1** = 证据较弱或只部分吻合；**2** = 有合理来源证据支持本次职责；**3** = 来源证据对点名能力/职责提供强而直接的支持；**`unknown`** = 缺字段、样本不足、指标不对应或证据含糊，无法判断。缺失本身不能判 0。该量表是尚未校准的项目约定，不是球员能力真值，也不应由单个统计值自动换算。评测器的 `2^grade−1` 增益映射进一步假定等级效用呈指数递增；任何 nDCG 解释都应披露这一假设。[领域术语](../CONTEXT.md#评估) · [ADR 0008](adr/0008-human-shortlist-judgments.md) · [issue 140](../.scratch/tactiscout-mvp/issues/140-surface-shortlist-fit-rating-anchors.md)

导出字段、离线接口、匿名边界和验证范围见 [issue 120](../.scratch/tactiscout-mvp/issues/120-export-blinded-shortlist-review-packets.md)。

### 在本地工作台录入独立评分

启动 Web 应用后打开 `http://127.0.0.1:5173/review`，无需配置 LLM、API 服务或联网。选择导出的 `*-blind-packet.json`，输入一个不含姓名或邮箱的评审代号，然后逐张查看匿名证据卡。每张卡对当前职责的适配度选择 0–3，证据不足以判断时选择“未知”；“未知”代表未能判断，不等同于 0 分。提交前所有卡都必须有数值或“未知”选择。

工作台每次只展示一张卡，保留职责说明、来源/许可/快照信息、可观测字段及缺失项；球员/球队身份、系统名次、模型解释和答案键不导入。评分草稿和评审包保存在当前浏览器配置的 localStorage 中，按评审包与评审代号隔离，并可刷新后继续。完成后下载只含 benchmark/packet/reviewer 标识、匿名卡 ID 和评分的 JSON。该提交本身不是 nDCG 结果，也不证明评审者身份独立；所有独立提交完成后，可导入 `/adjudicate` 进行匿名裁决和质量评测。

每名评审者应使用自己的评审代号和独立浏览器配置，各自导出完整评分后再进入裁决阶段。裁决者在 `/adjudicate` 导入原始匿名评审包和至少两份不同评审代号的完整提交，逐张裁决；所有裁决锁定后，页面才允许载入答案键并计算 nDCG。软件不能验证评审者身份是否独立，也不能阻止用户在流程外提前查看答案键。浏览器草稿清除功能只清除当前包与当前评审代号对应的本机草稿。

具体实现和人工浏览器验证范围见 [issue 123](../.scratch/tactiscout-mvp/issues/123-local-blinded-review-workbench.md)。

### 盲态裁决与质量评测

在所有评审者分别导出并锁定提交后，打开 `http://127.0.0.1:5173/adjudicate`。选择原始匿名评审包及至少两份不同评审代号的完整评分文件。工作台在盲态显示来源证据和各位评审对当前卡片的原始评分；由裁决者为每张卡单独选择 0–3 或 `unknown`，不自动平均或多数表决。未知/证据冲突仍可裁决为 `unknown`，此时完整候选池不会被伪装成可计算 nDCG。

全部裁决锁定后，页面才允许载入单独保存的答案键。组装函数验证包 ID、快照哈希、候选卡覆盖、不同评审代号和裁决完整性，并把匿名 `cardId` 同时作为评测候选 ID 与系统排序 ID；导出的质量评测输入不会包含球员姓名、球队或来源球员 ID。页面计算当前 query 的 nDCG@5，并允许分别下载可复算的评测输入和结果。下载的输入可再次通过 `pnpm eval:shortlist-quality path/to/evaluation.json` 复算。

一致性报告把所有评分类别的原始完全一致率、仅数值 0–3 评分之间的一致率、双方均 unknown 和 unknown/数值混合对分开呈现；展开后还会显示每位评审的 0–3/unknown 频数，以及逐评审对的数值 4×4 交叉表和同分、相差一档、相差两档以上的数量。unknown 配对不进入数值交叉表或等级差距计数。以上均为固定 query 的描述性统计，不等同 weighted Cohen κ、Krippendorff α 或可靠性证明；等级差距只是有序档位的计数，不代表等距的能力差异。即使 nDCG 可计算，它也只描述固定 query、完整候选池与快照，不代表通用推荐准确率。答案键加载与排序揭示发生在裁决锁定之后，但本地 UI 不能证明评审者身份独立或阻止用户提前另行查看答案键。

裁决流程、de-identified 评测输入和限制见 [issue 124](../.scratch/tactiscout-mvp/issues/124-close-the-human-shortlist-evaluation-loop.md) 与[评审方法研究](../.scratch/tactiscout-mvp/research/human-shortlist-rating-adjudication-methods-2026-10.md)。

### 精确身份分组的 LangGraph 对照

用同一份四条来源记录、同一 Planner 提案、同一仓库和同一张 `createRecruitmentConversation` 图，配对运行启用精确 Reep resolver 与不提供 resolver 的对照臂。启用臂将其中两条具有相同合成 Reep ID 的来源记录归为一个身份组；Reviewer 拒绝重复提名后，Planner 重报一条已解析候选和两条无映射候选，共 3 条考察线索、4 条独立来源记录。另两条分隔符 ID 碰撞但无映射的记录仍各自成组，并保留为 2 个同来源 peer 样本。对照臂没有身份解析，四条来源记录均作为独立候选，Reviewer 接受 Planner 的 4 条提名。

此对照确认 LangGraph 报告链路只有在 resolver 提供精确身份时才阻止重复提名；它不证明 Reep live bridge 覆盖、真实球员映射正确性或推荐排序质量。测试用的 bridge 是合成夹具，单次确定性对照也不代表模型行为稳定性。完整接口测试见 [issue 39](../.scratch/tactiscout-mvp/issues/39-layered-player-evidence.md)。

## 评估边界

- **Agent 行为：**当前场景对指定状态转移、工具证据、追问和报告契约通过/失败。
- **RAG 来源检索：**固定来源与固定查询上的检索 smoke；目前没有足够标注证明一般相关性或答案忠实度。
- **球员推荐：**匿名评审、裁决和 nDCG 的本地工作流已具备；仓库仍没有真实的独立人工标签，因此现阶段实际结果仍为 `not_evaluable`，不报告 NDCG、Top-k 命中率或推荐准确率。

要了解候选排序标签的设计和所需人工标注，见[推荐评估协议](../.scratch/tactiscout-mvp/research/scouting-recommendation-evaluation-protocol-2026-10-06.md)。
