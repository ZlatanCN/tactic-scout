# 当前球员表现来源扩展复核

核查日期：2026-10-09。目标是在已覆盖/审查的 FPL、Understat、ASA、Wyscout、SoccersAPI 等之外，寻找能增加当前球员池或表现指标、且有实际复用路径的来源。先检查了 issue 111 引用的研究和现有来源矩阵；foot.io、Rising Transfers、OpenFootAPI 等并非新候选，本报告只复核与本轮决定相关的官方证据。没有创建账号、调用 API、抓取/下载球员数据或修改代码。

## 决定

**本轮没有发现可立即准入的新来源。**

新查到的 Liga Portugal 官方球员统计页确实带来葡萄牙当前赛季和对抗/恢复等指标线索，但它是有限排名页面，未见可复用的官方开发 API；其现行条款只授予个人、非商业的浏览权，并明确禁止复制、下载、改编、制作衍生内容及保留站点内容。因此本项目不得对它做自动访问、落盘、模型/RAG 处理或作品集展示。

在已评估来源中，**foot.io 仍是最有希望的条件候选，但不是本轮新发现或已准入数据源**：它的官方目录提供跨地区球员档案和赛季统计 schema，并声称只对外提供有明确再分发权的行；不过访问仍是 invite-only，公开的当前赛季和统计覆盖计数主要截至 2026-08-06/10，目标联赛的统计行、当前俱乐部关联、逐行上游许可及本地模型用途均未验证。不得在获得邀请和逐源许可确认前把它接进 Agent。

## 最强条件候选：foot.io（既有候选，条件 NO-GO）

- **球员池与指标：**官方目录记载 304,446 个球员档案，可含出生日期、粗/细位置、惯用脚和外部 ID；`player_season_stats` 有出场、进球、助攻、分钟、射门、射正、关键传球、渐进传球/带球、射门/进球创造、传球、抢断、拦截、争顶、成功盘带、纪律、零封和扑救等列。字段存在不表示每行都有值。xG/xAG 与逐射门事件不在任何档位提供；官方称付费层有 344,937 条过许可门的数据，免费层只读其中当前赛季切片。统计来源可以重复，需固定 `stat_scope` 并按 source 去重。[官方数据目录](https://foot.io/data-catalogue) · [官方 API 文档与字段/语义](https://foot.io/docs) · [机器可读 OpenAPI schema](https://foot.io/openapi-v2.yaml)
- **公开总量存在页面口径差异：**数据目录仍列 304,446 名球员（2026-08-06 测量），API 文档则列 311,637 名（2026-08-10 测量）。日期和页面口径不同，不能把任一数字当成完整可用的当前球员池；后续需供应方说明定义，并用获准 key 的目标赛季查询实测。[数据目录](https://foot.io/data-catalogue) · [API 文档](https://foot.io/docs)
- **当前季证据与时效：**官方文档明确举例 Argentine Primera División 2026（`season_id=1415`）作为当前赛季，并给出 `player_season_stats` 的查询例子；Free 层公布的是“196 个比赛目录中有当前赛季比赛”，不等于这 196 个赛事都有当前球员统计或完整候选池。五大联赛的阵容/比赛事件未通过其许可门。目录/样例的核验日期是 2026-08-06，当前没有对欧洲 2026/27 各联赛球员统计的实测或 freshness SLA。[官方文档中的当前赛季例子、许可门和 freshness 边界](https://foot.io/docs) · [官方目录测量日期与可服务行数](https://foot.io/data-catalogue)
- **技术访问/价格：**文档发布了 PostgREST REST 及 OpenAPI 3.0.3 schema；过滤、嵌套、分页可用，页面大小硬上限 1,000。Free 标价 $0、每月 5,000 次/每分钟 30 次，但 key 目前 invite-only，公开注册是 waitlist，且没有 self-serve 账户/购买或 SLA。[API 文档](https://foot.io/docs) · [套餐与当前服务状态](https://foot.io/api-landing.html) · [官方候补名单](https://foot.io/signup)
- **权限拆分（不是一张通用数据许可）：**

  | 用途 | 官方文本支持的边界 | 当前判定 |
  |---|---|---|
  | 单条 API 使用 | 仅在获邀 key 的内容层、请求限制和每条上游来源许可允许时使用；数据目录称每一档只返回有明确再分发权的行。 | 获邀前不调用；拿到 key 后仍逐行检查 source/provenance。 |
  | 本地缓存/持久化 | 服务条款允许缓存应用所需的最少响应，但明确以相应上游许可为条件。 | **短期最少缓存有条件依据；长期本地数据库保留期限没有通用授权。** |
  | 本地 Ollama 推理 | 条款允许内部工具、分析或研究，但也要求每条来源许可允许该用途；条款没有明确点名本地 LLM inference。 | **未知，须书面确认；不能把“有再分发权”当成本地模型许可。** |
  | embedding / 私有 RAG | 条款禁止把数据集或重要子集以 vector store / training corpus 等形式提供给第三方；私有本地索引或 embedding 是否允许、如何受上游条款约束，没有明确回答。 | **未知。** |
  | 派生分析/报告 | 条款允许在来源许可范围内做内部分析；允许应用展示带来源归因的事实，也允许嵌入可视化，但通用服务条款不替代上游条款。 | **内部派生分析有条件允许；公开的逐球员排名/报告需逐来源确认。** |
  | 公开作品集 | 条款允许网站/应用展示事实并保留逐行来源归因；禁止向第三方再分发原始/近原始库或重要子集（大约单资源超过 5,000 行，或能让第三方绕过授权访问的导出）。 | **少量、署名事实展示有条件依据；完整候选池、原始导出和公共向量库不允许；公开排名/报告需问清来源许可。** |

  以上约束见[服务条款 v2.2](https://foot.io/terms)（缓存/内部分析/展示：第 6–12 条；向第三方提供原始、近原始数据集/向量库限制：第 13–17 条；来源归因和上游责任：第 27–37 条）。服务方“只提供有明确再分发权的数据行”的许可门控声明，不等于授予用户完整数据库长期保存、模型处理或公开衍生排名权。

**后续技术 smoke 仅在收到邀请后考虑：**对官方已举例的 Argentine Primera División 2026 做一次只读、`stat_scope=league`、最多 20 行、内存处理的 no-model 检查；检查候选/统计行是否存在、年龄/位置/分钟空值、`source`、scope、稳定关联和检索时间。不写磁盘、不做向量化、不传模型。该 smoke 只能验证 API 返回形状和小样本覆盖，不能证明联赛完整度。之后再单独决定是否向本地模型/RAG 与公开演示开放。

## 新发现的官方线索：Liga Portugal（不准入）

- 官方赛季页标明 2026–27，并展示球员榜和宽位置；官方可检索页面能看到进球、助攻、扑救榜，单球员资料页展示年龄、球队、位置以及进球、助攻、射门、恢复球权、拦截等。Fantasy 规则另外定义分钟、射正、关键传球，以及解围/封堵/拦截/抢断等 CBIT 防守计分项。这说明它在地域与观测指标上可能补充现有数据，但这些类别不代表所有指标都有完整赛季球员行。[官方 2026/27 赛季/球员榜](https://www.ligaportugal.pt/competition/618/liga-portugal-betclic/round/20262027?stat=players&tab=stats&type=3) · [官方球员资料字段示例](https://www.ligaportugal.pt/player/83690/flavio-g./20262027/303) · [官方 Fantasy 计分定义](https://fantasy.ligaportugal.pt/help/rules)
- 目前能核实到的是排名榜输出，官方页面索引展示前 20 项；我没有找到全名单、分页/导出功能的官方文档，也没有查到公开 API 文档、稳定机器接口、schema、调用配额、价格或自动刷新 SLA。条款称内容会尽力在发布前更新，但不保证绝对准确；没有可引用的赛后刷新承诺。[官方条款：信息更新与准确性](https://www.ligaportugal.pt/pages/termos-e-condicoes)
- 官方条款要求注册并登录，个人/非商业使用；仅授予有限浏览许可，明确禁止复制、下载、改编、衍生作品和任何保留内容。条款还限制公开传播/改造内容，故即便项目本身非商业，也没有批量落库、本地 LLM/RAG、基于其统计生成球员报告或公开展示的授权。[官方条款：访问/接受方式及许可](https://www.ligaportugal.pt/pages/termos-e-condicoes)
- **判定：NO-GO。**不自动请求官方页面、不读取未公开接口、不存储球员统计，也不将其加入 LangGraph 工具。若未来真要用，先请求 Liga Portugal 对 machine-readable 球员统计 feed、留存、本地模型/RAG、派生报告和公开作品集逐项书面授权；当前页面条款已经排除默认复用。

## 有界检索中排除的近似候选

| 候选 | 排除原因与一手依据 |
|---|---|
| The Viking Striker | 发布方明确授权其经人工核验的比赛日志按 CC BY 4.0 复用，包含赛季、分钟、进球/助攻、首发、来源与核验时间；但它只发布 Erling Haaland 一名球员的数据，不是可发现其他候选人的池，也没有职位/年龄/战术指标。[发布方开放数据页及许可/字段](https://thevikingstriker.com/data) |
| OpenFoot API | 官方 API 有赛程、赛果、射手榜、球队阵容、比赛事件/首发以及 xG 比赛情报；未提供球员赛季能力统计池。射手榜/单队阵容不足以替代全联赛球员表现与完整候选名单。[官方 API 文档与 endpoint 列表](https://openfootapi.com/docs) · [官方 Coverage](https://openfootapi.com/coverage) |
| Rising Transfers | 仓库 CC BY 4.0 数据是 2026 世界杯球员名单与 2025/26 赛季 per-90 静态指标，已有 2026-10-08 研究；不是 2026/27 当前俱乐部赛季来源，因此本轮不重开。[发布仓库及赛季/许可说明](https://github.com/risingtransfers/world-cup-2026-data) |

## 精确下一步

1. **不要为扩大来源而接入 Liga Portugal。**若项目方认为葡超值得投入，先向 Liga Portugal 数据/商业权利方书面询问授权，不做抓取或数据 smoke。
2. **沿用既有 foot.io 准入任务，不重复实现 provider。**若仍想争取当前赛季扩源，由项目负责人通过[官方 waitlist](https://foot.io/signup)申请研究用邀请，并发邮件至 `hello@foot.io`，要求确认目标联赛/赛季的当前 player stats 行数与来源、完整球员关联和 freshness；另逐项问最少缓存期限、本地 Ollama 推理、私有 embedding/RAG、派生排名、公开作品集显示和归因。只有收到邀请并得到逐源书面许可后，才执行上面的 20 行 no-model、内存 smoke。
3. 若邀请或授权无法取得，本轮**不新增 provider**；把当前数据可用范围作为产品状态显示，不把 fixture、搜索引擎榜单或静态上赛季数据描述成完整的现役转会市场。

## 核查的一手来源

- [foot.io API 文档 / schema / 当前季示例](https://foot.io/docs) · [OpenAPI 3.0.3 文件](https://foot.io/openapi-v2.yaml) · [数据目录](https://foot.io/data-catalogue) · [Free / invite-only 服务状态](https://foot.io/api-landing.html) · [服务条款 v2.2](https://foot.io/terms) · [waitlist](https://foot.io/signup)
- [Liga Portugal 官方统计页](https://www.ligaportugal.pt/competition/618/liga-portugal-betclic/round/20262027?stat=players&tab=stats&type=3) · [球员资料示例](https://www.ligaportugal.pt/player/83690/flavio-g./20262027/303) · [Fantasy 官方计分规则](https://fantasy.ligaportugal.pt/help/rules) · [使用条款](https://www.ligaportugal.pt/pages/termos-e-condicoes)
- [The Viking Striker 开放数据许可/字段](https://thevikingstriker.com/data) · [OpenFoot 官方 API 文档](https://openfootapi.com/docs) · [OpenFoot 官方 Coverage](https://openfootapi.com/coverage) · [Rising Transfers 2026 World Cup 数据仓库](https://github.com/risingtransfers/world-cup-2026-data)
