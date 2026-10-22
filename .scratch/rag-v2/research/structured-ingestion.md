# 结构化入库与 E5 输入边界

Updated: 2026-10-22

## 模型输入事实

原始 [multilingual E5 base model card](https://huggingface.co/intfloat/multilingual-e5-base)说明输入最多 512 tokens，并要求查询使用 `query: `、文档使用 `passage: `，非英文同样适用。[项目所用 ONNX 转换模型](https://huggingface.co/onnx-community/multilingual-e5-base-ONNX)来自该模型。

[Transformers.js tokenizer 文档](https://huggingface.co/docs/transformers.js/en/api/tokenizers)暴露 special token、截断和长度处理。候选入库不变量是：对完整的 `passage: `、嵌入用元数据前缀、正文和模型特殊 token 一起计数；计数时不依赖静默截断，确保最终输入不超 512 tokens。

当前新知识证据路径 `src/knowledge/evidence-index.ts` 以 1,050 个 JavaScript 字符切块，再加入元数据前缀；另一条旧 `src/knowledge/index.ts` 路径用 900 字符。字符数均不能直接证明不同语言的模型输入符合 token 窗口，新方案应统一实际使用路径并按模型 tokenizer 校验。

## 输入结构事实

- JATS 的 [`sec`](https://jats.nlm.nih.gov/publishing/tag-library/1.4/element/sec.html)递归嵌套；[`p`](https://jats.nlm.nih.gov/publishing/tag-library/1.4/element/p.html)包含混合正文与行内标签；[`xref`](https://jats.nlm.nih.gov/publishing/tag-library/1.4/element/xref.html)通过 ID 关联文档对象。应先保留顺序、标题层级、原始定位和交叉引用，再形成规范化章节。
- [`table-wrap`](https://jats.nlm.nih.gov/publishing/tag-library/1.4/element/table-wrap.html)可能只有图片而没有结构化表格单元。XML 格式不保证能读取表格数值，无法提取时应明确保留缺口。
- [remark 维护文档](https://github.com/remarkjs/remark/blob/main/readme.md)提供 CommonMark 到语法树的处理；[GFM 扩展](https://github.com/remarkjs/remark-gfm)处理表格和脚注等。具体包尚未选定，但 Markdown 入库需明确标题、列表、代码、表格、frontmatter 和嵌入 HTML 的行为。
- 纯文本只能保留实际段落与原始定位，不能凭空补章节语义。

用户已选择本轮以结构化来源和 Markdown/纯文本为范围，不以 PDF/OCR 作为交付前提。
