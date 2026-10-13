# Understat 五大联赛当前赛季实时字段核验

核验日期：2026-10-08。目的：判断能否把 Understat 作为用户明确要求扩展的当前球员表现来源，通过现有 TactiScout 数据仓库和 LangGraph 调查使用。此次只读取公开联赛页使用的只读 JSON 请求，不写入项目数据文件、不输出球员姓名或个人数值，也没有创建账户或调用付费服务。

## 结果

直接读取 Understat 当前赛季联赛页所使用的 JSON 路由，并携带网页 XMLHttpRequest 标记和对应官方联赛页 Referer。响应 `Content-Type` 为 `text/javascript;charset=UTF-8`，正文可由严格 JSON parser 解析；适配器不会执行 JavaScript。普通地址栏式请求不会复现此接口；站点未提供该路由的公开开发者文档，因此将其视为网页抓取路线，而不是稳定公共 API。

| 联赛页 | HTTP | 球员表现记录 | 球队 | 日期记录 |
|---|---:|---:|---:|---:|
| [英超 2026/27](https://understat.com/league/EPL/2026) | 200 | 421 | 20 | 380 |
| [西甲 2026/27](https://understat.com/league/La_liga/2026) | 200 | 461 | 20 | 380 |
| [德甲 2026/27](https://understat.com/league/Bundesliga/2026) | 200 | 367 | 18 | 306 |
| [意甲 2026/27](https://understat.com/league/Serie_A/2026) | 200 | 448 | 20 | 380 |
| [法甲 2026/27](https://understat.com/league/Ligue_1/2026) | 200 | 424 | 18 | 306 |
| **合计** |  | **2,121** | **96 个联赛/赛季球队槽位** |  |

EPL 字段及类型实测为：`id`, `player_name`, `games`, `time`, `goals`, `xG`, `assists`, `xA`, `shots`, `key_passes`, `yellow_cards`, `red_cards`, `position`, `team_title`, `npg`, `npxG`, `xGChain`, `xGBuildup`，均以字符串返回。位置观察到 `GK`、`D`、`M`、`F` 及其复合形式（如 `D M`、`F S`）；映射只保留首个宽组，不推断更细位置。年龄和稳定球队 ID 不在观察到的球员行内。

## 使用边界

- 页面内容能证明五个当前赛季统计页有上述记录和字段；它不能证明完整俱乐部注册名单、当前可签约状态、其他赛事覆盖或即时更新 SLA。
- 本次网络搜索未找到 Understat 对抓取、批量保存、本地模型处理或公开逐球员展示的官方 API/许可文档；这不是来源许可结论。用户此前已明确要求可以抓取公开网页并允许扩大数据来源，因此实现采用**显式选择的本地研究原型**路径；代码和报告继续标出处理权/展示权未核实，不把工程授权描述成 Understat 许可，不将原始 JSON 写入仓库。
- 应低频串行读取、进程内缓存、按 403/429 停止并报告错误；不使用备用域名、代理或隐形限流绕行。
- xG/npxG/xA、关键传球、xGChain、xGBuildup 只能依来源含义陈述。xG 不代表射门终结能力；xA 不等于完整机会创造；xGChain/xGBuildup 不等于渐进传球。跨赛事百分位需按同联赛、赛季、位置组计算。
- 用户提出年龄上限时，该来源无出生日期，不能执行年龄硬条件；必须请用户移除该条件或切换到可核实年龄的来源。

## 决定

为 `UnderstatPlayerRepository` 建立可选 `understat` 模式，不替换当前 `.env` 数据源。适配器串行读取五页、默认缓存 30 分钟、只保存在 API 进程内，并将字段和样本原样化为带来源 ID、来源页、赛事/赛季和抓取时间的 player profile。LangGraph 仍负责理解一句自然语言、分阶段调用搜索与评估工具、按缺口追问、约束结论证据，再由 Reviewer 检查推荐证据；来源抓取本身不进行球员推荐。

实现与全链路验收见 [issue 94](../issues/94-understat-five-league-conversation-chain.md)。
