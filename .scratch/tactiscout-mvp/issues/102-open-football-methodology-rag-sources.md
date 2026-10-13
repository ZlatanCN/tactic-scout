# Find open football methods material for the RAG corpus

Type: research
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Question

Which high-quality football performance-analysis or scouting-method sources can expand TactiScout's `methodology` RAG corpus under explicit, compatible reuse rights?

## Acceptance criteria

- Check at least three owner-published journals, repositories, or papers and inspect full-text licenses rather than relying on abstracts or search snippets.
- Compare source relevance to position/role assessment and the ability evidence currently missing from the product, including progression, chance creation, pressing, duels, and off-ball contribution.
- Separately assess automated access, local full-text storage, local LLM/embedding/RAG processing, derived summaries, portfolio display, attribution, and any non-commercial restriction.
- Deduplicate against the existing registered PLOS article and existing TactiScout-authored methodology summary.
- Save one cited research note under `.scratch/tactiscout-mvp/research/` and recommend specific additions or conclude none currently qualify.
- Do not ingest full text or create player-report data until the source is registered and rights are explicit.

## Context

- [Permission-aware RAG design](10-permission-aware-rag-design.md)
- [Existing source registry](../../../data/knowledge/sources.json)
- [Current report-corpus landscape](../research/player-report-corpus-landscape-2026-10.md)

## Comments

- 2026-10-09：开始一手出版方与全文许可复核；研究结果先存档，再决定是否修改 RAG source registry。
- 2026-10-09：核对本机 LanceDB `status()`：114 个获准片段全部属于 `methodology`，`player_report` 为 0；sources registry 有 2 条记录，其中球员报告来源仅是按用户逐条授权的第一方观察。现有 PLOS provider 可按来源白名单读取多个已登记 DOI，因此新论文若获准，可沿用当前来源注册与 ingestion seam。

## Answer

从 PLOS、Frontiers、Springer Nature 三家出版方逐篇核对了全文许可、方法相关性、底层数据限制和自动访问路径。CC BY 文章适合进入本机方法 RAG，但正文许可不开放论文引用的 DFL、Deltatre、Amisco、StatsBomb 等比赛数据。

按 PLOS 官方 TDM/API 规则，单篇 Altmann 等（2021）论文满足正文复用与按 DOI 获取条件，已用精确来源白名单写入 `data/knowledge/sources.json`，再通过官方 PLOS API 导入本机 LanceDB；新增 44 个方法片段。保留作者、DOI、CC BY 和 PLOS 来源标记；未获取第三方图片/素材或比赛数据，也没有创建球员报告语料。LanceDB 当前为 158 个方法片段、0 个球员报告片段、3 个注册来源。检索实读能命中新论文，但相同主题前六条都来自它，片段数不代表来源多样性。

后续可考虑 Forcher（位置 × 阵型角色）、Anzer/Bauer（传球难度）、Fernández 等（控球价值）、Dick 等（无球贡献）和 Li 等（团队压迫）；其中 Frontiers/Springer 的自动获取约定尚未逐家核实，完成后再注册入库。PlayeRank 的 CC BY-NC-SA 与发布方式兼容性仍未确认，暂缓。

详见[研究笔记](../research/open-football-methodology-rag-sources-2026-10-09.md)。
