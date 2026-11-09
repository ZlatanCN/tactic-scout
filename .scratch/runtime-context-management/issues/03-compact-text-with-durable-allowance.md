# 03: 一次自动文字压缩后完成任务并记住额度

Status: claimed
Label: ready-for-agent
Blocked by: 01
Parent: [运行时上下文管理](../spec.md)

**What to build:** 实际将进入模型的文字使业务请求装不下、但待压文字能放入一次辅助请求时，应用自动生成可核对的 Compacted scouting instruction / 文字摘要并继续真实任务。首次辅助调用就受到可恢复额度约束。

## Acceptance criteria

- [x] 打通一个真实业务入口的自动文字处理闭环；本轮原文能在旧内容缩减后装下时保留原样，不将原本未使用的历史重新全量注入。
- [x] 默认沿用任务模型 / 端点，独立压缩模型可显式配置并验证自身预算；待压源文字超出辅助请求预算时不递归盲发，明确保留进度供后续分块路径处理。
  - [x] 当前消息达到已配置 soft trigger 时也会尝试压缩；目标按当前模型 60% usable-input target 推导并传给压缩模型。若待压文本不足以达到目标，小请求继续正常路径。
  - [x] 若完整请求超限来自必要结构化上下文，而当前消息本身无法解释溢出，直接报告 context limit，不压缩或删除当前工作流条件。
- [ ] 原文、精确任务锚点和引用保留并校验所支持的确切条件，摘要不能确认身份或取代原始请求；JSON 合法不等于语义完整，条件不明确仍澄清，截断 / 失败不把不完整草稿写成成功请求。
  - [x] 确定性检查要求原文偏移精确匹配，并要求日期、赛季、数字、明确排除 / 否定、带标签 ID、支持的 FM 位置代码和本轮已绑定别名有来源引用及摘要锚点；歧义、无效引用和无缩减草稿不会进入请求理解。
  - [x] compaction 歧义通过既有 native clarification interrupt 收集答案，将澄清答案与原请求一起重新压缩，并让最新澄清优先参与确定性范围解析。
  - [ ] 未标注的人名 / 球队、隐含指代和任意自然语言语义遗漏仍不能由 schema 或字面扫描完整证明。
- [ ] 第一个新增调用前即 checkpoint 预留；共享 grant 默认 6 次 / 120 秒，失败 / 重试、活动时钟、取消、原有三次请求 / 三次搜索限制和稳定操作分类一起生效。
  - [x] 压缩辅助调用前写入持久化 reservation；压缩调用失败按已消耗记账；超限判定、来源 token 估算和辅助请求预算预检耗时计入 120 秒 grant，预检耗尽时不发调用；原有请求 / 搜索限制保持。
  - [ ] 所有后续 context-processing operation 共用 grant 及细分的取消 / 重试分类由后续实施扩展。
- [ ] 压缩元数据和公共来源 / 覆盖观测契约随线程保存；复用时匹配源消息 / 范围、内容 hash、依赖结果 digest、原请求及适用模型配置 / 格式版本。不匹配则从原文重建，不能仅凭缓存存在就复用。
  - [x] 本 ticket 的辅助 State 保存 source 范围 / hash、锚点 / 引用、上下文 digest、模型配置及格式版本；不匹配时重建。
  - [x] stale context digest 会从原文重建；更换输入、端点 / 模型配置或格式版本的各失效分支仍需单独回归。
- [ ] 正常重启可复用有效缓存；原请求恢复不清零，不因新图步骤重新获得原业务三次请求额度，未知完成状态保守结算；辅助缓存失效不拒绝整条线程。
  - [x] Dev Server 重启后保留已完成摘要、lookup 结果和额度；重放同一稳定消息 ID 不重复压缩。
  - [x] 编译图 checkpoint 测试从“已压缩、未理解”的历史 checkpoint 恢复；request-understanding 实际收到缓存摘要，且没有重复压缩调用。未结 reservation 按调用数和时间上界结算，不重复调用。
  - [ ] 尚未验证 Dev Server 在理解节点未完成时恢复运行中的原请求，以及缓存不兼容后的线上重建路径。
- [x] 验证真实图任务结果及至少一条真实 Dev Server 正常重启路径；小请求不走辅助流程，内部摘要不作为最终聊天回答，原有成功快照 / 身份 Store 保持。

## Blocked by

- [01: 所有模型入口先做完整请求预算检查](01-enforce-model-input-budgets.md)

## Spec coverage

规格用户故事：6, 12, 30, 31, 32, 33, 34, 37, 41, 43, 44, 45, 46, 47, 50, 53, 54, 55, 56, 57, 59, 60, 61, 62。

## Comments

- 2026-11-08：用户确认拆分粒度和依赖（“合适了”），按批准的提案发布；尚未认领或实施。
- 2026-11-09：已完成一次自动文字压缩的图入口闭环。验证覆盖：原始 HumanMessage 保持不变；小请求不增加摘要调用；第一次辅助调用前，编译图 checkpointer 已保存调用预留；待压文字本身超出辅助预算时不调用压缩模型并保留原文范围；压缩锚点及引用需匹配原文范围；调用后结果和默认 6 次 / 120 秒额度写入线程状态。受支持条件的确定性遗漏检查覆盖日期、赛季、数字、显式排除 / 否定、带标签 ID 和支持的 FM 位置代码。
- 2026-11-09：managed Dev Server 完成真实 Harry Kane 查询后正常重启，同一稳定消息 ID 重放可保留摘要、查询结果和已消费额度，且未发出第二次压缩调用。模型请求使用一条 Compacted scouting instruction；内部摘要不写入聊天消息。
- 2026-11-09：图级 checkpoint 测试从同一 message 的未结 reservation 恢复，结算一次调用和 reservation 时间上界为 unknown，不重复调用模型。活动时间测试使用固定时钟验证预检时间计入 grant、预检耗尽时没有辅助调用，以及小请求不消耗 compaction 时间。
- 2026-11-09 follow-up：活动时长现在包含 task 超限判定、原文 token 估算和 compaction 请求预算预检；时间消费在 reservation 一起保存。图测试使用固定时钟验证预检可耗尽 grant 时不会发送辅助请求。另从同一 checkpointer 的“已压缩、未理解”历史 checkpoint 重建 graph，确认缓存 instruction 进入 request-understanding。
- 2026-11-09：别名锚点使用既有 `findConfirmedPlayerAliasesInMessage` 与 `normalizeMentionText`；偏移仍通过原文精确切片校验。未标注的人名 / 队名、隐含指代和任意语义遗漏无法由字面扫描完整证明。规格 user story 60 要求 continuation fidelity evaluation，但仓库当前没有独立的 fidelity evaluation 工单；ticket 05 实际是 project lookup evidence，不能作为该评估的交接编号。此项仍未完成，票据保持 claimed。
- 2026-11-09 follow-up：所有活动时长差值通过 `elapsedMsSince` 计算并 clamp 到非负，避免本机 wall clock 回拨使已消费额度倒退。Dev Server 用例验证的是已完成任务后的正常重启；未结请求恢复由编译图历史 checkpoint 覆盖。
- 2026-11-09 review follow-up：节点实现遵守 ADR-0003 放入 `src/nodes/`；预算预检现在区分当前用户输入溢出与必要结构化上下文溢出。按 80% soft trigger / 60% target 验收，native context-processing clarification 可以续跑 compaction。保真评估仍留给规格阶段 06；未做真实模型语义评测。
