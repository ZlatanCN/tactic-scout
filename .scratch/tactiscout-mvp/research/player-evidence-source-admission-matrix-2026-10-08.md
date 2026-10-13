# TactiScout 球员证据来源准入矩阵

复核日期：2026-10-09。此表聚焦仓库当前实现、实际被评估的来源和已进入产品决策的候选路线；它是工程准入记录，不构成法律意见。公开可访问、代码开源或数据非商业使用，不单独证明原始球员行可以长期保存、传入 LLM/RAG 或放入公开作品集。

## 准入规则

- **可用于推荐**：有可追溯球员 ID、范围/赛季和指标定义；本项目确认所需访问及数据处理边界；缺失字段保持缺失。来源自身明确为候选池时，才可支撑候选发现。
- **报告旁证**：按精确来源 ID 关联后，只能补充报告侧栏，不得进入 Planner、推荐排序或另一来源的能力评分。
- **本地研究/原型**：只能在已说明的数据范围、运行方式和权限内验证；不得称作已授权的公开数据源或 live 验收。
- **暂不接入**：权限、访问、上游权利或字段覆盖未通过时，不建立默认工具，不把失败解释为空名单。

## 当前实现与核心来源

| 来源与角色 | 实测范围、时效及字段 | 获取、凭据与更新 | 留存、展示、模型处理 | TactiScout 状态 |
|---|---|---|---|---|
| **FPL 当前球员目录**（候选发现、有限同源赛季表现） | 本机 2026/27 赛季观测为 667 条归属英超球队的游戏目录记录；可读进球、助攻、xG/xA/xGI、抢断、球权恢复及合并解围/封堵/拦截等字段。不是完整注册阵容；只有宽泛位置分类；无合同、可靠身价、伤病、推进或压迫指标。 | 公开 bootstrap 接口，无 API key；随请求读取。没有来源级 freshness SLA。 | Premier League/FPL 条款对自动提取及再利用有限制；FPL 字段的公开作品集展示、持久保存和模型处理权未核实。应用会把分析状态保留在本地计划/checkpoint 中。 | **已接入的本地技术原型，来源权限未准入公开展示。**报告必须注明来源和赛季，并不得把少数字段描述成完整能力评估。依据：[FPL/PL 条款](https://fantasy.premierleague.com/help/terms)、[issue 74](../issues/74-premier-league-current-player-repository.md)。 |
| **ASA / American Soccer Analysis**（北美当前赛季表现候选） | 代码路径已实测 2026 MLS、NWSL、USL Championship、USL League One、USL Super League 等有限当前池；xGoals、xPass、Goals Added 等表现字段。分别按赛事/球队/赛季隔离；不是欧洲或完整注册名单。 | 公开 API，无 key；没有一致 freshness SLA。实测覆盖见 [issue 76](../issues/76-asa-current-north-america-coverage.md)。 | 官方应用要求署名；wrapper 的 MIT 是代码许可，不是数据许可。逐球员公开展示、长期保存、本地 LLM/RAG 及上游数据权利未确认。 | **可用于局部技术验证；数据处理范围未准入。**必须标赛事、赛季及字段定义；不默认送入模型或公开逐人统计。依据：[ASA API client](https://github.com/American-Soccer-Analysis/itscalledsoccer-js)、[issue 75](../issues/75-asa-current-mls-agent-chain.md)。 |
| **Wyscout Open Data / Figshare**（历史事件与能力线索） | 已构建五大联赛 2017/18 静态事件快照：2,682 条球员赛季记录；可从事件计算进球、助攻、关键传球、对抗及标明为 TactiScout 派生估计的渐进传球。非现役池，分钟也为近似估算。 | 固定公开 Figshare 文件；无更新 SLA，不需要账户 key。原始文件及 provenance 留在本机忽略目录。 | 数据项标记 CC BY 4.0；复用时保留论文/来源/许可和派生说明。此许可不扩展到其他数据源、球员肖像或当前身份。 | **准入为有署名的历史样本和管线验证数据。**不能用来证明当前效力、年龄或转会可能性。依据：[数据论文](https://doi.org/10.1038/s41597-019-0247-7)、[Figshare Collection](https://figshare.com/collections/Soccer_match_event_dataset/4415000)、[本机 smoke 记录](wyscout-real-data-smoke-2026-10.md)。 |
| **Reep identity registry**（身份桥接，非表现源） | 固定 release 提供来源间 ID bridges/redirects；本机 release 已对当前 FPL ID 做过精确覆盖核验。它不提供表现指标、现役证明或候选池。 | 发布版文件可下载并校验 checksum；无实时 API 依赖。 | 只可按唯一、有效的来源 ID 建桥；不能用姓名回退。桥接本身不授予上游球员统计的展示、保存或模型处理权。 | **仅作身份 crosswalk。**FPL→Reep→Wyscout 结果是可选 report-only 历史旁证，默认双重权限开关关闭，不进入评分。依据：[身份桥接复核](fpl-reep-current-player-identity-bridge-2026-10-07.md)、[ADR-0003](../../../docs/adr/0003-source-specific-performance-evidence.md)。 |
| **第一方比赛观察**（人工定性证据） | 用户记录的具名球员、比赛/观看范围、场景和可选能力观察；只代表被观察的样本，不代表整个赛季。 | 无外部 API；本机 JSON 存储。可编辑和删除；记录由用户手动创建。 | 本地持久化必须单独明确授权；进入 LLM/RAG 还需第二项明确授权，默认关闭；检索须保留作者、日期、比赛上下文和主观性说明。 | **准入为独立的人工观察层。**不与统计合并求平均，不自动补齐数据缺口，也不直接生成总能力分。依据：[观察协议](../../../docs/scouting/first-party-observation-protocol.md)、[issue 23](../issues/23-first-party-player-observations.md)、[issue 41](../issues/41-structured-first-party-observations.md)。 |
| **方法资料语料**（战术方法 RAG，不是球员数据） | 获准索引目前规模有限；可支持角色定义/方法说明，不能证明某名球员的表现。 | 从来源页面按各自许可流程发现与导入；当前候选球员报告语料命中为 0。 | 每来源独立核对复制、索引、embedding、LLM 和引文许可；撤回授权时可清除索引。 | **与球员证据分开。**只为报告方法补充，不得冒充球员球探报告。 |

## 候选、受限或拒绝的路线

| 来源 | 技术可用性与数据形状 | 凭据/成本及更新时间 | 权限与未验证项 | 决策 |
|---|---|---|---|---|
| **Live Football API** | 当前赛季球队阵容、球员 profile 与出场/进球/助攻/牌等基础统计；不足以做分钟归一化或细粒度战术能力评估。 | 新账户 500 免费 credits，需 API key；实际联赛覆盖和当前季 freshness 未实测。 | Terms 允许自有产品使用和对用户再分发，但未明确永久本地留存、LLM/embedding/RAG 和上游数据授权链。 | **条件候选。**仅在服务方书面确认上述边界后做小型本地原型；不得默认接入。详见[新增来源复核](current-player-source-sweep-2026-10-08.md)。 |
| **SoccersAPI** | 球队名单含年龄/位置/国籍字段，球员统计需按球员与赛季单独查询；接口样例含分钟、出场、进球、助攻、射门与牌，不含本项目所需的细粒度推进、创造或防守对抗指标。官方目录列出 2026/27 赛季，但真实账户的逐联赛统计完整度和刷新频率未实测。 | Free 计划可选择 3 个账户赛事并使用 Standard 数据集，有每日请求额度；需 API key。逐人取数会消耗额度，当前只实现最多 9 次请求的 smoke。 | 官方条款要求署名并限制未经授权的再分发；完整 terms 页面本次超时，纯本地非商业原型、本地留存/LLM/RAG 与简历展示适用范围未确认，上游授权链未知。 | **本地无模型 smoke 候选，未 live 验证，不进入 LangGraph/候选排名。**详见[一手来源复核](soccersapi-current-player-statistics-source-review-2026-10-09.md)与 [issue 100](../issues/100-soccersapi-current-season-bounded-smoke.md)。 |
| **FPL Core Insights** | 仓库声称提供 2026/27 球员逐场和高级统计，但数据文件未随仓库发布，且部分统计的来源不明。 | GitHub 可读；不能据 README 推断为稳定 API 或更新 SLA。 | 无正式数据许可证；上游 FPL/PL 权利和第三方统计再利用、公开展示、保存及 LLM/RAG 权限均未核实。 | **NO-GO。**不抓取、不下载、不导入。 |
| **foot.io** | 档案与当季统计目录字段丰富，潜在支持细分位置、推进、创造和防守；主要联赛当前球队关系/统计覆盖没有端到端验证。 | Free 计划需 beta 邀请；有限请求配额；无统一 freshness SLA。 | Terms 约束最少缓存、逐项上游许可及数据再分发；本地 LLM/embedding/RAG 未明确。 | **条件候选，待邀请和许可确认。**没有邀请或处理许可时不接入。依据：[官方条款](https://foot.io/terms)、[issue 39 关联复核](current-player-source-admission-refresh-2026-10-06.md)。 |
| **Yuvron Football API** | 文档列出 2026/27 具名统计、xG/xA、射门、传球、防守与评分；实际账户、覆盖和 freshness 未验证。 | 免费计划额度；需账户/API key。 | 找不到足以确认原始球员行持久保存、公开展示及本地 LLM/RAG 的数据许可。 | **NO-GO，等待书面确认。**依据：[2026-10-08 新来源筛查](new-current-season-player-source-triage-2026-10-08.md)。 |
| **OpenScores** | MCP/API 可提供球队、球员和近期出场上下文；指标 schema 与当前阵容完整度需实际核实，不是高级表现数据主库。 | 免费额度但需注册 key；文档称每日 ingest。 | 自有产品条款与上游数据授权链、持久向量化和具体 LLM/RAG 范围需分开确认。 | **只做过受限 MCP/schema smoke 设计；不进入候选池或模型。**依据：[OpenScores 复核](openscores-current-player-source-review-2026-10-06.md)、[issue 73](../issues/73-openscores-mcp-current-squad-smoke.md)。 |
| **Sportmonks / PlayerElo** | Sportmonks 有当前候选/统计适配器；PlayerElo 是外部整体表现信号。当前实际账户覆盖、可用赛季与响应字段仍待 live 核实。 | 需账户及 key；Sportmonks 深度需付费，PlayerElo key 未配置。 | 公开展示、缓存/本地留存及 LLM/RAG 边界未确认；PlayerElo 只有唯一 Reep ID 桥接后才可按 ID 查询。 | **默认关闭；不得把无凭据 fixture 称为 live 数据。**关联 [issue 20](../issues/20-licensed-player-provider-and-provenance.md)、[issue 32](../issues/32-query-scoped-player-source-contract.md)、[issue 43](../issues/43-playerelo-reep-identity-mapping.md)。 |
| **PitchAPI** | 免费 key 技术文档列出逐场球员表现和渐进/VAEP 等指标；赛季候选须从出场记录构建，且缺少完整 roster 端点。 | 需账户/API key；当前无 key，无 live 验证。 | SDK 明示返回数据由独立 Terms 管理，但本轮未找到该条款正文，数据权利、留存、公开和 LLM/RAG 均未确认。 | **只保留无模型 smoke 工具；不接入推荐链。**依据：[官方文档](https://pitchapi.dev/)、[issue 72](../issues/72-pitchapi-single-league-smoke.md)。 |
| **Understat / FBref** | 公开页面可见部分当前赛季球员统计；FBref 当前连接实测返回 403。它们不因此成为可批量抓取的 API。 | 页面读取无 key；无可依赖的 API SLA，FBref 已被拒绝。 | 自动抓取、缓存、AI 输入和公开数据使用边界未通过；不得绕过 403/访问控制。 | **NO-GO 自动采集。**可人工查阅或留作失败语义，不进入 Agent 工具。依据：[Understat 审查](current-season-understat-access-audit-2026-10-07.md)、[FBref 实测 issue](../issues/36-fbref-current-big5-provider.md)。 |
| **StatsBomb Open Data / IDSSE** | StatsBomb 是赛事选样的历史事件数据；IDSSE 是 2022/23 德甲/德乙 7 场实名事件与 tracking 样本。二者都不是当季完整候选池。 | 免费静态发布，无持续更新保证。 | IDSSE Figshare/论文明确 CC BY 4.0；StatsBomb 另有数据使用协议，不能从 Open Data 推断原始数据再分发、球员行公开展示或模型处理范围。 | **IDSSE 可作署名方法样本；StatsBomb 保持协议受限。**不以小样本证明赛季级球员排名。依据：[IDSSE 论文](https://www.nature.com/articles/s41597-025-04505-y)、[StatsBomb Open Data](https://github.com/statsbomb/open-data)。 |
| **SkillCorner Open Data / Impect** | SkillCorner 提供 2024/25 A-League tracking/聚合样本；Impect 提供 2023/24 德甲 KPI 静态文件。均为特定历史样本。 | 公开仓库/文件；无当前赛季持续更新承诺。 | SkillCorner repo 的 MIT 是代码许可，球员 CSV 数据、留存/公开/LLM 未明确；Impect 数据许可限制复制和对外再分发，模型处理边界未解决。 | **NO-GO 加入默认链路。**只保留隔离研究，不导入生产候选池。依据：[SkillCorner 复核](football-data-source-expansion-refresh-2026-10-04.md)、[Impect 复核](impect-vs-statsbomb-historical-pool-2026-10-07.md)。 |

## 决策

截至本次复核，没有找到同时具备广泛当前候选覆盖、细粒度可解释能力指标、稳定更新，且本项目可明确留存并提交本地 LLM/RAG 的单一免费来源。TactiScout 因此将候选发现、当前赛季比赛表现、历史事件样本、身份桥接、球员报告与人工观察分开建模；来源之间只经精确 ID 或经验证 crosswalk 关联，不把异质指标直接合成排序。

**近期工程路线**：FPL 和 ASA 保留为不同地域/范围的当前赛季技术验证路径，并持续显示许可未核实的限制；Wyscout 用于有署名的 2017/18 历史管线与 Harness；第一方观察作为需逐条授权的定性证据层。Live Football API 只有在获得书面确认后，才值得增加一条当前阵容/基础表现窄验证。不要继续为了“覆盖广”而并入没有数据处理许可或无法说明字段范围的爬虫结果。

## 来源核查索引

- [2026-10-08 当前球员来源补充复核](current-player-source-sweep-2026-10-08.md)
- [2026-10-08 新来源准入筛查](new-current-season-player-source-triage-2026-10-08.md)
- [官方当前赛季表现源审查](current-season-player-source-official-audit-2026-10-07.md)
- [官方联赛/赛事来源复核](overlooked-official-current-player-source-refresh-2026-10-07.md)
- [当前赛季球员来源路线](current-source-route-decision-2026-10-06.md)
- [FPL → Reep → Wyscout 身份桥接](fpl-reep-current-player-identity-bridge-2026-10-07.md)
- [Wyscout 实际数据 smoke](wyscout-real-data-smoke-2026-10.md)
