# 04: 启用原生节点恢复策略与同步持久化

**What to build:** 有外部 I/O 的图节点使用 LangGraph 原生超时、类型化重试、脱敏错误处理和恢复路由；用户回合使用同步持久化，使追问、暂停、失败或恢复前后的状态完整，不重复候选页、工具预算或最终报告副作用。

**Blocked by:** 03

**Status:** resolved

**Labels:** ready-for-agent

- [x] 节点超时、可重试错误、不可重试错误和恢复目标由一张可审查的策略表描述。
- [x] 图级重试只处理传输层尚未处理的类型化幂等读取失败，不重试评估、变更或已经递增的预算操作。
- [x] 错误处理器只写回安全失败摘要，不把堆栈、提示词、原始供应商载荷、凭据或隐藏推理写入案件状态。
- [x] 用户回合使用 `durability: "sync"`；对用户可见副作用发生前，所需 checkpoint 已可恢复。
- [x] 使用配置的持久化 checkpointer 完成一次中断、关闭并恢复，验证只有一个待回答问题和一份最终报告。
- [x] 可选 enrichment 失败显示覆盖不可用；核心身份、证据、预算、候选策略或 Reviewer 失败不得伪装成成功空结果。
- [x] 用户取消仍由 `AbortSignal` 传递，与服务排空语义分开。

## Answer

完成。节点策略集中于 `node-policies.ts`，只重试带类型的幂等读取；Planner 最终失败和 enrichment 覆盖写入安全摘要。所有用户回合采用同步 durability。`native-runtime-policies.test.ts` 覆盖超时/重试/最终失败与 SQLite 暂停恢复；`service-drain.test.ts` 验证关闭重开后续跑同一 thread 且不重复候选读取。
