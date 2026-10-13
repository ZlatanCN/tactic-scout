# 加拿大职业联赛当季球员表现路线筛查（2026-10-10）

## 建议

**结论：先向权利方申请正式 feed/schema 和逐项书面许可；当前不做 API smoke、不抓取、不接入或落盘。**本轮找到两个此前未出现在项目来源矩阵中的当季官方统计路线：Canadian Premier League（CPL，男足）和 Northern Super League（NSL，女足）。它们带来的是加拿大赛事覆盖，NSL 还可作为独立女足候选池；都不是全球转会市场，也都没有公开的、可供本项目自动查询的球员数据 API 合约。

对当前默认的男子引援案例，CPL 是更相关的问询对象：官方页面有 2026 赛季球员统计入口，当前规则确认 Opta/Stats Perform 仍是联赛数据提供方。但当前网页未能验证完整球员字段或全池，且 CPL 的历史邮件订阅数据计划和当前网页统计不能证明 2026 原始记录可供本项目留存、交给 Ollama/RAG 或放入公开作品集。NSL 的 2026 球员统计表字段更清楚，但只覆盖加拿大职业女足；应只在产品明确接受女足请求时列为候选。

## 核查边界

先对照了 [`docs/data-sources.md`](../../../docs/data-sources.md)、[`CONTEXT.md`](../../../CONTEXT.md) 和 2026-10-07 至 2026-10-09 的来源报告。近期已审过的 ASA、FPL、Understat、K League、Saudi Pro League、Liga MX、NCAA、SoccersAPI、SPL、UEFA 等路线未作为新发现；本次只增加此前未见于来源矩阵的 CPL 和 NSL。两者均是加拿大联赛，但赛事、性别与数据页面各自独立，不能合并成一个统计池。

只检查联赛/权利方公开页面、官方规则、官方条款及联赛/数据供应商发布材料；没有发 API 请求、注册账户、提交表单、用凭据、下载数据文件、抓取页面或保存球员行。报告不记录球员姓名、数值或排名。这里的“公开可读”只表示人工网页可查看，不表示获得了自动读取、缓存、模型处理或公开展示许可。

## 候选比较

| 维度 | Canadian Premier League（CPL，男足） | Northern Super League（NSL，女足） |
|---|---|---|
| **赛事与候选池覆盖** | 官方 2026 竞赛规则列出 8 家俱乐部、单表制常规赛，并给出 2026-04-04 至 2026-10-25 的赛季窗口；官方统计中心列有 2026 赛季及球员统计、球员比较入口。[2026 竞赛规则](https://www.cplsoccer.com/competition-guidelines) · [CPL 统计中心](https://www.cplsoccer.com/statistics/index) | 官方称 NSL 是加拿大职业女足联赛，覆盖六座城市和六家俱乐部；官方统计页提供当前 2026 赛季球员统计。[联赛介绍](https://www.nsl.ca/about-us) · [NSL 球员统计](https://www.nsl.ca/stats?tab=player-stats) |
| **当前季及字段证据** | 联赛当前官方规则仍把 Opta/Stats Perform 列为 U-21 分钟核算的数据方，证明该数据供应关系服务于 2026 赛季；统计中心当前有 2026 赛季和球员统计入口。网页阅读器无法呈现该中心的完整球员表，因此**没有验证 2026 球员字段字典、行数或完整度**。官方 2019 Centre Circle Data（CCD）公告称其历史数据包含逐触球级传球、射门、防守和门将信息，并提供邮件订阅数据；这是 2019 历史项目说明，不可当作 2026 的字段/免费访问承诺。[CPL 2026 规则](https://www.cplsoccer.com/competition-guidelines) · [2019 Centre Circle Data 项目说明](https://www-archive.canpl.ca/centre-circle-data/) · [Stats Perform 公告](https://www.statsperform.com/es/press/canadian-premier-league-announces-new-initiative-to-share-stats-perform-data/) | 2026 球员榜字段包含出场、首发、分钟、进球、助攻、射门、射正、触球、抢断、越位、赢得/犯规、牌，以及门将扑救、传球准确率等。它能提供分钟上下文、进攻量、触球和有限防守参与证据；未见 xG、渐进传球/带球、压迫、夺回、空中对抗或细分职责数据字典。[NSL 球员统计](https://www.nsl.ca/stats?tab=player-stats) | 
| **更新与新鲜度** | 官方赛程规则证明 2026 赛季正在进行到 10 月下旬；统计中心显示 2026 赛季选项。没有逐字段更新时间、刷新延迟承诺或 freshness SLA。[CPL 2026 规则](https://www.cplsoccer.com/competition-guidelines) | 官方统计和赛程均标记 2026 赛季，当前榜包含赛季累计记录；没有字段更新时间、刷新延迟承诺或 freshness SLA。[NSL 球员统计](https://www.nsl.ca/stats?tab=player-stats) · [NSL 官方首页](https://www.nsl.ca/) |
| **机器访问、免费与费用** | 有公开统计网页，但未找到外部开发者 API 文档、稳定 schema、身份 ID、分页/限额或定价。2019 CCD 曾是免费邮件订阅，但表单要求同意专门用途条款并有 CAPTCHA；当前公开页面没有证明该订阅仍提供 2026 球员行。当前机器接口和费用均未知。[CCD 历史项目页](https://www-archive.canpl.ca/centre-circle-data/) · [CPL 统计中心](https://www.cplsoccer.com/statistics/index) | 有公开统计页；没有公开开发者 API、schema、key、请求配额、费用或更新 SLA。网页免费浏览不能证明有免费可编程访问。[NSL 球员统计](https://www.nsl.ca/stats?tab=player-stats) |
| **自动化与保存** | CPL 媒体证件条款写明 CPL 比赛及比赛数据的所有权和专有权利保留给 CPL/权利方，并限制持证者向平台分发。该条款针对媒体证件情境，不足以单独裁定普通网页访问者的所有权限；结合缺少当前 feed 许可，自动收集和持久保存**未获证明**。[媒体证件条款](https://www.cplsoccer.com/media-accreditation-terms) | NSL 条款规定网站内容仅限个人、非商业、信息性用途；系统性提取以建立集合/数据库须事先取得明确书面许可。故当前不自动采集或落盘。[NSL 使用条款](https://www.nsl.ca/terms-of-use) |
| **本地模型、RAG 与公开作品集** | 没有公开文本明确允许将 2026 球员记录输入本地 LLM、创建 embeddings/本地 RAG、保留原始/派生统计或在作品集中具名展示。都需向 CPL/Stats Perform 逐项问清；不能从旧版免费数据公告或网页可见性推定允许。[CPL CCD 历史项目页](https://www-archive.canpl.ca/centre-circle-data/) · [CPL 媒体证件条款](https://www.cplsoccer.com/media-accreditation-terms) | 条款没有为本地模型/RAG 或应用中的球员数据展示提供明确授权；条款的一般个人信息用途许可不能外推为球员统计的模型/作品集许可。须取得 NSL 书面授权。未经许可，不应将页面数值纳入本地模型、向量索引或报告。[NSL 使用条款](https://www.nsl.ca/terms-of-use) |
| **当前结论** | **优先申请授权和 schema；不做 smoke/抓取/集成。**对当前男足目标有地域增量，但当前季球员池完整度、API 和所有处理权都待确认。 | **女足扩展的条件候选；当前不自动访问或集成。**字段比 CPL 当前可验证页面更清楚，但赛事范围窄，且系统性获取明确需要书面许可。 |

## 未知项与下一步

### CPL：首选权限问询

向 CPL / Stats Perform 索取受支持的 2026 球员数据 feed/schema 或明确说明是否仍开放 CCD；先确认这些事项，再决定是否做不落盘、无模型的受限 coverage smoke：

1. 2026 当前球员池是否有完整、稳定的球员/球队/赛事 ID；是否含 roster/生日/位置，哪些赛事统计按来源分钟覆盖；
2. 外部机器读取入口、分页、配额/价格、更新频率和停止服务后的留存规则；
3. 能否用于本机数据库/缓存，以及允许保留期限；
4. 能否将字段交给本地 Ollama 推理、embedding、RAG 和 LangGraph checkpoint；
5. 能否公开展示球员姓名、数值、来源、TactiScout 派生分析和作品集截图，以及署名要求；
6. Stats Perform 上游数据许可是否覆盖以上每一种用途。

只有取得覆盖目标用途的答复/条款后，才做最小 smoke；smoke 只输出覆盖计数、非空字段率、样本/赛季边界和来源 ID 结构，不持久化球员行。

### NSL：仅在产品纳入女足请求时问询

由 NSL 确认其官方页面数据是否有可供研究/小型作品集使用的机器 feed，以及如何授权系统性提取、缓存、处理、展示、用于本机模型/embedding/RAG。NSL 官方联系页列有通用联系渠道；报告不替用户发送邮件。[NSL 联系页](https://www.nsl.ca/contact)。在书面授权前，只保留来源说明，不建抓取器或向量库。

## 来源索引

- CPL：[2026 竞赛规则与 Opta/StatsPerform 数据方说明](https://www.cplsoccer.com/competition-guidelines) · [当前统计中心](https://www.cplsoccer.com/statistics/index) · [2019 Centre Circle Data 项目说明](https://www-archive.canpl.ca/centre-circle-data/) · [Stats Perform 公告](https://www.statsperform.com/es/press/canadian-premier-league-announces-new-initiative-to-share-stats-perform-data/) · [媒体证件中的比赛数据权利条款](https://www.cplsoccer.com/media-accreditation-terms)
- NSL：[联赛介绍](https://www.nsl.ca/about-us) · [2026 球员统计](https://www.nsl.ca/stats?tab=player-stats) · [使用条款](https://www.nsl.ca/terms-of-use) · [联系页](https://www.nsl.ca/contact)
