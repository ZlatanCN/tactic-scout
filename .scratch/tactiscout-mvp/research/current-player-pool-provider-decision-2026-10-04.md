# 当前球员池数据源：官方资料决策复核

核查日期：2026-10-04。仅查阅各服务方/数据发布方官方页面、API 文档和条款；没有使用任何账户密钥或抓取受限内容。价格、覆盖和条款可能变更，本结论不替代具体账户 entitlement 或书面许可。

## 决策

**当前球员池主源优先继续走 Sportmonks，但先做受控联调，不直接开启模型处理。**它是四个商业 API 里唯一同时明确提供当前球队阵容、逐球员赛季/比赛表现和应用内展示/缓存权限的选项；仓库已有 adapter。要覆盖拜仁、巴萨等用户目标，免费版不够，Starter 当前为月付 €29，可选 5 个联赛。Sportmonks 没有在查阅的公开页面明确授权将比赛数据送入本地或托管 LLM，所以启用项目中的 AI 处理开关前应取得书面答复。[免费联赛范围](https://www.sportmonks.com/football-api/free-plan/) · [套餐价格和限额](https://www.sportmonks.com/football-api/plans-pricing/) · [数据用途说明](https://www.sportmonks.com/integrity-support/) · [服务条款](https://www.sportmonks.com/terms-of-service/)

建议下一步：先书面确认“本地 Ollama 对球员统计做推理/生成报告”是否属于许可用途；确认后，用自己的 token 对五大联赛套餐做一次不持久化的当前赛季 smoke，记录各联赛实际 squad、球员数、指标空值和抓取时间，再决定是否保留订阅。Starter 每小时每实体 2,000 次；免费方案仅丹麦 Superliga、苏格兰 Premiership。14 天试用要求银行卡，试用期内不取消会自动扣费，不要把它当作无条件免费验证。[Sportmonks 试用条款](https://www.sportmonks.com/terms-of-service/)

## 候选对比

| 来源 | 可用于候选与能力评估的数据 / 时效 | 价格与配额 | 展示、留存、模型处理边界 | 判断 |
|---|---|---|---|---|
| **Sportmonks** | 当前 squad、球员档案、赛季和逐场表现；官方展示的英超比赛响应含 63 类球员统计，如分钟、触球、前场三区传球、传球准确率、关键传球、盘带、对抗、空中球、解围、抢断、射门、进球、助攻和评分。统计种类按联赛/比赛而异；官方称直播事件平均约 15 秒到达，但没有承诺当前名单/赛季统计更新 SLA。[统计字段](https://www.sportmonks.com/football-api/football-stats-api/) | 免费仅丹麦与苏格兰两项联赛；Starter 月付 €29 / 年付折算 €24 每月，任选 5 个联赛、每实体每小时 2,000 次。xG、Pressure Index 等是附加指标，不应假设包含在 Starter。[价格](https://www.sportmonks.com/football-api/plans-pricing/) | 条款和合规页明确允许在自有产品中存储、缓存和展示数据，也允许基于数据构建应用；禁止未经批准转售数据。**未找到 LLM/AI 输入许可条款**，因此不能把“可在产品展示”自动解释为“可发送给模型”。Sportmonks 自称数据提供方而非赛事权利方，且不保证完整准确；球员照片、队徽另有权利要求。[用途说明](https://www.sportmonks.com/integrity-support/) · [条款](https://www.sportmonks.com/terms-of-service/) | **最适合做真实当前球员池的工程主源**，但需承担订阅费用、按账号验证覆盖，并确认 AI 用途。 |
| **API-Football** | `/players?league&season` 有年龄、国籍、位置/档案及出场、分钟、进球、助攻、射门、传球/关键传球/准确率、抢断、盘带、犯规、牌和点球；每页 20 人。高级战术指标有限。Free 只说可用赛季受限，公开资料没有确认 2026/27 免费账户覆盖；官方文档的更新频率也不保证。[球员端点](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) · [条款](https://www.api-football.com/terms) | $0、100 次/日；覆盖目录列出很多联赛，但免费赛季另有限制。英超 500+ 人要超过 25 页请求，此外还需查询覆盖和球队等。[价格](https://www.api-football.com/pricing/) | 条款明确要求使用者自行取得在自己产品发布数据所需许可，API-Football 不授予赛事商业权利；未找到公开的本地长期保存或模型处理许可。短时 smoke 可验证技术可达性，**不能证明公开作品集可展示**。[条款](https://www.api-football.com/terms) | 不作为公开 demo 默认源；继续现有本地 smoke 仅能检查账户覆盖，不解决发布权。 |
| **PlayerElo** | 官方称 79K+ 球员、176 项赛事，页面每日更新；可取 Elo、位置、当前球队/联赛、比赛数/分钟、EAR 近期/生涯信号、趋势和 per-90 风格画像，也有球队 squad、位置深度、transfer-fit 接口。[API 概览](https://playerelo.football/api-access) · [API 文档](https://playerelo.football/docs) | Free €0，500 次/月、10 次/分，标为 evaluation/hobby；Pro €19/月，10,000 次/月，标为生产 app/dashboard；Business €199/月才列有 commercial licence 与 SLA。[计划](https://playerelo.football/api-access) | 可作为宽覆盖的**派生能力信号**，不是可追溯的原始比赛统计；“每日更新”是服务方陈述，当前球队/阵容没有公开 freshness SLA。页面说评分可作为模型/球探工具输入，但未找到一份独立条款明确规定免费档能否公开展示、缓存或做 LLM 推理；商业使用明确要求付费档，作品集公开部署应先问服务方。 | 可保留现有 report-only enrich 方向；不替代主候选池，也不应在免费条款不清楚时公开呈现评分。 |
| **foot.io**（新发现） | 提供球员档案及赛季表现目录，字段列出进球、助攻、分钟、射门、关键传球、推进传球/带球、拦截等；记录带 source 与 `stat_scope`。但许可闸门后统计行只服务部分记录；其文档说五大联赛比赛事件与阵容不在可再分发范围，转会和 xG 当前没有任何层级可读。[数据目录与权利闸门](https://foot.io/docs) | `/signup` 当前页面写 Free 5,000 次/月、30 次/分；但 docs 仍写 invite-only closed beta、免费 key 仅当前赛季、限额按邀请配置，官网也称公开启动尚未完成。产品状态与免费档权限自相矛盾，不能据 signup 文案认定可注册或有历史数据。[注册页](https://foot.io/signup) · [文档](https://foot.io/docs) · [官网状态](https://foot.io/) | 条款允许保留最少必要缓存并在产品展示单条事实，但须遵守记录对应的上游许可和来源署名；禁止公开数据集或重要子集（约单资源 5,000 行以上），并没有给出通用模型推理许可，特别要求使用者核对模型训练用途的上游许可。[条款](https://foot.io/terms) | **值得观察，暂不接入**：coverage/来源治理理念很适合项目，但 beta、许可覆盖和页面所示 entitlement 均需先核实；五大联赛阵容/事件缺口也直接影响球探用途。 |

## 备选开放数据与限制

新赛季 **OpenFootball** 已发布 2026/27 多个欧洲联赛赛程，项目声明其赛程数据为 public domain；它不提供可用来筛选能力的球员档案或比赛表现统计，因此只适合补赛程，不能成为本项目当前球员池。[OpenFootball](https://openfootball.github.io/) 现有 StatsBomb / Wyscout 开放样本仍适合展示历史事件指标和可解释分析，但赛季边界不能冒充现役名单；当前仓库快照明确是 Wyscout 2017/18。

## 不确定项与实施门槛

- 本次没有 Sportmonks、PlayerElo 或 API-Football 的可用 key，未核实具体账户的联赛/赛季 entitlement、响应字段、空值率或真实当前名单。
- Sportmonks 的当前球员/赛季数据可否作为本地模型输入没有在公开条款中说清；这是启用既有 `TACTISCOUT_SPORTMONKS_AI_PROCESSING_ALLOWED` 前必须补齐的外部事实。
- 不论选哪家，报告都应注明 provider、联赛、赛季、抓取时间、指标来源和缺失值；不要称作“官方全球完整转会市场”。

**最终建议：**把 Sportmonks 作为当前池主源，先拿到模型处理书面确认并做单赛季现场 smoke；PlayerElo 只做独立对照信号；API-Football 仅本地技术验证；foot.io 等其 closed-beta/entitlement 冲突澄清后再评估。若不接受付费数据，继续用已有公开历史数据把 LangGraph 证据链做完整，并把“当前候选池”诚实标成未覆盖，不以网页爬取绕过服务条款补齐。
