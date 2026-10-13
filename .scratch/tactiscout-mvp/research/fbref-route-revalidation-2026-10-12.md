# FBref 路线官方来源复核

核查日期：2026-10-12。此记录是对 2026-10-11《[FBref 403 后的免密男足球员数据源复核](./current-no-key-men-player-sources-after-fbref-403-2026-10-11.md)》中 FBref 部分的增量核查：只查 Sports Reference 官方条款、数据使用说明、bot 流量指导和官方公告；不请求 FBref 球员/统计页，不重试既有 Big Five 请求，不抓取或绕过访问控制。已有 403 事实来自 [issue 36](../issues/36-fbref-current-big5-provider.md) 记录的 2026-10-04 请求。

## 结论

**没有官方证据表明 2026-10-04 的单次 Big Five HTTP 403 意味着 FBref 或 Big Five 页面永久不可用；也没有证据表明该请求现已恢复。**Sports Reference 的 2022-10-07 官方 bot-filtering 公告说服务器封锁会在 24 小时后重置；当前 bot 指导（页面标注 2022-10-26、更新于 2024-05-29）说违规 session 最长封锁一天。两者都没有把 HTTP 403 映射为永久封禁，也没有专门解释 Big Five 的 403。因为本次禁止重试，403 是否已消失仍未知。

操作上，403 仍应是**该次抓取/批次的终止信号**，按 issue 36/37 的既有设计停止同批次请求；但不要把它记录为“来源永久下线”。这不改变 2026-10-11 的产品建议：在取得明确许可前，FBref 自动数据不能接入本项目会把统计数据交给 AI 的链路。许可问题独立于某次 HTTP 状态码。

## 一手证据

| 官方来源 | 可核实的原文事实 | 对 issue 36 的含义 |
| --- | --- | --- |
| [Sports Reference Terms of Use](https://www.sports-reference.com/termsofuse.html)（页面标注最后更新 2023-05-19） | §5(i) 限制未经明确书面许可、且不利影响站点性能或访问的自动化访问；§5(j) 限制将站点材料（包括统计和数据）用于训练、微调、prompt 或 instruct AI，涵盖生成回答、文本、分数、统计和支持预测/分类/评分。§5 的原则同时说，通常欢迎带来源标注地分享单个网页数据，但明示限制优先适用。 | 非商业作品集不是 §5(j) 所写限制的例外。当前 Agent 把球员统计交给模型分析，因而不能仅凭网页可读、低频或署名就认定这条自动化链路获准。该结论来自文本条款，不是对具体法律结果的判断。 |
| [SR and Data Use](https://www.sports-reference.com/data_use.html)（本次检索可见官方页面内容） | 复述上述自动化和 AI 限制，并直说未经许可不应基于抓取数据创建网站/工具，也不应将数据用于生成式 AI；警告不要 aggressive spidering，过量活动可能导致 IP 被封。 | 比较 issue 36 的完整用途（自动抓取、缓存、模型输入和对外展示）时，应按许可未确认处理；遇拒绝不得换身份、代理或路径继续取数。 |
| [Bot/Scraping/Crawler Traffic](https://www.sports-reference.com/bot-traffic.html)（页面标注 2022-10-26，更新 2024-05-29） | 官方称会封锁 FBref/Stathead 每分钟超过 10 次的请求，违反者 session 最长“jail”一天；页面同时说明第三方数据协议导致其不能提供可下载 API。此阈值是限流描述，不是低于阈值即可自动抓取的许可。 | 支持拒绝后停止和不把无 API 当作可以自建抓取接口；不提供 403 的永久性判定。 |
| [New Bot Filtering and Content Delivery Network for Sports Reference Sites](https://www.sports-reference.com/blog/2022/10/new-bot-filtering-and-content-delivery-network-for-sports-reference-sites/)（2022-10-07） | 官方说明包括 Soccer/Football 在内的网站启用 bot filtering，并称若服务器封锁用户，封锁会在 24 小时后重置。 | 这是“封锁可能有期限”的直接官方证据；它不保证某个特定客户端、IP、路径或 403 会在 24 小时后恢复。 |
| [FBref & Stathead Data Update](https://www.sports-reference.com/blog/2026/01/fbref-stathead-data-update/)（2026-01-20） | Sports Reference 称高级足球数据供应方终止供数并要求删除，站方已删除该高级数据；FBref 将继续呈现 100 多项赛事的历史基础数据，若未来提供高级数据，规模会显著更小。文末“不再索取数据/访问已不存在的产品”指已删除的高级数据产品。 | 说明旧高阶指标供应已变更；这不是 Big Five 基础统计页下线公告，也没有将普通 Big Five 页面访问 403 定义为永久封禁。 |

截至本次核查，在所查官方站点和搜索可见的 Sports Reference 公告中，没有找到 2026-01-20 之后改变上述 FBref bot 说明、专门讨论 Big Five HTTP 403，或宣布 Big Five 基础统计停止的公告。此为限定范围的检索结果，不等于证明不存在其他公告或私下通知。

## 建议

1. 继续保留 403 对单次抓取和批次的确定性终止语义；不重试、不换 IP/身份、不使用隐藏端点。
2. 将 issue 36 的长期状态描述为“自动链路因访问拒绝且模型用途许可未确认而不可启用”，不要描述成“FBref 永久不可用”。本记录不修改 issue 状态。
3. 除非取得覆盖自动提取、缓存、模型 prompting/评分和展示用途的明确书面许可，否则停止将 FBref provider 用作 TactiScout 的自动候选源；可以把 FBref 留作用户自行打开的人工参考链接。2026-01 高阶数据公告也意味着不得以历史高级字段假设现在仍有同等覆盖。

## 证据边界

- 本次未请求 FBref 统计页、未重试 HTTP 403，因此不能证明网络状态是否改变。
- 官方 bot 文档描述的是频率和封锁期限，没有给出 HTTP 状态码语义；“24 小时重置”是官方对封锁行为的概述，不是恢复保证。
- 搜索/读取官方政策页时，网页检索能显示官方页面正文摘要，而直接打开这些政策 URL 返回 403；本记录引用的是官方页面 URL 与检索返回的官方页面内容，不把工具侧 403 当成 Sports Reference 对本项目的访问状态证据。
- 本记录整理公开条款与工程建议，不构成法律意见。
