# Make conversation and scouting evidence readable at presentation size

Type: task
Status: open
Labels: ready-for-human
Blocked by: none

## Goal

Raise the reading scale of Chinese conversation, live progress and scouting report content so the workbench can be comfortably read in a résumé or interview demo while preserving the existing decision-first information hierarchy.

## Acceptance criteria

- [x] Conversation, question and live progress body copy use a legible primary text size and line height.
- [x] Candidate rationale and core report text are visually distinguished from labels and provenance details.
- [x] Evidence tables, coverage summaries and historical provenance remain readable without hiding source boundaries.
- [x] Narrow-screen report layout keeps tables scrollable and controls usable.
- [x] Manually review the rendered workbench at desktop and narrow-screen widths.
- [x] Verify the populated candidate-comparison table at narrow width, including internal horizontal scrolling without page-level overflow.
- [x] Verify keyboard focus order and visible focus in the running app.
- [x] Saved-plan open/delete buttons include the plan name in their accessible names.
- [ ] Confirm screen-reader announcements with an actual screen reader.
- [x] Web production build passes.

## Comments

- 2026-10-07：当前页面结构和推荐优先级已在 issue 83 确认；检查实际工作台代码发现对话正文为 10px，报告证据/来源说明最低为 6–8px。将这轮范围限定为阅读层级，不改变报告内容、数据口径或 LangGraph 状态。
- 2026-10-07：提高对话与进度正文到 12–14px，报告正文到 13–14px，证据表格到 12px；来源和历史样本的辅助文字提高到 10–11px。浏览器无障碍树可用，但当前截图接口不提供像素渲染图，因此人工桌面/窄屏视觉和读屏验收保持未完成。
- 2026-10-07：在本地工作台约 644px 宽度下人工查看了真实 FPL 对话生成的报告；需求说明、无推荐状态、数据范围、检索条件和覆盖卡片可读，没有观察到横向溢出。该轮没有候选比较表格，不能据此验收表格滚动；桌面宽度与实际读屏公告仍未核验。
- 2026-10-07：复核完整无障碍树和组件后发现报告整块被设为 `aria-live="polite"`，可能在报告更新或计划切换时重复朗读大段证据。已移除整块 live region，并将其标为“球探报告”可导航区域；对话日志和简短运行状态仍负责播报调查及完成消息。键盘焦点顺序、实际读屏公告与桌面/窄屏渲染仍需人工核验。
- 2026-10-07：在当前运行中的工作台复核 1440×900 与 390×844 视口。桌面保持对话/报告双栏，窄屏纵向堆叠；窄屏 `documentElement.scrollWidth` 与视口同为 390，无横向溢出。键盘可依次到达观察入口、新建案件、计划名称、示例需求、消息编辑区、球队选择和数据限制 disclosure，焦点有可见的绿色轮廓。无障碍树将消息列为 polite log，报告是独立命名区域且没有整份报告 live announcement。因当前机器未实际启用/操作 VoiceOver，本次不宣称真实屏幕阅读器公告已验证；有候选数据的完整报告表格也未在两个尺寸都复核。
- 2026-10-07：真实 Qwen 三轮拜仁替代者案件完成两次追问后生成报告；桌面工作台中选中 Haaland 与 Flemming 查看比较。浏览器截图确认比较表的指标、赛季、来源分钟和小样本说明均可读；把比较说明、表头/单元格、候选选择标签和来源细节提高到 11–12px，比较表仍通过独立横向滚动容器承载。窄屏下带候选比较表的实际视图仍待复核；屏幕阅读器公告仍未实际操作验证。
- 2026-10-08：在当前 Wyscout 历史样本报告中选中 Nathaniel Chalobah、Rémi Walter 与 Christopher Martins Pereira，设为 390×844 视口核对三人比较表。内部容器宽 326px、表宽 433px、`overflow-x: auto`；横向滚动后第三名候选可见，`scrollLeft` 到 107px；页面 `html/body scrollWidth` 均为 390px，没有页面级横向溢出。该报告仍明确标注 Wyscout 2017/18 历史样本，不代表当前球员池。实际 VoiceOver 公告仍未验证。
- 2026-10-09：在 390×844 的真实 FPL 候选报告中发现推荐卡片被内部证据表的最小内容宽度撑到约 503px，外层报告将多余部分裁切。为 `.recommendation-card` 加 `min-width: 0` 后，卡片宽 326px、报告面板宽 356px，页面宽度仍为 390px；长表格继续由 300px 的内部容器横向滚动（表宽 475px），实际滚动后来源列可见。桌面与手机截图、浏览器尺寸和无障碍树均复核；实际 VoiceOver 公告仍未验证。
- 2026-10-10：在当前 1280×720 工作台用 Tab 实走导航、示例输入、需求编辑、球队选择和报告重试焦点；本轮首屏 API 未连接，因此未做实时进度/停止操作，也未声称读屏通过。代码中的对话 `log` 按顺序追加消息，阶段与停止信息由短 `status` 节点播报；其语义符合 [WAI-ARIA 1.2 的 log/status 角色定义](https://www.w3.org/TR/wai-aria-1.2/)。规范和无障碍树都不能证明实际 VoiceOver 公告，剩余人工作业已整理在下方。
- 2026-10-10：继续检查多计划列表的可访问名称；多个计划原先会暴露相同的“打开/删除”按钮名，现分别附带计划名，避免用户离开所在卡片后无法辨认目标。该 DOM 语义改动通过 Web 生产构建；实际 VoiceOver 公告仍待下方人工验收。

## Human action

在本机启用 VoiceOver 并用实际运行中的工作台完成一次端到端检查；无障碍树或键盘检查不能代替此项。记录 macOS、浏览器与 VoiceOver 实际读出的内容，并检查：

1. “球探对话”和“球探报告”区域、报告标题、候选比较复选框/表格按合理顺序朗读，表格标题和单元格关联清楚。
2. 调查期间只播报当前阶段等简短状态，不逐秒朗读计时，也不反复重读整段对话。
3. 键盘可到达并触发“停止调查”；VoiceOver 能区分“正在结束本轮”和 LangGraph 真正停止后的终态。
4. 更新或停止调查时不整份重复播报报告；已有完整报告仍可继续阅读。

这一次 VoiceOver 实测也用于关闭 [issue 51](51-langgraph-live-progress-events.md) 的进度公告验收和 [issue 68](68-stop-long-running-investigations.md) 的取消公告验收；将结果记回这三项 issue。

## Answer

正文和报告字号已调整，桌面与 390px 窄屏的候选比较表均已人工核对；窄屏长表格由内部容器横向滚动，页面没有横向溢出。修复了推荐卡片被表格撑宽后裁切的问题，并给保存计划操作补上带计划名的可访问名称。窄屏初始工作台和键盘路径已有核验，网页生产构建通过；实际屏幕阅读器公告仍待 VoiceOver 实测。
