# PitchAPI 扩大后的当前赛季覆盖与准入复核

复核日期：2026-10-08。先对照 [10-06 候选源路径](./current-season-player-source-path-2026-10-06.md) 与 [PitchAPI 历史来源比较](./additional-player-evidence-sources-2026-10.md)；本笔记只补查 PitchAPI 新近扩展的逐场比赛/球员数据覆盖和使用权，不重复已记录的 API 基本 schema。仅核对 PitchAPI 自己的文档及其 SDK 发布页；未注册、调用 API、下载或保存球员数据。

## 结论

**PitchAPI 仍是最强的“扩展现役球员表现证据”技术候选，但还不能准入 TactiScout 的本地仓库、LLM/RAG 或公开报告。**它相较当前已有来源的增量是宣称覆盖 77 项赛事，并在 2026-09-19 将新增的 26 项赛事重建为从 2024 赛季开始的逐场事件、球员统计、射门 xG 与高级分析；这些赛事包括 MLS Next Pro、USL Championship/League One、巴西乙级、卡塔尔、阿联酋、哥伦比亚和秘鲁顶级联赛等。该增量能扩展地域/赛事样本，不等于 77 项赛事都已验证 2026/27 完整度或每场都有高级指标。[覆盖与免费计划](https://pitchapi.dev/get-api-key) · [API 文档与 2026-09-19 更新记录](https://pitchapi.dev/)

| 维度 | 官方资料所述 | 对项目的实际含义 |
|---|---|---|
| 候选覆盖 | 免费 key 可读 77 项赛事，含顶级/次级联赛、杯赛与 UEFA；可通过联赛 ID 查询可用赛季和比赛。9 月重建的 26 项赛事明确从 2024 赛季起有逐场球员数据。[计划](https://pitchapi.dev/get-api-key) · [联赛与更新日志](https://pitchapi.dev/) | API 没有完整的 `player-season` 或注册球员目录端点；候选只能从当季已出场者的比赛记录构造。未出场球员、生日/年龄及当前注册完整性未解决，不能称为完整转会候选池。 |
| 个体指标 | 常规单场球员 stats 有分钟、进球/助攻、xG/xA、触球、盘带、传入进攻三区、解围、拦截、恢复球权、抢断、被过、空中/地面对抗；高级球员路由列出 xT、VAEP、推进传球/距离、推进带球、禁区传球、关键传球、传中、过人、防守动作、创造与射门等。[球员统计定义与路由](https://pitchapi.dev/) | 可为不同角色增加比 FPL fantasy stats 更直接的逐场能力证据，并可由 TactiScout 按分钟、位置和样本量自行聚合。部分定义由该 API 派生；例如 carries 是从相邻动作合成，不能误称为原始观测。26 个新赛事的 changelog 特别说明：球员评分缺失；拉脱维亚、委内瑞拉的部分机会创造统计不能从事件重建。 |
| 新鲜度 | 赛程/开球时间每天同步；比赛结束后记录填入赛果与分析。官方未给逐球员统计的赛后更新时间 SLA。[Fixture 更新说明](https://pitchapi.dev/) | 适合验证近况与已赛场次；报告应保存数据读取时间/赛季，并避免宣称实时。部分分析缺失会返回 `ANALYTICS_UNAVAILABLE`，这应呈现为来源覆盖缺口，而非球员零表现。 |
| 接入与成本 | HTTPS REST，所有数据请求都需注册 API key；服务方声明无费用、无请求配额，仍有 fair-use burst guard。官方 Python SDK 为 Beta；没有官方 TypeScript SDK 页面承诺，项目需直接对接 REST。[API key/计划](https://pitchapi.dev/get-api-key) · [SDK 与认证](https://pitchapi.dev/) · [SDK 发布页](https://pypi.org/project/pitchapi/) | 能以服务端工具接入 LangGraph，并可在用户选择的竞赛/赛季范围内按需取数；不要按“无限请求”推断可任意全库镜像。26 个新赛事的 player/team/match IDs 在 9 月重建时改变，需保留 provider 命名空间并允许重新解析。 |
| 自动获取、保存、LLM/RAG、展示 | SDK 发布页明确：MIT 许可只覆盖 SDK，API 服务及返回的足球数据另受 PitchAPI Terms 管理。当前可见 API/get-key 文档未链接条款正文；本次未找到官方公开许可文字明确允许自动批量同步、持久本地保存、向模型发送球员行、embedding/RAG、公开逐人展示或再分发。[SDK 的条款提示](https://pypi.org/project/pitchapi/) · [API key 页](https://pitchapi.dev/get-api-key) | **这些数据处理权均未知，先视为未获确认。**同时，文档未列明原始赛事事件数据的上游来源/授权链。免费和可访问不代表这些用途已许可。 |

## 与现有来源的增量

| 已有来源 | 已覆盖的长处 | PitchAPI 可补充之处 |
|---|---|---|
| FPL / Premier League Pulselive | 英超当前名单或丰富 EPL 球员表现 | 多联赛与次级赛事统一逐场 schema；但不替代英超专有统计，也未解决当前名单/年龄。 |
| ASA | 北美部分当前赛事的 xG、xPass、Goals Added | MLS Next Pro、USL、南美与西亚等更广的联赛线索及同源逐场事件；ASA 的模型指标口径不应与其混算。 |
| Understat | 五大联赛的赛季 xG/xA 等进攻维度 | 传球、推进、持球、防守动作与逐场语境；官方文档未提供某联赛完整赛季的端到端覆盖保证。 |
| Curated Wyscout | 可复现、有署名的 2017/18 历史事件集 | 2024 起的更多当前/近年逐场样本；新赛事仍须逐联赛、逐指标验证，不能与历史快照混成同赛季排名。 |

## 建议的下一步 spike 与阻塞项

**先做 PitchAPI 书面准入核实，再做最多三项赛事 × 三场已结束比赛的无模型 coverage smoke。**书面确认须覆盖：上游数据来源及其许可；按 REST 自动读取；本地短期/长期缓存与作品集部署；将必要球员事实发送给本地 Ollama；是否允许 embedding/RAG；是否可公开具名球员与派生指标；署名、撤回和留存期限。API 文档有反馈入口，但未找到明确法律联系邮箱；可以从其支持/注册渠道索取当前 Terms URL 与上述答复。

准入后才用 bounded smoke 检查 2026/27 欧洲赛季及 2026 日历年赛事是否可列出、候选 ID 稳定性、单场可用分钟/位置、目标推进与防守指标非空率、`ANALYTICS_UNAVAILABLE` 比例和 26 个新赛事评分缺失语义。达到这些条件前，不实现 provider、不把真实响应落盘/送模型，也不在 UI 宣称“77 联赛完整覆盖”。**当前阻塞不是 LangGraph 技术，而是数据处理授权、上游来源透明度及成人/注册名单缺口。**

## 官方一手来源

- PitchAPI：[API reference、指标字典、联赛覆盖、更新日志](https://pitchapi.dev/)
- PitchAPI：[免费 API key、计划与 77 项赛事声明](https://pitchapi.dev/get-api-key)
- PitchAPI SDK：[PyPI 页面；明确说明数据权利由独立服务条款管辖，SDK MIT 不授予数据权利](https://pypi.org/project/pitchapi/)
