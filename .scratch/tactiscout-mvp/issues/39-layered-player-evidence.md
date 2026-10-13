# Build a layered, provenance-aware player evidence chain

Type: task
Status: open
Labels: needs-info
Blocked by: none

## Goal

让 TactiScout 在一个招募案件中组合互补的足球数据来源，同时保持候选身份、比赛表现、历史样本和第一方球探观察的证据边界。项目不再把单一 provider 当作完整球员数据库，也不把多个半完整 provider 拼成貌似权威的统一档案。

## Why now

用户最新决定允许扩大数据来源。当前代码已有 FBref、Sportmonks、StatsBomb、Wyscout、SkillCorner、Reep、PlayerElo 与第一方观察等不同模块，但 `TACTISCOUT_DATA_MODE` 主要以单一 provider 决定候选池，配套能力和真实验证程度也不一致。此前“FBref 是唯一当前候选池”的产品决策已被用户更新；FBref 实测返回 403，不能继续作为已可用的数据主链路。

## Scope

- 先基于 [数据源扩展复核研究](../research/football-data-source-research-refresh-2026-10.md) 选定可落地来源组合；区分无需凭据的开放历史数据、需免费 key 的来源、付费授权来源、第一方观察和暂不可自动使用的公开网页。
- 分开表达当前候选发现、身份/效力核验、可比比赛表现、历史事件样本、外部整体表现信号和第一方观察。每种来源只能填充自己可证明的事实。
- 在线候选 provider 执行有界的查询；可选证据来源按已确认身份按需查询。来源缺失、访问失败、零结果、字段缺失和身份歧义必须可区分。
- 每项可用于报告的证据保留 provider/文档身份、来源 ID、赛事/赛季或观察日期、取得时间、字段定义、单位、样本与来源限制。
- 只使用精确 provider ID 或已验证 crosswalk 关联不同来源。姓名相同不构成身份匹配；身份映射不代表统计口径可比。
- LangGraph 负责基于当前案件的证据缺口选择下一项工具、追问或结束；它不能让模型改写来源事实、把旧赛季说成现役状态，或将许可未允许的内容送入模型。
- 工作台与报告分来源展示数据范围、更新时间和缺失项。必需候选来源失败时停止并解释；可选补充来源失败时保留已获得的证据并标注不完整。

## Acceptance criteria

- [x] 有一份由一手来源支撑的准入来源矩阵，记录活动来源与主要候选的 API/抓取方式、覆盖、更新时间、球员字段、价格/凭据、展示/存储/模型处理条件及未验证项。
- [x] 至少一条当前候选发现路径和一条有实际数据的补充表现或观察路径能在同一案件中端到端运行；两条路径各自显示来源、时间和限制。
- [x] 百分位比较样本按 provider、来源赛事 ID、来源赛季 ID 与位置隔离；不同 provider 使用相同展示赛事名时也不会混入同一 peer group，完整 HTTP → LangGraph → 报告回归覆盖该反例。
- [x] mosaic 工作台和完整报告将评估/推荐数标为来源记录或来源线索；报告明确计数不等于已去重自然人数，同名记录没有精确 bridge 时不推断身份。
- [x] 精确身份分组只接受唯一有效的 Reep ID：同一身份只生成一个候选组，完整来源记录与各自指标仍分别保留、评估和引用；无 ID、无映射、有歧义或索引不可用时维持独立记录并报告解析状态。Planner 不会重复提名同一已解析身份，Reviewer 会拒绝重复推荐。
- 当前 Reep release 没有 ASA bridge，因此真实 Understat↔ASA 重叠仍无法按身份去重；此限制不能用合成 resolver 测试替代实际 bridge 覆盖。
- LangGraph 工具结果能区分候选池来源、补充证据来源以及实际覆盖范围；Reviewer 校验结论引用的是本轮检索到的证据。
- 权限或自动访问条件不清楚的来源不会默认启用。用户可以明确要求将公开来源用于本地研究原型；这种工程授权不等于来源授予许可，状态必须标记未核实且不得描述为来源已批准。来源暂时不可达时，不伪装成空名单。
- README、`CONTEXT.md`、issue map 和用户界面一致说明“当前候选池”“历史表现样本”“外部信号”“第一方观察”的不同用途。
- 真实 API/key/许可无法验证的部分明确标为未验证，不用 fixture 测试声称 live provider 已可用。

## Research

- [Understat 与 ASA 当前公开身份桥接核查](../research/current-provider-identity-bridge-2026-10-10.md)：固定 Reep `20261005T180536Z` release 有 5,287 条 Understat `player` 精确 bridge、没有 ASA provider 行；ASA 官方使用独立的 `player_id` 字段，但未发现其与 Understat 共用 namespace 的依据。应用已将 Understat 加入精确 resolver，并在本机索引中导入 5,119 条 Understat 桥接；ASA 仍没有该 release 的 bridge。2026-10-11 增量复核确认官方 latest 指针仍指向该版本，Understat bridge delta 为 0，未出现 ASA bridge 证据。该结论只限定于此公开 release，不证明跨来源已去重。
- [ASA 球员 ID 跨来源桥接复核](../research/asa-player-identity-bridge-refresh-2026-10-11.md)：按当前 Reep v1 release 与 provider 清单复核，仍没有 ASA → Reep/Understat/FPL/Opta/Wyscout 的公开精确桥接；ASA MLS roster-profile 工具通过姓名关联 ASA ID，且歧义时需人工确认，不是外部 player-ID crosswalk。继续把 ASA 记录作为独立身份，不以姓名/DOB/球队/ID 外形补桥。
- [2026-10-12 Reep / ASA 增量复核](../research/asa-reep-current-bridge-check-2026-10-12.md)：Reep 数据页仍指向 `20261005T180536Z`，该 release 新增 SofaScore，未出现 ASA；coverage 页面实际落后一版，不能作为最新 release provider 列表。本轮未下载数据；身份桥接阻塞项不变。
- [ASA / MLS 外部球员 ID 精确桥接复核](../research/asa-external-player-id-crosswalk-2026-10-12.md)：逐项核对 ASA 官方 API/wrapper、MLS roster-profile parser 与 Reep v1 release；没有找到 ASA→Understat、Reep 或现有 provider 的公开双边 ID crosswalk。依据仅限所查公开材料和 `20261005T180536Z` release；ASA 保持独立身份，真实 bridge 验收继续未满足，等待带命名空间的精确映射及可核版本证据。
- [PlayerElo 官方 API 与使用边界复核](../research/playerelo-official-recheck-2026-10-10.md)：API 页正面称 Elo、历史和 EAR 可作为模型、球探工具或研究输入，Free key 当前显示每月 500 次；但没有说明生成式 LLM/Ollama、embedding/RAG、持久化、公开逐球员展示及再分发权限，MCP 招聘端点计划标注还与 API 总览冲突。应用接入和留存继续 NO-GO。

- [Understat 五大联赛实时字段核验](../research/understat-current-five-league-live-smoke-2026-10-08.md)：用户明确允许抓取公开页面后，完成五个 2026/27 联赛页请求，累计 2,121 条当前表现行；工程接入为显式选择的本地研究来源，来源许可和更新 SLA 不作已验证结论。实现/报告验收见 [issue 94](94-understat-five-league-conversation-chain.md)。

- [当前球员数据源与自建路径复核](../research/current-player-data-source-options-2026-10.md)：用户允许扩大来源后按官方资料重新比较 PlayerElo、Sportmonks、football-data.org、TheSportsDB、Reep、Wikidata、OpenLigaDB、StatsBomb 与 Wyscout；建议将 PlayerElo 作为需先取得 key、确认权限并做一联赛小样本核验的只读外部信号，不视为当前主候选池。
- [数据源扩展复核研究](../research/football-data-source-research-refresh-2026-10.md)：用户重新开放来源范围后的最新一手来源调查；它会替代“FBref 是唯一主候选池”的旧决策，但不会删除旧调查与实现记录。
- [下一条球员数据源候选调查](../research/next-player-source-candidates-2026-10-06.md)：补查 FootyStats、ASA、OpenFootAPI、Roanuz 和 Impect。公开 FootyStats demo key 的当前 EPL 请求返回 417，历史示例页只有基础字段；真实账户权限、数据留存与生成式 LLM/RAG 范围未验证。Impect 2023/24 条款限制复制/再分发且禁止商业用途；在复制边界澄清前不集成。
- [当前赛季成年球员来源路径](../research/current-season-player-source-path-2026-10-06.md)：补查 ASA、SportScore、foot.io、OpenLigaDB、football-data.org 与 PitchAPI。PitchAPI 是最强技术候选，但其返回数据由未找到的独立服务条款管理；数据产品权利仍未通过。先做 [issue 72](72-pitchapi-single-league-smoke.md) 的单联赛只读 smoke，不启用 provider。
- [OpenScores 当前球员来源复核](../research/openscores-current-player-source-review-2026-10-06.md)：其免费 MCP/REST 条款明确支持产品、Agent 与应用内转换/展示，文档列有球队当前赛季 squad；但 2026/27 roster freshness、球员能力指标 schema 和 Sofascore/Flashscore 上游授权链仍待核。官方说明球队搜索跨所有球队；[issue 73](73-openscores-mcp-current-squad-smoke.md) 仅核验全局精确球队结果及 profile，不推断联赛归属，也不注册正式 provider。
- [按需数据源查询契约](32-query-scoped-player-source-contract.md)：保留 LangGraph 查询预算、分页和失败分类。
- [来源特定表现证据 ADR](../../../docs/adr/0003-source-specific-performance-evidence.md)：扩展来源时仍须保留指标所属来源、口径与样本，不根据姓名自动合并或默认跨来源计分。
- [Reep → Wyscout 桥接调查](../research/reep-wyscout-bridge-coverage-2026-10.md)：Reep 是部分覆盖的 ID crosswalk，不是表现来源。
- [FPL → Reep → Wyscout 桥接核查](../research/fpl-reep-current-player-identity-bridge-2026-10-07.md)：记录 FPL `opta_code` 的观察性字段边界、官方 Reep release checksum、本机覆盖率和真实 LangGraph 报告验收。
- [Impect 与 StatsBomb 历史球员表现池复核](../research/impect-vs-statsbomb-historical-pool-2026-10-07.md)：Impect 仓库描述了 2023/24 Bundesliga 完整赛季 KPI 文件，StatsBomb 提供赛事/赛季选样；两者许可 PDF 正文均未能核实，因此不能据公开可下载推断本地留存、球员数值展示、再分发或 LLM 处理权。本次没有下载、导入或启用这两个来源。
- [球员证据来源准入矩阵](../research/player-evidence-source-admission-matrix-2026-10-08.md)：汇总当前 FPL/ASA/Wyscout/观察/身份桥接层，以及 Live Football API、foot.io、Yuvron、OpenScores、Sportmonks、PlayerElo、PitchAPI、FBref/Understat、StatsBomb/IDSSE 和 SkillCorner/Impect 等路线的覆盖、字段、凭据/时效及处理边界。
- [K League 官方当季球员表现 API 评估](../research/k-league-current-player-performance-api-2026-10-09.md)：官方当前球员榜和 API 文档显示，K League 能补韩国当季赛季汇总与逐场关键传球、盘带、对抗、抢断、拦截等表现指标；但需合作方 key，门户条款要求事先许可复制/保存。费用、调用额度、缓存、本地模型/RAG 与公开展示权限未确认；未申请 key、调用 API 或抓取。作为优先授权评估，不进入当前 provider。
- [SoccersAPI 当前球员统计源复核](../research/soccersapi-current-player-statistics-source-review-2026-10-09.md)：免费账户可选三个联赛并逐球员取基础当前季指标；刷新与实际统计完整度未验证，条款页不可读。已建立最多九次请求的本地无模型 smoke（[issue 100](100-soccersapi-current-season-bounded-smoke.md)），尚无 key/live 响应，不作为已准入来源。
- [J.League 当前赛季球员表现源](../research/jleague-current-player-performance-source-2026-10-08.md)：官方 J1/J2/J3 页面确实展示 2026/27 赛季进球、助攻、对抗、防守、跑动和冲刺等指标，并给出页面更新时间；当前公开页面主要是每项排名前列数据，没有找到支持完整候选池的公开机器接口，也没有找到允许批量留存、模型处理和作品集具名展示的条款。作为人工浏览/授权交付线索，不将有限榜单误作完整日本联赛球员池。
- [Understat 当前赛季访问边界核查](../research/current-season-understat-access-audit-2026-10-07.md)：普通浏览器核实了官网 EPL 2026/27 球队表和球员 xG/xA 统计行；未遍历其 43 页，也未核实其他联赛当季行。Understat 官方条款/robots 与自动采集、缓存、模型处理/展示边界仍未确认，暂不接入数据管线。
- [当前赛季表现源官方资料复核](../research/current-season-player-source-official-audit-2026-10-07.md)：补查 API-Football、PlayerElo、OpenScores、Understat、FotMob 与 SofaScore 的官方 API 文档、条款和访问规则。未发现同时满足广泛当前球员池、可解释能力指标及本项目存储/LLM/公开展示边界明确的免费来源；API-Football 只适合做有限本机 schema/coverage 验证，OpenScores 只适合阵容与近期出场上下文，Understat 暂不自动接入，FotMob/SofaScore 不列自动采集路线。
- [官方联赛与赛事当前球员来源遗漏复核](../research/overlooked-official-current-player-source-refresh-2026-10-07.md)：补查 UEFA、FIFA、AFC、CAF、CONMEBOL、五大联赛与 SPL 的当前球员统计页面。UEFA 明确禁止自动抓取、建库及把数据用于模型/AI；Bundesliga、Serie A 等也未找到允许自动采集、保存与 LLM 处理的公开通路。CAF 条款提及可展示 feeds/APIs，但缺少公开文档、字段、访问、价格与本地保存/LLM 许可，只能作为联系官方的线索。以上网页仅保留人工核验用途，本轮不新增 provider。
- [2026-10-07 免费/公开球员数据源复核](../research/current-free-global-player-data-recheck-2026-10-07.md)：复核 Transfermarkt-datasets、FIFA World Cup 2026、BrazilianFootball/Data 和 SkillCorner Open Data。没有来源同时满足更广的当前成年球员池/能力字段、持续更新、可自动访问保存和本地 LLM/RAG 条件；本轮没有下载/导入数据或新增 provider。Transfermarkt 与巴西比赛记录的来源处理边界未通过；FIFA 报告仅作人工方法参考；SkillCorner 仍为隔离历史样本候选。
- [2026-10-08 当前球员来源补充复核](../research/current-player-source-sweep-2026-10-08.md)：新发现的 Live Football API 可用于小规模当前阵容/基础数据技术原型，但长期本地留存与本地 LLM/RAG 处理未获明确许可，统计深度也不足以支撑战术能力评分；FPL Core Insights 的上游权利与正式数据许可不清，暂不接入。未取得书面确认前，两者都不进入默认候选池或模型链路。
- [新增球员表现源准入复核](../research/new-player-performance-source-admission-2026-10-08.md)：SkillCorner EPL 2025/26 课程包有高战术分析潜力，但访问需披露联系信息，标注许可为 CC BY-NC 4.0 且说明上游版权仍属 SkillCorner；球员文件、比赛覆盖及本地 LLM/RAG、具名派生数据展示边界未核实。仅登记为条件候选，未访问受限文件、下载数据或新增 provider；书面授权和受控 schema/coverage 验收前不进入仓库或模型链路。

## Comments

- 2026-10-11: Adversarial review found that `sourcePlayerKey()` used colon-joined fields, so valid provider IDs containing delimiters could collide with different source/team ID tuples. Replaced the ambiguous key with a type-tagged JSON tuple; the regression first failed through `groupCandidatesByExactIdentity`. A matched full-LangGraph fixture now compares the exact Reep resolver on/off: the enabled arm rejects duplicate recommendations for one resolved identity, while the no-resolver arm accepts both records as unverified independent candidates. Two unlinked delimiter-bearing records remain separate groups and peer samples; source evidence stays attached to its own provider record. Candidate-identity and conversation suites pass (4/4 and 41/41); API and Web production builds pass. The controlled fixture validates the application mechanism only, not live ASA bridge coverage or recommendation quality; those requirements remain open.

- 2026-10-04：用户明确要求持续把项目推进到可交付的简历项目，并允许扩大数据来源。开始重审数据架构和现有第一方观察/RAG 能力；不会把网页可读误当作授权，也不会用多个不完整来源伪装成完整数据库。
- 2026-10-04：一手来源复核后，路线确定为：第一方比赛观察作为自有证据采集；Sportmonks 作为需账户/联赛选择的当前池候选；Wyscout/StatsBomb 与 SkillCorner 用于有边界的历史事件/追踪指标；OpenFootball 只做国际赛事实体/赛程上下文。免费 Sportmonks 覆盖丹麦/苏格兰，官方 Starter 定价页列 €29/月任选 5 个联赛；本机无 token，故实时链路仍未验证。细节与来源链接见关联 research refresh。
- 2026-10-04：首个实现切片是 issue 41：扩展现有自录观察为样本绑定的 1–5 主观能力档和具体比赛证据；不做跨来源拼接、不聚合成能力分、不替代当前候选源。
- 2026-10-04：用户最新方向改为以自采第一方观察为产品数据主线，停止继续扩展多 provider。issue 39 保留来源准入、身份、赛季和口径边界；其“组合多种外部来源以覆盖当前候选池”的目标由 [issue 40](40-tactiscout-owned-scouting-dataset.md) 的新路线取代。详见[自建数据集可行性调查](../research/self-built-scouting-dataset-feasibility-2026-10.md)。
- 2026-10-04：用户随后明确允许扩大数据源，恢复分层组合研究。最新[来源复核](../research/current-player-data-source-options-2026-10.md)没有找到兼具主要联赛当前覆盖、可复算战术指标、低成本和公开/模型使用边界明确的单一来源；Sportmonks 仍是现有适配器中最完整的候选池方案，PlayerElo 可在取得 key 与核实展示/保留/模型处理范围后做一联赛小样本、report-only 对照，Reep 继续作精确 ID bridge。当前环境没有 Sportmonks、PlayerElo 或 API-Football 凭据，未声称 live API 已验证。
- 2026-10-04：为避免 PlayerElo 外部信号按姓名挂错人，完成[跨来源身份映射研究](../research/playerelo-reep-exact-identity-crosswalk-2026-10.md)：现有 Reep release 对本机 Wyscout 2017/18 快照的 2,561 个球员 ID 中，2,375 个能映射到唯一 API-Football ID。固定 release 已导入 `api_football/player` namespace；PlayerElo 无 key，展示/本机保留权限未确认，live coverage 仍待核验。
- 2026-10-04：完成[通过 Reep 跨来源身份映射查询 PlayerElo](43-playerelo-reep-identity-mapping.md)：resolver 只接受有效且唯一的 ID mapping，PlayerElo 使用 `getPlayer(id)` 并核对响应 ID。固定 Reep `20261003T052950Z` 对自建 Wyscout 快照的实现级 resolver 结果为 2,375 resolved、155 target 缺失、31 source 缺失；真实 PlayerElo API 记录覆盖和使用许可仍未验证。
- 2026-10-06：扩大来源复核后，FootyStats 是字段上最接近当前 EPL 参赛池的新增候选，但公开 `example` key 无法访问 2026/27 EPL（HTTP 417）；没有真实账户/league entitlement，也未确认本地持久化和生成式 LLM/RAG 权限。Impect 官方 LICENSE.pdf 明文禁止 reproduce 与对外复制/再分发；静态 2023/24 Bundesliga 样本的下载、缓存及模型处理范围没有被证明。此轮不新增正式 provider，也不把公开 demo 响应当作 live 验收；如继续 FootyStats，先由用户在账户中确认 EPL entitlement 并提供本机 key，再做不落盘、无模型的一页 smoke。详见[新增来源复核](../research/next-player-source-candidates-2026-10-06.md)。
- 2026-10-06：用户随后明确要求优先完成 LangGraph/Agent/Harness/UIUX，并接受扩大数据源及公开页面读取；[issue 74](74-premier-league-current-player-repository.md) 因此实现 FPL 当前英超游戏目录，并真实通过一案多轮的 LangGraph→报告行为验收。该来源提供有限同源赛季指标，不等于多来源身份/效力核验、完整注册阵容或成熟战术数据层；issue 39 的跨来源证据设计仍未完成。
- 2026-10-07：完成 FPL→Reep→Wyscout 一条当前球员到历史表现的真实 report-only 链路。实时 FPL bootstrap 有 667 条记录；`opta_code` 的 `p<数字>` 格式是 payload 观察，FPL 官方未发布字段 schema。经 Reep 20261005T180536Z release 精确查询，656 条解析到唯一 Reep identity，11 条未解析。最新 Reep bridges/redirects checksum 核对后已导入本机忽略目录索引；精确匹配没有使用姓名。历史档案实跑中，667 条 FPL 记录有 90 条实际生成 Wyscout 表现样本；本轮拜仁案的 30 名已评估候选中 4 人命中 4 条样本。
- 2026-10-07：报告将匹配到的非推荐候选放在独立历史样本附录，显示 FPL 原生 ID、Opta namespace/ID 与来源字段、Reep release/identity、Wyscout ID、2017/18 赛季及指标样本；不输入 Planner/Reviewer，不参与评分或排序。最终推荐球员本身没有历史样本。Qwen 3.5 9B 完成两轮追问/同案恢复、30 人评估、Reviewer 与报告，104.761 秒，所有 Harness 行为检查通过。故至少一条当前候选与一条真实历史表现数据已在同一报告端到端呈现；该结果不证明排序质量、FPL 字段的官方语义或整体数据源矩阵已完成。详细结果见研究笔记。
- 2026-10-07：补充评估 Impect Open Data 与 StatsBomb Open Data 的历史数据池形状。Impect 的官方静态目录更适合做 2023/24 Bundesliga 球员赛季表现池，StatsBomb 是事件级但只覆盖所选比赛；许可正文、逐球员派生结果的公开展示和本地模型处理均未核实。暂不新增 adapter 或导入任务，直到取得可验证的使用边界。详见[Impect/StatsBomb 复核](../research/impect-vs-statsbomb-historical-pool-2026-10-07.md)。
- 2026-10-07：Understat 普通浏览器页面呈现 2026/27 EPL 的球队表和按场次、分钟、进球、助攻、xG、xA、xG90、xA90 排序的球员表；这是实际当前季样本，不只是页面标题。但没有明确最近更新时间，其他五个列出的联赛未逐一核实，自动采集/缓存/模型处理权限未知。暂留作待核验的表现补充源，不接入排序、RAG 或报告。详见[Understat 当前赛季访问边界核查](../research/current-season-understat-access-audit-2026-10-07.md)。
- 2026-10-07：官方来源复核新增 API-Football 作为最接近原始球员统计的本机有限验证候选，但免费账号可用赛季需登录确认，官方条款未授予应用公开展示许可，也没有明确许可永久存储或本地 LLM/RAG 处理；因此它不能直接进入默认候选池或报告。OpenScores 官方条款允许产品/Agent 应用内使用，但公开 schema 只有阵容、球员档案/生涯聚合和近期出场，不能替代能力数据；上游来源许可链亦未证实。详见[当前赛季表现源官方资料复核](../research/current-season-player-source-official-audit-2026-10-07.md)。
- 2026-10-07：补查 UEFA、FIFA、AFC、CAF、CONMEBOL、五大联赛与 SPL 官方来源；找到更多当前赛季具名球员统计页，但没有来源同时提供公开文档化 API 与明确的自动采集、入库和 LLM 处理边界。UEFA 条款明确禁止 AI 用途；CAF feed/API 仅作为联系官方的线索。当前不据此增加自动来源，详情见[遗漏官方来源复核](../research/overlooked-official-current-player-source-refresh-2026-10-07.md)。
- 2026-10-07：追加免费/公开来源复核；没有发现可以安全新增的全球当前球员或能力数据源。研究只读官方说明与原始发布仓库，没有自动抓取、下载或导入球员数据。结论和逐项边界见[复核笔记](../research/current-free-global-player-data-recheck-2026-10-07.md)。本 issue 的来源准入矩阵仍未完成，现有 FPL/ASA 也只能代表各自已核验的局部覆盖。
- 2026-10-08：复核新出现的当前赛季候选后仍未找到可直接准入的数据源。Yuvron 是条件候选，但未明确授权统计本地持久化、公开展示及本地 LLM/RAG；Estimador.pt 的公开许可描述相互矛盾且部分上游统计排除在许可外；Orbistats 免费层须人工批准且只有一小时，也无 LLM/RAG 边界；Rising Transfers 的 CC BY 4.0 数据是 2025/26，不是当前赛季。本轮没有调用 API、获取/保存球员数据或新增 provider。详见[当前赛季新来源准入复核](../research/new-current-season-player-source-triage-2026-10-08.md)。
- 2026-10-08：对未重复的来源路线再次复核后，Live Football API 是技术上最可行的新当前名单原型，但留存、LLM/RAG 和上游授权链仍待书面确认；FPL Core Insights 虽声明提供 2026/27 赛季更丰富统计，正式数据许可和上游再利用权不明，因此不接入。完整边界见[新增来源复核](../research/current-player-source-sweep-2026-10-08.md)。
- 2026-10-08：汇总形成[球员证据来源准入矩阵](../research/player-evidence-source-admission-matrix-2026-10-08.md)，完成本 issue 的来源矩阵验收项；其余来源组合、单案覆盖及权限边界仍待继续。
- 2026-10-08：当前 FPL→LangGraph→报告完整案件重新验收通过，详见 [issue 14](14-agent-harness-evaluation-suite.md)。本次使用 FPL 2026/27 当前目录，不含默认关闭的 Reep/Wyscout 历史报告 sidecar，不能替代跨来源 sidecar 的 opt-in 验收。
- 2026-10-08：补查 SkillCorner EPL 2025/26 课程发布包。它是有门槛且上游处理权未确认的历史战术证据候选，不是当前球员池；未下载或导入。文件布局还对 `players.parquet` 是否随包发布存在文档不一致。来源准入前需书面确认作品集具名展示、派生统计留存、本地 LLM/RAG/embedding 权限，再以受控样本核实球员标识、赛事覆盖、KPI 定义及缺失率；详见[研究报告](../research/new-player-performance-source-admission-2026-10-08.md)。

- 2026-10-08：再次按完整验收面运行 FPL 当前候选仓库 → LangGraph 多轮调查 → Reviewer → 报告，并仅在本次命令启用 Reep/Wyscout 历史报告 sidecar。Qwen 3.5 9B 完成三轮同案对话、两次追问、6 次工具调用；FPL 查询命中 79 条 ATT 记录、读取 40 条、评估 10 人。sidecar 精确映射 10 人、为其中 2 人找到 Wyscout 2017/18 样本；报告将其单独列在历史附录，2 条样本均保留 FPL ID、Opta 标识、Reep release/identity、Wyscout ID、赛季及身份桥接信息，没有并入推荐或评分。Reviewer 后才执行 sidecar，不将历史档案送入模型。新增 Harness 检查覆盖计数自洽及每条样本的源 provider/player ID 与候选身份相符；包含它在内的 27/27 检查通过，用时 362.530 秒。报告仍明确这是有限 FPL 英超游戏目录；单次运行不证明推荐排序质量、FPL 字段的官方语义、来源授权或长期稳定性。

- 2026-10-10：对抗性检查发现同一赛事展示名可能出现在不同 provider；旧 peer 过滤只用位置/展示赛事/展示赛季，会把来源口径不同的记录纳入同一百分位样本。`RecruitmentEvidenceEvaluator` 现按 provider、来源赛事 ID、来源赛季 ID 与位置限定比较组，缺来源 ID 时退回来源名和显示标签。完整 HTTP → LangGraph → 报告回归先在跨 provider 同名赛事夹具上失败，修复后通过。此项不代表 issue 39 的其他身份去重、实时来源覆盖或来源权利验收已完成。
- 2026-10-10：将 Understat 纳入 Reep resolver 的精确 `(provider, namespace, external_id)` allowlist，并从已校验的 `20261005T180536Z` release 重建本机索引；5,119 条 Understat 映射可解析，ASA 仍为 `unsupported_provider`。mosaic Planner 和完整 `createRecruitmentConversation` 报告现在明确“候选计数是来源记录，不等于已去重自然人数”，且不凭同名判断身份；工作台中的评估与推荐计数也改为“来源记录/来源线索”。整图对话套件通过（41/41）、Understat/Wyscout identity bridge suite 通过（3/3）、API/Web 构建及 diff whitespace check 通过。跨源实际去重仍未实现，也没有 ASA bridge，故本 issue 保持进行中。
- 2026-10-11：实现 `groupCandidatesByExactIdentity` 与配置 Reep resolver 接入。Planner 搜索摘要携带精确解析状态和同组记录 ID；Reviewer 拒绝对同一已解析身份的重复推荐；完整报告将候选身份组数与来源记录数分开统计，并逐条附带已评估的来源证据。纯函数 + 完整 LangGraph 报告测试 3/3 通过，覆盖有精确映射、缺失/歧义映射、来源指标独立保留和 Reviewer 重试。真实 ASA 记录仍无 Reep bridge，报告继续将它们独立保留。
- 2026-10-11：代码审查发现候选分组只向 Reep 查询 `sourceIdentity.playerId`，忽略 Understat adapter 放在同 provider `player` 标识中的原始 ID；联赛前缀键因此未命中有效映射。分组现在只在同一 provider/`player` namespace 恰有一个唯一标识时使用其 external ID；出现互相冲突的同源 ID 时标记为歧义，不调用 resolver。其他 provider 的标识不会参与。真实 Understat-shaped 纯函数回归先失败后通过；完整 `createRecruitmentConversation` Reviewer 回归、身份分组与 Understat provider 测试共 22/22 通过，TypeScript 构建通过。它验证分组消费精确 ID 的应用机制，不增加 ASA bridge 覆盖，也不改变 issue 仍开放的来源与 live identity 验收。
- 2026-10-11：Reep 官方 latest pointer、manifest、coverage delta 与公开 provider 页面复核仍指向 `20261005T180536Z`；Understat bridge delta 为 0，未发现 ASA bridge。复核未下载或导入数据；这是公开资料的当日状态，不是 ASA 永久不受支持的证明，也不满足实际 Understat↔ASA bridge 验收项。详见关联研究的 2026-10-11 增量复核。
- 2026-10-11：针对尚缺的 ASA 第一跳重新审查 Reep 当前 v1 下载/coverage、ASA 官方 API 与 MLS roster-profile parser，以及公开 FPL ID map。Reep 当前公开 release 仍没有 ASA provider 行；ASA roster-profile parser 从 PDF 名称经 ASA 自身名册表映射到 ASA ID，单一匹配自动采用、多候选交由操作者确认，且没有 MLS 外部 player ID，不能连接到 Understat/FPL/Opta/Wyscout。没有发现可替代的精确公开 crosswalk；不添加姓名或 DOB 回退。身份仍按独立来源记录展示，issue 的真实跨源 bridge 覆盖验收继续未完成。详见[增量研究](../research/asa-player-identity-bridge-refresh-2026-10-11.md)。

2026-10-12: Reviewed ASA/MLS provider-ID contracts and the checksum-verified Reep `20261005T180536Z` release. No public exact crosswalk to Understat, Reep, or another provider was found. Keep ASA identities separate; the live bridge acceptance remains unmet. The issue is now `open / needs-info`, awaiting a versioned, auditable mapping. See [the research report](../research/asa-external-player-id-crosswalk-2026-10-12.md).

## Answer

2026-10-10 PlayerElo 更新：一般的模型/球探/研究输入用途有官方产品页文案支持，但不能据此推断可交给 Ollama/云端 LLM、embedding/RAG、持久化或公开展示。当前无 key 和 live 请求验证；report-only app 接入与留存继续关闭。详见[官方复核笔记](../research/playerelo-official-recheck-2026-10-10.md)。

进行中。来源准入矩阵已整理；FPL 当前候选池 → Reep 精确身份映射 → Wyscout 历史样本的同案 report-only 路径已在当前工作树启用 sidecar 实跑，并由新增 Harness 不变量校验样本身份和计数。FPL→LangGraph→Reviewer→报告完整案件通过，覆盖 2026/27 英超 FPL 游戏目录的有限样本，不能证明推荐排序或 FPL 上游数据权利。SoccersAPI 已做官方接口复核并实现最多九次请求的本地无模型 smoke；key 与条款边界待用户配置/核实前不进入 Agent。Live Football API 是指标较浅且需确认留存/LLM/RAG 的条件候选；Yuvron 数据更丰富但也需确认展示与模型处理权；FPL Core Insights 上游权利不清，不接入。SkillCorner EPL 2025/26 课程包是待书面授权和受控覆盖核验的历史表现候选，本次未下载或接入。ASA、OpenScores、Understat、Impect/StatsBomb 的部分来源处理边界仍未验证。见[来源准入矩阵](../research/player-evidence-source-admission-matrix-2026-10-08.md)、[SoccersAPI 复核](../research/soccersapi-current-player-statistics-source-review-2026-10-09.md)和[新增来源准入复核](../research/new-player-performance-source-admission-2026-10-08.md)。

精确身份分组逻辑已实现并由纯函数和 `createRecruitmentConversation` 整图报告测试验证；它只消除 resolver 能证明的重复候选，同时保留每条来源记录的独立表现证据。当前真实 mosaic 里 ASA 不受该 Reep release 支持，因此 Understat↔ASA 重叠仍无法确认。issue 继续开放，剩余工作包括组合来源可用性/权限验收以及实际跨源 bridge 覆盖。

2026-10-12 复核后，ASA/MLS 精确 ID 桥仍无公开可审计证据；当前等待带版本和来源命名空间的 bridge，因此状态为 `open / needs-info`。现有 ASA 记录继续独立展示和评估，不以姓名、生日、球队或 ID 相似性归并。
