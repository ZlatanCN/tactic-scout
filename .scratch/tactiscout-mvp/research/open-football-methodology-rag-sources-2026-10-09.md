# 可用于 TactiScout 方法 RAG 的开放足球研究

研究日期：2026-10-09。范围：仅核对期刊/出版方/DOI 原始页面上的论文正文、许可声明和数据可用性；不获取球员数据、不调用 API、不抓取或入库全文。本文评估的是**研究方法文本**，不授权复用论文依赖的专有比赛数据，也不纳入具名球员报告。

## 结论

**有多篇可补入方法语料的 CC BY 论文，建议先从角色语境、传球难度、机会/推进价值和集体压迫四个缺口补齐。** CC BY 4.0 允许复制和改编论文文本，条件是署名、链接许可并说明改动；期刊页面另有第三方图表/素材可能不在许可内。可将获准的正文做本地切片、embedding 和摘要；不要把论文中使用的 DFL、Amisco、StatsBomb 等数据或图表误当成开放数据。CC BY 的内容许可不等同于出版方网站授予自动爬取权，因此接入采集器前仍需分别核对页面条款；本次仅确认官方页面提供可读全文及文章许可。[CC BY 4.0 条款](https://creativecommons.org/licenses/by/4.0/) · [Springer 对第三方素材的许可说明示例](https://link.springer.com/article/10.1007/s10618-021-00810-3)

## 建议纳入：正文方法可作本地 RAG

### 1. 角色比较要同时记录位置、阵型与个体差异

[Forcher 等，2022：Does Technical Match Performance in Professional Soccer Depend on the Positional Role or the Individuality of the Player?](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.813206/full)（DOI [10.3389/fpsyg.2022.813206](https://doi.org/10.3389/fpsyg.2022.813206)）。Frontiers 全文页声明 CC BY，许可链接为 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。研究以 2018/19 德甲官方比赛数据比较五个位置，并把阵型与位置合成 positional role；球员切换角色时，短传、长传、盘带、持球的变化既受角色影响，也呈现显著个体差异。切入价值：TactiScout 的职责模板应基于**位置 × 阵型/职责**解释数据，并保留球员个人风格，不能只用“中场”标签横向比较。限制：切换位置分析样本仅 13 人、单一联赛赛季；DFL 数据是许可数据，不能从论文推出可复用原始数据权限。[数据可用性声明](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.813206/full)

### 2. 位置基线应与个人能力分开

[Altmann 等，2021：Match-related physical performance in professional soccer: Position or player specific?](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0256695)（DOI [10.1371/journal.pone.0256695](https://doi.org/10.1371/journal.pone.0256695)）。PLOS 全文为 CC BY，遵守署名要求即可复用论文文本。研究比较总距离、高强度跑、冲刺和加速等位置规范值与 25 名跨位置球员的表现；位置变化可解释约 44–58% 的相关变化，剩余差异仍与球员个体等因素有关。切入价值：提醒系统把位置基线当作上下文参照，而非把基线直接等同于球员能力。DFL/Deltatre 比赛数据明确“按许可使用，非免费提供”，只纳入论文方法，不获取其数据。[PLOS 许可与数据可用性声明](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0256695)

### 3. 用 xPass 补足传球难度，而不把传球成功率当作质量

[Anzer 与 Bauer，2022：Expected passes: Determining the difficulty of a pass in football (soccer) using spatio-temporal data](https://link.springer.com/article/10.1007/s10618-021-00810-3)（DOI [10.1007/s10618-021-00810-3](https://doi.org/10.1007/s10618-021-00810-3)）。Springer 全文明确 CC BY 4.0，并提醒逐项检查第三方素材标注。方法用传球周边空间与时序信息估计接球对象和传球完成概率，可区分简单安全传球与高难度传球；作者列出球员球探作为应用场景。切入价值：报告中把“传球完成率”与“传球选择难度/风险”分开，评估向前传球时不惩罚合理但难度高的尝试。研究使用 2017/18–2019/20 共 918 场德甲、840,386 次传球的跟踪和事件数据；这些不是开放原始数据，复现该模型还需要球员跟踪数据。[全文许可及数据规模](https://link.springer.com/article/10.1007/s10618-021-00810-3)

### 4. 用 EPV 组织机会创造与推进的动作价值

[Fernández、Bornn 与 Cervone，2021：A framework for the fine-grained evaluation of the instantaneous expected value of soccer possessions](https://link.springer.com/article/10.1007/s10994-021-05989-6)（DOI [10.1007/s10994-021-05989-6](https://doi.org/10.1007/s10994-021-05989-6)）。Springer 全文为 CC BY 4.0，含第三方素材例外。框架将每个时点的控球期望价值拆成传球、带球/推进、射门的选择概率和预期结果，并显式考虑全场 22 名球员与球的位置、速度、空间控制及压迫线。切入价值：将“推进”和“创造机会”放到同一控球序列中解释，比单纯累计向前传球/带球数更能回答动作是否提升后续射门机会。重要边界：作者的数据是 STATS/Stats Perform 提供的 633 场英超、10Hz 跟踪数据，标注为专有；源码未随论文提供。TactiScout 当前事件数据不足以声称实现了该 EPV，只可把它作为方法知识与数据缺口提示。[全文、许可和数据说明](https://link.springer.com/article/10.1007/s10994-021-05989-6)

### 5. 补上无球移动与队友贡献

[Dick、Tavakol 与 Brefeld，2021：Rating Player Actions in Soccer](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2021.682986/full)（DOI [10.3389/fspor.2021.682986](https://doi.org/10.3389/fspor.2021.682986)）。Frontiers 全文声明 CC BY，链接到 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。论文以球员和球的轨迹图模型估计控球期望结果，再把动作与控球期成功联系起来；正文专门讨论无球跑动、拉开空间、限制对手选项及接球者移动。切入价值：为“创造空间、接应、掩护传球线路”等不可由进球助攻统计完整表示的团队贡献提供概念框架。限制：仅用 2017/18 德甲 54 场、25Hz 跟踪数据；正文明确 DFL 不允许将数据分享给第三方。[数据可用性与许可](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2021.682986/full)

## 谨慎纳入：只作方法提示，不转成球员分数

- **集体压迫。** [Li 等，2026：Development and initial validation of a defensive pressure index using tracking data in the Chinese Super League](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2026.1833549/full)（DOI [10.3389/fspor.2026.1833549](https://doi.org/10.3389/fspor.2026.1833549)）全文声明 Frontiers CC BY（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)）。DPI 从最近防守者距离、球周围防守人数、夺回区域、进攻推进等六项空间/战术变量构造**防守回合级**压迫指标；不是个人压迫次数或球员能力。样本是 2018 CSL 30 场、2,032 回合，模型解释力有限（McFadden pseudo-R²=0.074）且比例优势假设偏离；论文也把它定位为初步证据。可让 RAG 提醒“压迫需看团队结构与对手处境”，不应据此给单个球员打分。底层数据受提供方保密协议限制。[样本、变量、验证与数据限制](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2026.1833549/full)
- **持球风格 × 位置 × 对抗语境。** [Liu 等，2021：Impact of Possession and Player Position on Physical and Technical-Tactical Performance Indicators in the Chinese Football Super League](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.722200/full)（DOI [10.3389/fpsyg.2021.722200](https://doi.org/10.3389/fpsyg.2021.722200)）全文声明 Frontiers CC BY（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)）。研究用 2018 CSL 的 240 场、6,163 个球员-比赛观察，比较五位置与高/低控球球队，并控制球队实力、对手质量和主客场。它适合提醒分析先控制球队打法和比赛情境；但表中 `Challenges won (%)` 定义为**球队赢得的对抗占整场对抗的比例**，不能当成个人对抗胜率。数据由 Amisco 跟踪系统采集，勿复用原始比赛数据。[方法与指标定义](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.722200/full)
- **防守动作价值。** [Zaręba 等，2025：Decoding defensive performance: a machine learning approach to football player valuation](https://link.springer.com/article/10.1186/s40537-025-01302-7)（DOI [10.1186/s40537-025-01302-7](https://doi.org/10.1186/s40537-025-01302-7)）全文明确 CC BY 4.0，排除另行标注的第三方素材。论文将解围、拦截、抢断及传球等变量和 xT/VAEP/OBV 用于防守评价；适合提示“防守要看动作对危险的影响，而非只看事件量”。它使用 StatsBomb 2021/22–2022/23 波兰甲数据，论文写明没有随研究生成或分析的数据集；OBV 的算法为 StatsBomb 专有。只可 RAG 论文中的方法讨论，不能把文章变成自有 OBV 定义、玩家数据源或已验证跨联赛排名公式。[全文许可、数据源和 OBV 限制](https://link.springer.com/article/10.1186/s40537-025-01302-7)

## 先人工核权

[Pappalardo 等，2019：PlayeRank: Data-driven Performance Evaluation and Player Ranking in Soccer via a Machine Learning Approach](https://doi.org/10.1145/3343172) 是最贴近多维度、角色感知排名的补充读物：结合大量事件构造角色化评分，讨论球员搜索与多位置适应。但 ACM/DOI 出版信息标示 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)：存在非商业与相同方式共享条件。**本机非商业原型是否能把全文持久化、生成并对外展示派生摘要/检索片段，需要按产品发布方式人工核实；核实前不要注册入库。**论文依赖的 Wyscout 事件数据另有权利边界，不因文章许可而开放。[ACM/DOI 出版信息与许可](https://doi.org/10.1145/3343172)

## 去重与明确排除

- 现有 RAG 种子已登记 Davidson 等 2024 PLOS 论文 `10.1371/journal.pone.0298346`（见 [`src/knowledge/seed.ts`](../../../src/knowledge/seed.ts)）；本文不重复收录。上文 Altmann 2021 是不同 DOI，补充的是位置化体能基线，属于新增方法，而不是重复论文。
- Reeves 等 2019 的 “A Messi affair!” (`10.1371/journal.pone.0225033`) 已被第一方观察规程引用，但不应作为球员报告语料：文章正文虽为 PLOS CC BY，原始球探口述数据因可能识别俱乐部而不公开，只能由合格研究者向伦理委员会申请。若未来需要研究“球探如何形成观察语言”，可单独登记论文方法正文并署名；绝不提取或合成其未公开口述报告。[PLOS 全文许可及数据声明](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0225033) · [当前观察规程](first-party-match-observation-rating-evidence-2026-10-07.md)

## 对接现有 RAG 的建议

1. **已准入 Altmann 等（2021）**：PLOS 原文逐篇声明 CC BY；PLOS 官方 TDM 文档允许挖掘、复用和分享文章，并提供按 DOI 获取小范围全文的路径。以一个精确 DOI 白名单来源登记，通过现有 PLOS API 适配器抓取，符合 10 次/分钟限额，并保存作者、标题、DOI、许可证和 PLOS 来源标记。没有下载批量语料，也没有取用 DFL/Deltatre 数据、图像或球员级报告。
2. 后续可先核实并接入 Forcher、Anzer & Bauer、Fernández 等三篇；它们分别补角色比较、传球难度与控球动作价值，但仍需确认出版方对自动获取的约定，并为每篇使用精确来源/许可记录。已有可访问全文及 CC BY 声明只解决文章复用权，不应跳过出版方获取方式审查。
3. 第二批可加 Dick（无球动作）与 Li（团队压迫），并在摘要 metadata 标明“需跟踪数据/小样本初步结果”；Liu 与 Zaręba 仅作为“指标解释和语境限制”检索，不参与个人排名公式。
4. CC BY 条目在每个方法文档保存作者、标题、期刊/年份、DOI、许可链接和许可版本；项目自写中文摘要标记“根据论文改写”，注明改动。剔除未单独许可的图像、表格和原始比赛数据；公开 portfolio 只展示短摘要、项目自身计算结果和来源链接。

## 获取、存储、模型处理与展示的权利边界

| 用途 | 本轮结论 |
|---|---|
| 自动获取 | PLOS 官方 TDM 文档明确支持小范围按 DOI 查询全文/文章 XML，并明确反对无谨慎控制的批量下载；官方 Search API 为每分钟 10 次、每次不超过 100 行。本次只有一篇单 DOI 请求。Frontiers/Springer 的正式自动获取约定尚未核实；CC BY 不能替代站点访问方式审查。 |
| 本地存储与 AI/RAG | PLOS Terms of Use 说明文章内容按 CC BY 开放；PLOS TDM 页面说明文章可挖掘、复用和分享。故 Altmann 正文进入本机向量索引、embedding 与本地检索/摘要具有文章许可及官方 API 访问依据。其他 CC BY 文章仍须分开核验其获取方式，并逐篇登记。保留署名，排除独立标注的第三方素材。 |
| 派生摘要与 portfolio 展示 | CC BY 允许经署名改编且无非商业限制；PLOS API 展示政策要求在近处注明“Data Provided by PLOS”。检索片段和改写需保留署名/DOI/许可，公开界面避免复刻全文。PlayeRank 为 CC BY-NC-SA 4.0，产品输出是否构成其衍生材料及如何满足相同方式共享尚未核实，先不入库。 |
| 论文里的比赛/球员数据 | 不因全文 CC BY 而开放：逐篇记录的 DFL、Deltatre、Amisco、StatsBomb 或保密协议数据仍受各自限制；本笔记不存取这些数据，也不据其复现可比的球员评分。 |

### 本轮核验来源范围

每项研究结论链接到期刊/出版方全文页或 DOI 记录；Altmann 的许可又由 PLOS 官方 TDM 文档、PLOS API 条款/FAQ 交叉核对。仅按 DOI 获取 Altmann 一篇正文并将其写入本机索引，新增 44 个方法片段；总语料变为 158 个片段（方法 158、球员报告 0），注册来源 3 个。对“位置化体能表现与个体差异”的一次检索返回的前六条均来自这篇论文，说明语料广度仍小；chunk 数量不能代表方法来源多样性。未获取或入库任何球员数据。

来源访问依据：[PLOS 官方 TDM 获取说明](https://api.plos.org/text-and-data-mining.html)、[PLOS Terms of Use](https://plos.org/terms-of-use/)、[PLOS API Search FAQ 与速率限制](https://api.plos.org/solr/faq)、[PLOS API 展示署名规则](https://api.plos.org/api-display-policy/)。
