# RAG 复用聊天网关并保留本地 embedding

首版复用现有 LangGraph 聊天模型网关承担生成和有界批量重排，embedding 保留本地 multilingual E5，以复用现有部署并单独评估新增模型调用的相关性收益、延迟和 token 用量。重排使用独立的结构化任务与调用预算，具体预算及失败行为继续在设计中确定；现有来源处理边界仍适用，聊天接口可用不证明该网关提供 embedding 或专用 rerank 接口。
