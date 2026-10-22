# 足球资料扩展的初步事实

Updated: 2026-10-22

本文记录只读调查，不表示新增来源已登记、入库或授权用于当前模型。目标是在现有招募 Agent 内扩大方法解释与历史研究综合的材料，用户不提供第一方观赛记录。

## 获取路径

PLOS 的[文本与数据挖掘政策](https://plos.org/text-and-data-mining/)明确允许挖掘、复用与分享，并给出 XML/API 方式；[使用条款](https://plos.org/terms-of-use/)仍要求逐篇核对适用许可和署名。把其广泛许可用于拟议 RAG/模型处理属于项目需登记的解释，各 DOI 仍需逐项来源登记及模型目的地许可。

现有官方 [JATS/XML 与 API 分发文档](https://api.plos.org/text-and-data-mining.html)提供结构化入库路径；[API 限额](https://api.plos.org/solr/faq/)包括每分钟十次请求和五个并发连接。本次浏览能确认候选文章的官方 XML 下载入口，但未能取得其 XML body，具体传输与解析适配仍待实现阶段核验。

## 已核对候选

| 文章 | 可支持的问题 | 主体与样本边界 |
| --- | --- | --- |
| [Who are the best passing players?](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0304139)（2024） | 传球难度、完成率为何需要情境、模型局限 | 2016 年巴西联赛四场；球员用匿名编号，可作方法资料，不能升级为具名球员报告 |
| [Playing tactics, contextual variables and offensive effectiveness](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0226978)（2020） | 进攻类型、渗透、机会与比赛情境 | 2017/18 英超二十场样本；论文文本和底层 Wyscout 视频是不同资产 |
| [Assigning goal-probability value to high intensity runs](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0308749)（2024） | 无球跑动价值、协调与因果限制 | 2022 MLS 资料、匿名球员案例；底层 StatsPerform/Second Spectrum 追踪资料不能据论文许可直接入库 |

三篇页面均声明文章适用 CC BY；它们扩充的是方法与历史解释，不建立当前具名候选球探覆盖。已有 Mead 文章另有 Suarez、Griezmann、Benzema 的同一概括段落，也不等于独立的个人比赛报告。

## 工程事实与候选改进

- 当前 PLOS evidence 导入器存在 Ronaldo/Messi/La Liga/PlayeRank 特定分支；知识文档接口和权威存储本身支持一般结构化章节。
- 可候选改为一般 JATS 章节遍历，再由有来源依据的文档清单关联身份和样本；出现名字不能自动证明该段属于球员分析。
- 更多文章需要相关性筛选，不能从标题或网页可读性推断适合入库。比如 [A Messi affair!](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0225033)讨论球探方法，底层数据保密。
- [Sage AI/TDM 政策](https://www.sagepub.com/tdm-ai-policy)对包括 RAG 的 AI 使用要求许可，不能将其当成 PLOS 的等价自动扩展来源。
- 新资料会改变现有验收所绑定的证据快照；新自动评测方案需明确内容更新后的验收流程。
