# 方法 RAG 新增论文候选：许可与方法价值复核

研究日期：2026-10-13。范围：寻找尚未登记、能补充足球表现/战术评估方法的论文；只核对出版方论文页、出版方 TDM 文档和许可文本。**本轮没有抓取/下载论文，没有入库、改动来源注册表或代码，也没有获取球员/比赛数据。**

## 结论

找到两篇通过文章文本复用门槛的新增 PLOS ONE 论文：

1. **GO（方法文本）：Yáñez-Sepúlveda 等，2026，进攻/防守球员画像。**主题与能力画像及职责比较直接相关。可把方法讨论用于本地方法 RAG；不能把该论文的 PCA/SHAP 结果直接当成 TactiScout 的球员评分方法或已验证排序。
2. **CONDITIONAL（方法文本）：Bischofberger 等，2024，比赛事件检测与验证可靠性。**许可和单篇自动获取条件满足，但它解决的是“事件怎样定义、评估会不会高估准确率”，不是球员角色适配。仅当知识库覆盖数据口径、测量误差与来源可比性时才值得入库；不要用它给球员打分。
3. **NO-GO：PlayeRank（2019）。**与球员画像高度相关，但既有研究已记录其论文采用 CC BY-NC-SA 4.0。对面向求职展示、未来可能商业化的项目，非商业/相同方式共享约束无法作为明确、低歧义的许可基础；本轮不推荐入库。[既有许可和研究边界记录](open-football-methodology-rag-sources-2026-10-09.md#先人工核权) · [ACM/DOI 出版记录](https://doi.org/10.1145/3343172) · [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)

许可结论针对**论文作者文字**。CC BY 4.0 的官方许可摘要允许复制和改编，并要求适当署名、链接许可和说明改动；结合 PLOS 明确提供的逐篇 JATS XML 路径与文本挖掘说明，这支持在本机留存论文文字、切片并用于本地 embedding/RAG。出版方没有逐篇写出“向量数据库”或“AI”字样，因此这是基于 CC BY 复制/改编授权及 PLOS TDM 文档作出的用途判断，不应描述为 PLOS 对某个 AI 产品的单独背书。[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · [PLOS 官方 TDM 文档](https://api.plos.org/text-and-data-mining.html)

论文许可**不包含**论文依赖的数据许可。两篇论文使用/讨论的底层比赛、追踪、事件或聚合球员统计数据不因论文 CC BY 而开放；本轮不获取这些数据，也不建议把它们、论文中的表格/图、第三方素材或具名表现行带入 RAG。只考虑有清晰署名和许可元数据的论文方法文字；入库前应逐篇检查第三方署名标注并排除不在文章许可内的材料。

## 逐篇评估

### GO — 进攻/防守球员画像的多变量方法（2026）

**论文：** Rodrigo Yáñez-Sepúlveda 等，*Optimizing football analytics: Dimensionality reduction meets machine learning for offensive and defensive player profiling*，PLOS ONE 21(9), e0353239，2026-09-09。DOI [10.1371/journal.pone.0353239](https://doi.org/10.1371/journal.pone.0353239)。[出版方全文页](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0353239)

| 门槛 | 核验结论 |
|---|---|
| 文章级许可 | 论文页版权声明明确 Creative Commons Attribution License，授权链接指向 CC BY 4.0；署名义务按 CC BY 执行。只将此结论用于文章作者文字，不扩张至第三方素材或数据。[论文许可声明](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0353239) · [CC BY 4.0 条款摘要](https://creativecommons.org/licenses/by/4.0/) |
| 自动获取 | PLOS 官方 TDM 文档说明已知 DOI 可通过出版方 `article/file?...&type=manuscript` 单篇取得 JATS XML，并明确反对不谨慎的批量下载。对应的精确路径为 `https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0353239&type=manuscript`；本轮没有请求该 XML。[PLOS TDM 文档](https://api.plos.org/text-and-data-mining.html) |
| 本地持久化 | CC BY 4.0 允许在遵守署名条件时复制材料；PLOS 将该文本列为可挖掘/复用内容。因此仅持久化获许可的文章文字与必要出处元数据有依据。[许可](https://creativecommons.org/licenses/by/4.0/) · [PLOS TDM](https://api.plos.org/text-and-data-mining.html) |
| 本地 AI/RAG | 把已许可文字切片、生成本地向量并在本地模型调用中检索，是对文章内容的本地处理/改编用途；依据是文章 CC BY 4.0 的复制和改编权限以及 PLOS 的 TDM 许可说明。每个片段需随作者、题名、DOI、来源、CC BY 4.0、改写说明保留归属。这里是许可解释，不是出版社对 TactiScout 模型的认可。 |
| 对项目的相关性 | 论文按进攻与防守两个主成分构造球员画像，并讨论 PCA、SHAP、指标解释与角色分段，能补足现有语料偏“角色/表现关系”而缺少“多维指标如何合并和解释”的空白。[方法与研究结果](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0353239) |

**科学使用边界：**论文自己指出进攻主成分更像参与度/进攻活动量，不等于效率；监督模型预测的是 PCA 派生指数，作者将高 R² 解释为一致性/可解释性检查，而非独立预测效度。研究是单赛季事件数据，缺少跟踪与比赛情境变量。故建议只让 RAG 回答“这种画像方法怎么构造、有什么局限”，不将其主成分系数或 SHAP 排名复制成产品评分，也不把论文模型重述为经独立球探验证的招聘适配度。[论文结论、作者局限及对 R² 的解释](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0353239)

**数据权利边界：**论文的数据可用性声明链接到 2022/23 足球球员统计数据集，但该数据集的上游采集与许可是独立问题。出版物的 CC BY 不等于数据集、球员表现行或统计来源的 CC BY。本轮没有打开、保存或引用数据集，也不推荐将该集合并到 TactiScout。[论文数据可用性声明](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0353239)

### CONDITIONAL — 事件识别与性能分析的验证可靠性（2024）

**论文：** Jonas Bischofberger、Arnold Baca、Erich Schikuta，*Event detection in football: Improving the reliability of match analysis*，PLOS ONE 19(4), e0298107，2024-04-18。DOI [10.1371/journal.pone.0298107](https://doi.org/10.1371/journal.pone.0298107)。[出版方全文页](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0298107)

| 门槛 | 核验结论 |
|---|---|
| 文章级许可 | 论文页声明 Creative Commons Attribution License，链接到 CC BY 4.0；只据此复用文章文字并保留署名，不延伸至第三方素材/数据。[论文许可声明](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0298107) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| 自动获取 | 与上篇相同，PLOS 官方文档公开 DOI 到 JATS XML 的单篇下载方式，并劝阻批量 XML 下载。对应的精确路径为 `https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0298107&type=manuscript`；本轮没有请求。[PLOS TDM 文档](https://api.plos.org/text-and-data-mining.html) |
| 本地持久化 | 文章文本受 CC BY 4.0 复制/改编授权；在本地保存带来源元数据的文章方法文字有依据。[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| 本地 AI/RAG | 可把授权正文的定义、验证设计与边界整理为本地方法索引，并按 CC BY 保留署名、许可和改动说明；这是基于许可文本与 PLOS TDM 文档的授权判断，不表示原始比赛数据也可处理。[PLOS TDM](https://api.plos.org/text-and-data-mining.html) |
| 对项目的相关性 | 论文显示事件定义会因数据供应商而异；把事件数据与定位数据交叉依赖的样本用于验证会虚高准确度。它支持 Agent 对指标来源口径、测量质量、跨 provider 可比性作出谨慎说明，但不是个人球员能力或战术适配模型。[论文结论和验证设计](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0298107) |

**为何是 CONDITIONAL：**所有许可/获取条件有一手来源支持，但对 TactiScout 的直接作用是“证据质量与来源口径”，弱于球员能力画像。如果方法 RAG 的范围只覆盖球员职责、能力与评价方法，本篇会稀释检索主题；只有将“指标定义、测量误差、跨来源可比性”纳入知识库职责并在新增来源专属检索集上验证有用性后才加入。文章报告只有在事件数据和位置数据具有依赖关系时，传球检测 F 分数才高达 0.92；在独立数据情况下传球/射门检测分别为 0.71/0.65，提醒不能只看高准确率数字。[论文摘要与数据声明](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0298107)

**数据权利边界：**论文称底层研究数据只有一部分公开，剩余部分来自商业源且作者声明不能分享；论文正文 CC BY 不会改变这些比赛数据的权限。Metrica 的样例数据仓库也只被论文列为其中一部分数据来源，不应从引用关系推导出全部研究数据开放。本轮没有获取任何样本数据。[论文数据可用性声明](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0298107) · [Metrica 仓库说明](https://github.com/metrica-sports/sample-data)

## 去重与准入建议

- 当前 [来源注册表](../../../data/knowledge/sources.json)已有三篇研究来源：PLOS DOI `10.1371/journal.pone.0298346`、PLOS DOI `10.1371/journal.pone.0256695`，以及 Frontiers DOI `10.3389/fpsyg.2022.813206`。本文两个 GO/CONDITIONAL DOI 均未在注册表或已检索研究笔记中出现；其余既有候选（包括传球难度、控球价值、无球、压迫与 PlayeRank）不重复推荐。[既有候选审查](open-football-methodology-rag-sources-2026-10-09.md) · [注册表](../../../data/knowledge/sources.json)
- 若后续准入，先给每篇单独添加精确 DOI 白名单与许可元数据；只用官方逐篇 JATS XML，尊重 PLOS API 限额与“不批量下载”说明。正文抓取应排除图、表、补充文件、单独标记的第三方内容和任何球员统计数据，并保留近源署名、DOI、许可链接、修改说明及 PLOS 的必要展示归属。[PLOS TDM 方式](https://api.plos.org/text-and-data-mining.html) · [PLOS API FAQ/限速](https://api.plos.org/solr/faq) · [PLOS API Display Policy](https://api.plos.org/api-display-policy/)
- 加入向量库不等于已证明检索有效。新增论文应建立独立的 source-level 查询标签，覆盖可回答、模糊、超出范围和相近但不同概念；先跑本地嵌入检索并看逐条结果，避免新增 chunk 数量本身被表述成 RAG 质量提升。当前总体验收仍须遵守 [方法 RAG 的限制](../../../docs/knowledge-base.md)：作者标注小样本只算回归 smoke，不证明线上相关性或答案忠实度。

## 核验范围与边界

论文级许可和研究结论来自两篇 PLOS 出版方文章页；单篇 XML、对批量下载的提醒与挖掘/复用说明来自 PLOS 官方 API TDM 文档；改编/归属要求来自 Creative Commons 法律许可摘要。未使用二手综述作为许可依据。文章正文许可、第三方素材许可、上游表现数据许可始终分开记录。本报告不授权外部球员数据采集或复用。
