# K League 官方当季球员表现 API 评估

核查日期：2026-10-09。对照 TactiScout 已有的 FPL（英超）、Understat（五大联赛）、ASA（北美）、Wyscout 历史样本及本日已审查的 SoccersAPI。本次只查看 K League 官方统计页、API 文档和门户条款；没有申请 key、调用 API、抓取或下载球员数据。

## 结论

**K League Official Open API 是本轮发现的最有增量价值的当前表现源：它能把韩国职业联赛加入覆盖，并提供传球、关键传球、盘带、对抗、抢断、拦截、解围和恢复球权等比赛表现字段。** K League 官方统计页在 2026-10-09 已显示当季 K League 1 球员数据；API 文档还定义 K League 1/2 的赛季/比赛查询参数与逐场球员记录。[当前球员榜](https://www.kleague.com/record/player.do?leagueId=1) · [官方 API 概览](https://api.kleague.com/docs/index.jsp) · [逐场球员记录](https://api.kleague.com/docs/api_match_player_record.jsp)

**这是需要先拿到权利方批准的候选，并非现在可直接接入的免费开放数据源。** API 文档面向合作伙伴集成且所有示例都要求 `authKey`；错误码还明确存在端点授权、每日配额、来源 IP/域名限制。K League 数据门户条款要求事先许可才可复制或保存其记录/资料；公开资料不足以确认仅本机非商业原型调用是否获准，更没有确认本地缓存、交给本地 LLM、embedding/RAG 或作品集展示。拿到书面授权前，不应把页面抓取或 API 调用当作获准路线。[API 概览与访问错误](https://api.kleague.com/docs/index.jsp) · [门户使用提示](https://portal.kleague.com/mainFrame.do) · [门户服务条款](https://portal.kleague.com/user/service/userTermsNice.do)

## 对候选池的实际增量

| 维度 | 官方资料能证明的内容 | TactiScout 的增量与限制 |
|---|---|---|
| 地域与当季 | K League 1 官方球员榜标注“2026.10.09 当前”，并显示球员、球队、进球、助攻、射门、出场等当季数据。API 文档将 `meet_seq=1` 标为 K League 1、`meet_seq=2` 标为 K League 2。[球员榜](https://www.kleague.com/record/player.do?leagueId=1) · [赛程 API](https://api.kleague.com/docs/api_match_schedule.jsp) | 新增韩国联赛，补现有欧洲/北美数据面。网页当前快照直接证实的是 K League 1；K League 2 的参数映射有文档支持，但其当季记录覆盖仍须获得授权后验收。不是全球候选池。 |
| 赛季汇总 | `/api/playerRank.do` 按赛季/赛事返回球员出场、分钟、进球、助攻、总射门、射正、犯规、被犯规、越位、牌、MOM/最佳阵容次数及评分/排名；`seasonYN=Y` 会将赛季内转会球员合并成一行。[Player Rank API](https://api.kleague.com/docs/api_pl_rank.jsp) | 足以做初筛、出场量语境和基础进攻产出。文档未说明返回列表的分页、完整注册名单边界或所有球员的最小出场阈值；不可直接声称这是经过验证的全量候选池。 |
| 战术表现 | `/api/matchPlayerRecord.do` 按赛季、赛事、球队、比赛取逐场球员记录，含位置和分钟；扩展字段由 Bepro11 视频数据提供，包括关键传球、盘带及成功率、前向/区域/长短传及准确率、传中、进攻区域进入、受压处理、地面/空中对抗、抢断成功、拦截、解围、阻断、恢复球权和门将动作。[逐场球员记录 API](https://api.kleague.com/docs/api_match_player_record.jsp) | 比现有基础球员榜补出更多有球/无球可观察表现指标。文档未定义坐标、逐动作事件、压迫次数、预期进球/助攻或渐进传球/带球；“前向传球”不应被改称 progressive passing。该接口按场查询，构建赛季汇总需评估多场调用量。 |
| 更新和数据来源 | 官方网页当前榜给出 `2026.10.09` 数据时间。K League 门户说明官方记录在球场实时采集，补充数据由 Bepro11 提供、基于视频且实时更新；官方记录与补充记录可能不同，供应商变化也会导致部分年份缺字段。[当前榜](https://www.kleague.com/record/player.do?leagueId=1) · [门户数据说明](https://portal.kleague.com/mainFrame.do) | 有当前赛季的直接证据和数据来源区分，但没有公开 API 刷新 SLA，也没有证明当前 API 对全部比赛/字段完整。系统需要分开标记官方统计与 Bepro11 派生记录，并保留观测时间和缺失语义。 |

## 接入、费用与使用权

| 项目 | 核查结果 |
|---|---|
| API 形态 / 身份验证 | 官方称其为 K LEAGUE Official Open API，但说明用途是让“合作伙伴公司”稳定集成数据。播放器和逐场接口都要求 `authKey`，当前推荐请求头传递。API 概览列出无 key、无权限、超每日额度、IP/域名未授权等错误。文档没有公开申请流程或 key 自助发放。[概览](https://api.kleague.com/docs/index.jsp) · [Player Rank](https://api.kleague.com/docs/api_pl_rank.jsp) |
| 配额 / 价格 | 文档确认存在每日 API 调用额度，但未给额度数字；本次未找到公开价格表。不能把“Open API”或无公开价格解释为免费。逐场指标需要每次提供 `meet_year`、`meet_seq`、`team_id`、`game_id`，实际额度能否支撑整季扫描未知。[逐场记录](https://api.kleague.com/docs/api_match_player_record.jsp) |
| 开发者门户 | 官方文档把在线申请、自动发 key 的数据门户列为 2027 年“准备中”，说明本日查到的公开文档还没有自助授权通道。[API 路线图](https://api.kleague.com/docs/index.jsp) |
| 本地非商业原型 | **公开条款不足以确认获准。** 数据门户提示除新闻报道外，未经联盟事先许可不得复制、保存、分发或销售记录/数据；服务条款也禁止未经许可复制、出版、广播或提供给第三方。API 自身是否另有授权文本、其适用范围以及纯本机临时调用是否允许，未见公开说明。故本地非商业属性本身不能当成已取得许可。 [门户提示](https://portal.kleague.com/mainFrame.do) · [服务条款第 4–5 条](https://portal.kleague.com/user/service/userTermsNice.do) |
| 缓存 / 模型 / 展示 | API 文档提到 ETag 是流量优化方法，不代表允许本地长期保存。现有公开资料没有确认缓存期限、向本地 LLM 输入数据、embedding/RAG、生成具名派生排名、对外作品集展示或署名/供应商权利。以上均为**未知，需取得书面用途许可**。[API 缓存说明](https://api.kleague.com/docs/index.jsp) |

## 建议

将 K League 记为**优先授权评估**，先联系 K League / Bepro11，书面确认 API key 和费用、K League 1/2 当季覆盖、日配额、比赛与球员记录完整性、Bepro11 指标的上游许可，以及本地保存、本地推理/RAG、派生分析和公开作品集各自的授权范围。获得答复后，再以 K League 1 单季小样本核对球员 ID、位置、分钟、场次和字段缺失率，并验证按比赛拉取是否能在配额内形成当季数据。若拿不到许可，就只保留官方页面作人工参考；**不爬网页、不调用未获授权的 API**。

## 官方来源

- [K League 当前球员榜（2026-10-09 快照）](https://www.kleague.com/record/player.do?leagueId=1)
- [K League Official Open API 概览、鉴权错误与 2027 门户路线图](https://api.kleague.com/docs/index.jsp)
- [赛季球员排名/聚合统计 API](https://api.kleague.com/docs/api_pl_rank.jsp)
- [逐场球员记录 API（含 Bepro11 视频补充指标）](https://api.kleague.com/docs/api_match_player_record.jsp)
- [赛事/联赛元信息 API](https://api.kleague.com/docs/api_info_league.jsp) · [K League 1/2 赛事编号](https://api.kleague.com/docs/api_match_schedule.jsp)
- [K League 数据门户说明](https://portal.kleague.com/mainFrame.do) · [K League Portal 服务条款](https://portal.kleague.com/user/service/userTermsNice.do)
