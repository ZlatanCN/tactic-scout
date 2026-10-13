# Show real LangGraph work as useful recruitment progress

Type: task
Status: open
Labels: ready-for-human

## Goal

Make long-running recruitment turns understandable by exposing a concise, honest timeline of actual LangGraph activity in the conversation UI. Progress must come from executed graph stages and completed tool work; it must not invent percentage, ETA, candidate quality, or hidden model reasoning.

## Why now

The UI now merges each stage's start/completion into one compact step, while keeping repeated stages separate. Real-model runs have exercised normal completion, user-interrupt/resume and recovery after a transient progress disconnect. The remaining acceptance item is assistive-technology verification.

## Acceptance criteria

- [x] LangGraph-owned stage/tool execution produces ordered, typed progress events with an explicit lifecycle state.
- [x] Tool completion events summarize safe, observable outcomes such as records read or candidates evaluated, without exposing prompts, raw tool payloads, or private chain-of-thought.
- [x] The UI distinguishes active, completed, paused-for-user, and failed work without implying percentage or ETA.
- [x] After a temporary browser/network disconnect, polling the bounded latest snapshot restores the current turn state; when a turn ends, no stale active indicator remains. This does not promise replay of events older than the retained snapshot.
- [x] The interaction remains clear on narrow screens, respects reduced motion, and limits live announcements to new messages/current progress instead of the entire transcript and timer.
- [ ] Manually verify the live announcements and timeline navigation with a screen reader.
- [x] Each browser turn carries a stable request ID. Repeating the same ID and input shares the in-flight LangGraph run or returns its recent outcome; reusing the ID with different input is rejected. A deliberate new attempt receives a new ID.
- [x] After a transport error, the UI retains the request ID for an identical resend and asks the user to recover that result before changing the unresolved input.
- [x] While a turn is running or its outcome is being recovered, the submitted user message is visible beside the live LangGraph progress; a successful response replaces the temporary pending message without duplication.
- [x] Model connection errors use an actionable Chinese message and preserve the original input for retry.
- [x] The turn response carries its bounded safe progress-event snapshot, and the assistant message keeps a compact, collapsible view after the live card disappears; saving the recruitment plan preserves that view.
- [x] The local-model harness captures the same typed progress callback per user turn and includes the safe lifecycle sequence in its result for UI/harness comparison.
- [x] README, `CONTEXT.md`, and the issue map match the implemented progress semantics.
- [x] API and web production builds pass.

## Comments

- 2026-10-04：用户强调长时间等待时需要看见 Agent 实际做了什么。本 issue 以现有 LangGraph graph、Fastify progress endpoint 和 React timeline 为基础，先核对 LangGraph 官方 streaming API，再选择最小且耐断线的事件传递方式。
- 2026-10-04：前端展示层按阶段和 occurrence 合并同一步骤的 started/completed 事件，服务端有界事件快照继续保留完整生命周期记录；重复的 planning/tool 步骤仍独立展示。
- 2026-10-04：本地模型 Harness 采集 conversation.turn 的同一 onProgress 回调；JSON 结果保留按 turn 编号的阶段事件并汇总状态/阶段计数，stderr 也会在运行时显示进度。
- 2026-10-04：真实 Harness 失败场景发现 LangGraph 1.4.18 将未命名 custom 事件包装为 `params.data.payload`，旧 transformer 校验外层对象会静默丢事件。解包并改由 `turn()` 统一发出终态后，同一场景即使模型结构化输出失败，也收到有序的 `planning/started`、`failed` 两条进度事件。该运行证明事件链路，不代表模型场景通过。
- 2026-10-04：本机 Qwen Barcelona 场景正常完成，进度依次经过规划、方法资料、候选搜索、能力评估、球员报告、综合、复核和完成；显示读取 20 人、评估 10 人等可核对摘要。另一次 Bayern 场景先暂停等待回答，再在同一案件续查；此前模型结构化输出失败场景也收到明确失败终态。两次 Barcelona 实际运行分别约 103 秒和 79 秒，说明阶段透明度改善了等待反馈，但本地模型响应仍慢。
- 2026-10-04：进度组件使用窄屏样式、减少动画偏好和 polite live status 标记；尚未在读屏软件中人工核验。
- 2026-10-04：将案件消息单独设为只播报新增内容的 log；逐秒更新的等待时间不再处于整段对话的 live region 中。当前进度使用原子 status 播报，图发出暂停/完成/失败终态时指示点停止脉冲。代码层面收窄了播报范围，仍需人工读屏验证。
- 2026-10-04：发现丢失长请求 HTTP 响应会让浏览器拿不到已完成报告。新增短期、进程内的 turn request coordinator：请求 ID 与案件 ID 绑定，相同输入的重发共享正在运行的 Promise 或返回同一结果缓存；请求 ID 配不同输入则返回 409。进度快照也按请求 ID 匹配，避免短暂恢复时显示同案上轮轨迹。用户看到明确失败后，下次主动尝试会使用新的请求 ID。工作台仅在传输错误后保留 ID，并要求重发相同输入；此缓存不跨 API 进程重启，仍需用真实断网场景验证。
- 2026-10-04：调查结束或暂停后，Fastify 将本轮最多 24 条安全阶段事件附在 turn response；工作台把最近阶段步骤折叠保存在助手消息中，用户保存招募计划后也能回看。不保存 Planner 的自然语言提议或隐藏推理。
- 2026-10-04：在本地工作台运行拜仁替代者示例后，前端轮询始终停留在“正在连接实时阶段”，完成的角色追问也没有可展开的调查步骤。工作区当前实现应在模型调用前写入启动事件并在响应中附上有界快照，因此怀疑预览连接的 API 实例未运行当前进度协议；尚未验证此推断。修正前端连续 5 次进度轮询失败后仍无限显示“正在连接”的问题，改为明确报告阶段暂不可用；`pnpm build:web` 通过。仍需在同版本前后端运行时核对完整事件链，并完成读屏验证。
- 2026-10-04：继续用独立案件核验运行实例：本机 turn 请求成功完成为 `needs_input`，但响应没有 `progressEvents`；查询进行中快照返回 200，却缺少当前契约要求的事件 `status` 字段。相同 ID 的状态查询可命中该快照，证实进度 API 协议版本落后于当前工作区，而非 LangGraph 没有执行。前端现将契约解析失败归类为“不兼容”，并在进行中和完成消息里提示重启本地 API；尚待重启后复核 live timeline 与屏幕阅读器。
- 2026-10-04：重启已确认属于本仓库的 API 进程后，临时页面运行同类拜仁自然语言需求；浏览器实时显示启动、规划、方法检索和后续阶段，完成后的 `needs_input` 消息保留了 7 条真实事件（折叠视图显示最近 6 步），包括候选池为空和暂停等待补充。原工作台页面仍保持打开且没有被这轮独立调查改写。`pnpm build:web` 复核中；真实断线恢复和读屏仍未验证。
- 2026-10-05：发现等待期间只显示 Agent 进度卡，用户提交的需求直到整轮返回后才加入对话，长调查时不容易确认 Agent 正在处理哪条消息。工作台现在在请求执行及待恢复期间显示临时用户消息和目标球队；成功响应会由正式对话消息替换，不重复写入。尚未完成人工浏览器与读屏复核。
- 2026-10-05：在本地工作台用 Qwen 3.5 9B 完成真实三轮浏览器流程：首轮调查后先问是否延续凯恩角色；确认中锋后按 ST 搜索，0 人时暂停询问是否扩大；用户允许其他前锋位置后，LangGraph 按 ATT 扩展候选、读取 80 条中的 30 人并完成报告。实时进度显示了规划、方法检索、候选页、评估和报告检索的实际结果；提交的每条用户答复立即出现在进度卡旁边，最终报告称名单顺序为考察优先级而非能力排名，并披露 Wyscout 2017/18 历史范围。首次点击时 Ollama 未运行，前端恢复原输入并显示连接错误；启动本机服务后重新提交成功。该浏览器运行不替代独立 Harness 评估；临时断线恢复和人工读屏验证仍未完成。
- 2026-10-05：把当时界面原样显示的英文 `Connection error.` 改成中文、可操作的模型服务连接提示；其他服务器错误仍保留具体错误信息。为复测，临时停止本轮由我启动的 Ollama 服务并从页面提交需求；工作台显示“无法连接当前配置的模型服务……”，输入仍在编辑框。随后已重启服务。
- 2026-10-05：尝试通过当前标签页的短时网络模拟验证进度恢复，但在模拟期间界面仍收到阶段更新、没有进入 stale/connection-lost 状态；请求也照常完成。因此这次操作不足以证明真实传输中断恢复，验收项保持未完成。
- 2026-10-05：随后通过当前标签页 CDP 只阻断 `/recruitment/cases/*/progress*` 轮询请求约 7.5 秒。本轮 LangGraph 继续执行，工作台显示“阶段更新暂时不可用”；解除阻断后，下一次轮询取回同一 request ID 的最新阶段（已包含候选搜索、评估和报告检索），状态提示恢复。本轮最终完成后，进度卡消失、对话保留终态阶段摘要，没有残留活动指示。该验证覆盖阶段轮询短断线恢复，不承诺超出保留快照的事件回放。
- 2026-10-05：按 LangGraph interrupt 的恢复语义修复 `wait_for_user` 的重复进度副作用：图在真正暂停后由 turn adapter 发出 `asking_user/waiting_for_user`，恢复时不再把节点开头伪装成新的提问开始。目标用例通过；详见 [issue 60](60-avoid-stale-question-progress-on-resume.md)。人工读屏验收仍未完成。
- 2026-10-06：新增真实编译 graph 的确定性回归检查：在 Planner 等待时先等到 `planning/started` 经进度回调送达，再取消，确认取消终态跟随其后。官方 API 不承诺 abort 时 flush 尚未到达消费者的事件；TactiScout 只依赖已进入应用快照的事件，见[LangGraph v3 abort 进度缓冲复核](../research/langgraph-v3-abort-progress-buffering-2026-10-06.md)。

## Answer

LangGraph v3 event streaming projects schema-validated custom events from graph execution into the Fastify bounded progress snapshot. The UI merges lifecycle events into a compact timeline and shows safe, observable counts; the final bounded event snapshot is attached to the assistant turn and can be reopened after completion or saved with a plan. Each browser turn also carries an idempotency request ID: a transport retry with the same input reuses the in-flight graph run or receives its recent outcome, while a changed payload cannot accidentally reuse that ID. After a definitive error the UI permits a fresh attempt with a new ID. Live announcements target new messages and current progress; the per-second timer is outside an all-transcript live region, and terminal progress stops the active pulse. Production builds pass. The issue remains claimed because a real transient-disconnect recovery and manual screen-reader verification are still outstanding; the idempotency cache is process-local.
