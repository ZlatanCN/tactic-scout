# Show methodology RAG sources in the scouting report

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make methodology RAG source use inspectable in the final scouting report without presenting analysis papers as player-performance evidence.

## Acceptance criteria

- Add source references from methodology chunks actually retrieved during this case; do not infer or invent references from the full source registry.
- Deduplicate chunk hits into one citation per canonical article URL.
- Preserve only references whose source allows display, with title, author, publisher/date when available, source link, license, and the original attribution string.
- Keep methodology references separate from candidate statistics and player-report observations; they do not prove a candidate's ability or increase a score.
- Show the references in the existing report's data/knowledge area with keyboard-accessible links and compact visual hierarchy. Continue showing chunk count separately from unique source count.
- Keep old localStorage report snapshots readable by defaulting the new field to an empty list.
- Verify the API/UI build and exercise the whole recruitment dialogue through the report after the change.

## Context

- [Domain context](../../../CONTEXT.md)
- [Permission-gated RAG ADR](../../../docs/adr/0002-permission-gated-scouting-corpora.md)
- [Whole-chain evaluation](14-agent-harness-evaluation-suite.md)
- [RAG source expansion](102-open-football-methodology-rag-sources.md)

## Comments

- 2026-10-09：开始实现。最终报告当前只显示方法片段命中数；LangGraph state 已保留检索文档的论文标题、作者、URL、许可和署名，可从实际结果构造引用，不必再次查询来源登记。

## Answer

最终报告现在从本轮真实检索到的方法片段构造引用，并按去掉 fragment、排序 query 参数后的文章 URL 去重；只展示 `displayAllowed` 的方法语料来源。报告分别显示片段命中数和唯一来源数，并保留标题、作者、出版方、年份、链接、许可和原始署名。页面明确说明方法资料不是球员表现证据，不参与候选能力评分；来源卡片链接可键盘聚焦。旧报告 schema 与计划迁移会将该字段默认为空数组。

验证：使用本地知识库实查得到 2 个 Altmann 等（2021）方法片段，经来源收集器去重为 1 个引用，保留 PLOS ONE、原文链接、CC BY 4.0 与 `Data provided by PLOS API.` 署名；缺少新字段的旧报告解析结果为 `[]`。隔离组件预览确认长标题和来源元数据能在卡片内换行显示，键盘焦点样式由链接专属 `:focus-visible` 规则提供；未刷新带有当前报告状态的原浏览器标签。API 与 Web 生产构建通过。随后以本机 Qwen 3.5 9B 对拜仁凯恩替代者场景完成三轮对话、两次澄清、同案恢复、候选评估、Reviewer 与报告，Harness 28/28 检查通过（180.456 秒）。不把本轮流程验收解释为 RAG 相关性或候选排序质量验证。

- 2026-10-09：实现与完整链路验收完成；知识来源链接与空旧快照默认值已覆盖。
