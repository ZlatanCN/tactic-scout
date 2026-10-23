# 新版 RAG 已批准票据拆分

Status: approved-and-published
Updated: 2026-10-22

依据：[已确认规格](spec.md)。现有父 issue [01：新版 RAG：自动化资料调查与评测](issues/01-automated-retrieval-investigation-and-evaluation.md)保持原样；七张子 issue 已按依赖顺序创建为 02–08。

每张票都描述可单独验证的纵向切片。依赖图如下：

```mermaid
flowchart LR
  T02[02 通用资料导入] --> T03[03 多来源引用]
  T02 --> T04[04 自动检索基准]
  T03 --> T05[05 Agent 补查]
  T04 --> T06[06 本地重排对照]
  T04 --> T07[07 自动评审门]
  T05 --> T07
  T06 --> T07
  T07 --> T08[08 招募入口验收]
```

02 完成后，03 和 04 可并行；03 完成后可启动 05；04 完成后可启动 06；04–06 完成后启动 07，最后完成 08。详细交付与验收条件以单票文件为准。
