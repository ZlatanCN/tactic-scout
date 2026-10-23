# 本地专用重排实验的事实边界

Updated: 2026-10-22

用户已选择本轮离线题目/答案评审只复用当前聊天网关模型。下述是另一个尚待选择的检索候选实验，不自动纳入 Q8 授权，也不表示已下载、运行或确定效果。

## 现有运行环境

只读检查记录本机为 macOS ARM、Apple M4、10 个逻辑 CPU、24 GiB 物理内存，Node 26.12.0；项目已安装 `@huggingface/transformers` 4.3.0 与 `onnxruntime-node` 1.30.0，具有配对 tokenization 和 `AutoModelForSequenceClassification` 支持。该事实证明有适配基础，不证明实际推理速度或内存峰值。

`EvidenceReranker` 接口可适配只对给定候选排序的本地实现，但初始化需加入独立模型预加载/预热，排序模式、模型版本、精度、缓存 key 和评测分组均须记录。当前 `text-classification` pipeline 不适合直接假定为单 logit 的 query/passage reranker：应按模型卡使用 tokenizer 配对输入与原始分类 logit，不能把单元素 softmax 产生的相同值当相关性。

## 有公开模型资料的候选

- [Horizon-Labs/multilingual-reranker-small](https://huggingface.co/Horizon-Labs/multilingual-reranker-small)：发布者标注 141M 参数、40 多种语言、Apache-2.0、ONNX 权重与 Transformers.js 配对推理示例。训练长度写为每对 384 tokens，Python 示例另用 512，因此实际配置上限与拟使用 tokenizer 需要先核对。发布者也注明技术文本覆盖及教师模型错误继承方面的限制。
- [BAAI/bge-reranker-base](https://huggingface.co/BAAI/bge-reranker-base)及 [Xenova ONNX 转换](https://huggingface.co/Xenova/bge-reranker-base)：原模型标注中英支持、MIT、约 0.3B 参数，转换卡提供 JavaScript 的配对分类 API。文档示例采用总计 512 pair tokens，仍需锁定具体 artifact 和 tokenizer，不能从模型名称推断跨语言检索效果。
- 较小英文模型的接口参考：[Xenova/ms-marco-MiniLM-L-6-v2](https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2)与[上游模型卡](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2)说明直接 JavaScript query/passage 评分，上游 22.7M 参数；英文支持不满足本项目中文问题/英文原文的质量前提，只作接口事实参考。

## 实验需验证

- 重排 token 窗口容纳查询、嵌入用元数据、正文和特殊 token 的总和；符合 E5 输入上限的块仍可能在重排时截断。
- 区分只排序与拒绝低相关证据，logit 或 sigmoid 不自动等于已校准置信度。
- 测量预热后耗时、首次加载、峰值内存、问题族质量、同语/跨语言效果和预算耗尽；不预先承诺比聊天模型快或好。
- 本地原生推理可能在调用方返回后继续执行；需要丢弃迟到结果，不声称截止时间能立即停止底层计算。

## v2 实现候选

实现了一个可注入的 Transformers.js/ONNX 配对分类器，默认指向 [onnx-community/bge-reranker-v2-m3-ONNX](https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX/tree/6f5ff65298512715a1e669753bc754d2bc8f367b)，revision 固定为 6f5ff65298512715a1e669753bc754d2bc8f367b，本地使用 q8。[上游 BAAI 模型卡](https://huggingface.co/BAAI/bge-reranker-v2-m3)声明 Apache-2.0，并标注该模型为多语言 cross-encoder。仓库提供 Transformers.js ONNX 分发与分类 pipeline 示例；实现实际使用 tokenizer 的 query/text_pair 输入，直接按原始 logits 排序。

适配器在任何推理前统计完整配对输入，超过 512 tokens 直接拒绝；本地推理返回后若 AbortSignal 已触发则抛弃排序。生产默认策略没有改变，只有 eval:rag-v2 的 compare 模式显式载入候选。

目前没有下载这组新模型权重，也没有测得它在本项目题包上的准确率、启动时间或峰值内存。因此任何默认排序选择都必须等同题包对照结果完成后再作决定。
