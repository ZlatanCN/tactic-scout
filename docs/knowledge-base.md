# 方法知识库与 RAG 运维

招募对话只检索服务端许可登记内的本地语料。本文说明来源发现、逐篇抓取、入库、撤回、embedding 及当前方法检索基准。项目入口见 [README](../README.md)。

## RAG 来源发现与入库

日常招募对话只搜索服务端本地索引，不会临时抓网页。来源发现和资料入库是单独的维护流程：PLOS 官方 Search API 可按 DOI 返回文章正文；Forcher 等（2022）只允许通过已核验的单篇 PMC OAI-PMH 路径获取。发现结果不会自动加入索引，导入前须在 `data/knowledge/sources.json` 登记来源、许可范围和允许语料。当前登记三篇 CC BY 4.0 足球表现分析方法论文，以及仅供用户自录观察使用的第一方来源；没有获准的外部具名球员报告语料。PLOS API 每分钟限 10 次、单次最多 100 条；当前命令把返回上限设为 20 条，适配器进程内请求至少间隔 6 秒，并保留 PLOS 署名要求。

```bash
pnpm knowledge:discover -- "soccer performance analysis"
pnpm knowledge:crawl -- 10.1371/journal.pone.0298346
pnpm knowledge:crawl -- 10.1371/journal.pone.0256695
pnpm knowledge:crawl -- 10.3389/fpsyg.2022.813206
pnpm knowledge:ingest -- path/to/approved-document.json
```

`knowledge:crawl` 只接受 `sources.json` 中明确登记的来源。PLOS DOI 使用 PLOS Search API；Forcher 等（2022）的精确 DOI 先请求 PMC OAI-PMH `pmc_fm` 元数据，核验 DOI、PMCID 和 CC BY 4.0 后，才请求该记录的 `pmc` 格式正文。PMC 请求间隔至少 400 毫秒；该适配器只允许这一篇已登记文章，不提供 Frontiers 批量抓取或自动发现。它会排除图、表、补充材料、参考文献等结构块，并追加清楚标注的项目作者中文摘要；原研究底层比赛数据不入库。入库工具会拒绝未登记来源、URL 超出来源范围、许可不匹配或不允许持久化/AI 处理的材料。发现来源与获准入库分开处理；不要把“公开可读”当作许可。服务端索引默认写入 `.data/knowledge/`，该目录不会提交到 Git，因此新克隆后需按需运行获准 DOI 的 `knowledge:crawl` 命令。PLOS 的许可与程序化访问依据 [PLOS 使用条款](https://plos.org/terms-of-use/)、[PLOS 文本与数据挖掘说明](https://api.plos.org/text-and-data-mining.html)、[PLOS API 限额说明](https://api.plos.org/solr/faq/) 和[署名规则](https://api.plos.org/api-display-policy/)；PMC OAI-PMH 的格式和请求限制见[官方文档](https://pmc.ncbi.nlm.nih.gov/tools/oai/)。搜索结果不会自动触发正文抓取。

每次检索都会重读来源登记。来源被移除或其语料、持久化、AI 处理权限被关闭后，同一运行中的知识库也会在下一次检索前过滤该来源。需要把一个来源从当前索引中移除时，可运行：

```bash
pnpm knowledge:purge-source -- plos-soccer-analysis-2024
```

此命令不要求来源仍登记，并会报告从当前 LanceDB 表版本删除的片段数；重复执行或来源/索引不存在时结果为 0。LanceDB 保留旧数据集版本以支持时间点恢复，因此这会使片段从当前索引和检索中消失，但不等于安全擦除磁盘上的所有历史字节。需要物理清理时，必须先停止所有使用该索引的进程，再按 LanceDB 的版本清理策略处理；`deleteUnverified` 在有其他进程使用数据集时可能导致损坏，不能在在线服务期间盲目启用。

embedding 默认在本机运行，不需要 API 凭据。若明确选择远程兼容服务，在 `.env` 设置 `TACTISCOUT_EMBEDDING_PROVIDER=openai_compatible`，并填写 `TACTISCOUT_EMBEDDING_API_KEY`、可选的 `TACTISCOUT_EMBEDDING_BASE_URL` 和 `TACTISCOUT_REMOTE_EMBEDDING_MODEL`。远程模式会把索引文本和查询文本发送到配置的服务。一个 LanceDB 索引只允许使用同一个 embedding 模型；更换 provider、模型或端点后，先删除 `.data/knowledge/`，再重新导入资料。

### 方法 RAG 检索基准

在已有本地方法语料索引后，可运行固定数据集的检索回归基准：

```bash
pnpm eval:methodology-rag
pnpm eval:methodology-rag:v3
```

`eval:methodology-rag` 继续运行不可变的 v2 数据集（34 条查询、两篇来源）；`eval:methodology-rag:v3` 使用新增的三来源 v3 数据集（10 条查询，校准与留出各 5 条），两版都覆盖可回答、模糊和超出语料范围类别，且隔离校准与留出问题家族。固定 embedding 为 `transformers.js:q8:onnx-community/multilingual-e5-base-ONNX`。命令不调用 LLM、不访问远程 embedding 或抓取文章；首次检索会按应用现有规则把两条项目作者摘要幂等写入本机忽略目录 `.data/knowledge/`。若本机方法索引缺少某篇已登记正文，需先按上文对应的 DOI 命令入库。

方法来源只有同时满足固定模型下的来源片段 cosine ≥ 0.812、且同一片段覆盖至少 50% 的非停用词查询项时才会进入 Agent；未知 embedding 模型下方法检索直接弃答。0.812 沿用 v1 的固定模型校准分界；校准集的相关来源词项覆盖率最低为 0.571，非相关来源最高为 0.2，故选 0.5 作为两者之间的确定性门槛。范围外相似度最高为 0.8111。JSON 输出分别报告校准与留出集的可回答证据覆盖、来源对 precision/recall、模糊查询处理、范围外误接收率和逐条信号。

v2 的原作者标注结果仍保存在 `data/evaluations/methodology-rag-v2.json`。v3 当前实测：6 条可回答问题在校准/留出集均取得相关来源（6/6）；留出来源对 precision 为 0.75，因一个问题还接受了另一篇角色/表现相关来源；两条范围外引援决策的误接收率为 0/2；两条模糊问题中一条弃答，另一条只返回相关角色资料。生产门槛维持 cosine ≥ 0.812 且同一片段词项覆盖 ≥ 0.5，未知 embedding 仍弃答。标注由项目作者完成，只覆盖固定中文查询，不代表线上用户分布、答案忠实度、通用 RAG 质量或球员推荐准确性；新增来源、调整 embedding、切块或分词时，应创建新版本并重新校准，不能把当前阈值当作通用值。
