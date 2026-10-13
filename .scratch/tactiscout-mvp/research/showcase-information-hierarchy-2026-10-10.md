# TactiScout Showcase 信息层级：官方设计指南核查

日期：2026-10-10  
范围：只核查 GOV.UK Design System 与 W3C WAI-ARIA Authoring Practices Guide（APG）。这里的项目决策是把指南应用到 TactiScout 展示页的设计推断，不代表这些指南验证过本项目或求职者用户。

## 结论摘要

建议采用**故事优先**：先展示项目解决的问题、一次真实运行如何推进，以及可核验的结论；把六组实验的核心发现和限制保留在页面上，将逐项方法细节放进清楚命名的原生 `<details>` 披露区。不要把关键结果或证据边界藏起来，也不要用 tabs 把一段需要顺着理解的调查过程切成互斥面板。此建议是基于下列官方组件指南与当前页面内容作出的项目推断。

## 可直接用于决策的证据

1. **渐进披露只应收起少数用户才需要的补充内容。** GOV.UK 建议用 Details 让页面更易扫读、显示“只有一部分用户需要”的信息；同时明确说不要用它隐藏多数用户需要的信息。Details 视觉上也比 accordion 和 tabs 更弱，更适合不那么重要的内容。[GOV.UK Details](https://design-system.service.gov.uk/components/details/)

2. **Accordion 能让读者先看相关分区概览，再展开需要的部分，但隐藏内容会被漏看。** GOV.UK 仅建议在有证据表明用户需要概览、选择展开相关分区或比较原本分散的信息时使用；它提醒并非所有用户都会注意到或理解 accordion，并建议先测试不使用 accordion 的内容组织方式。[GOV.UK Accordion](https://design-system.service.gov.uk/components/accordion/)

3. **Accordion 与 tabs 适用的内容形态不同。** 当用户要同时查看多个分区、或内容分区很多时，GOV.UK 倾向 accordion；当用户只需一次看一个分区并要快速切换时，tabs 更合适；仅一两段简短且次要的内容更适合 Details。[GOV.UK Accordion](https://design-system.service.gov.uk/components/accordion/)；[GOV.UK Tabs](https://design-system.service.gov.uk/components/tabs/)

4. **Tabs 会隐藏面板，不适合顺序阅读或横向比较。** GOV.UK 说 tabs 适用于分区标签清楚、第一分区对多数人最相关、用户不必同时看全部内容的情形；不应用作页面导航，也不适用于用户需要按顺序读完或比较不同面板的情形，因为来回切换和记忆会增加负担。它建议先考虑单页标题分区或目录链接，并要求每个 tab 面板开头有与 tab 标签相同的标题，以便小屏幕和屏幕阅读器用户导航。[GOV.UK Tabs](https://design-system.service.gov.uk/components/tabs/)

5. **若实现自定义 accordion，状态和键盘行为必须可感知。** W3C APG 模式要求每个可操作标题由 button 承载并位于适当层级的 heading 内；button 以 `aria-expanded` 报告展开状态、用 `aria-controls` 指向面板；Enter/Space 切换，Tab 顺序包含其中可聚焦内容。面板的 `region` 是可选的；同时可展开的面板超过约六个时，应避免制造过多 region 地标。[W3C APG Accordion Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/)

6. **Tabs 会带来一套专用键盘和 ARIA 契约。** W3C APG 为 tablist/tab/tabpanel 定义各自角色、选中状态和关联关系；水平 tablist 还需支持左右方向键循环切换。自动激活只适用于焦点切换时面板能无明显延迟显示的情况，否则导航会变慢。[W3C APG Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)

7. **本页已有足够的事实材料支撑一条精简故事。** 当前实现已经记录一次真实运行的五个关键转折、运行摘要和报告快照，并有六组机制实验；其页面顺序目前先出现六组实验，再出现调查旅程。[RecordedRunShowcase.tsx](../../../web/src/RecordedRunShowcase.tsx) 这说明故事优先可以重排现有证据，不必再造一套演示数据。

## 三种层级的项目判断

| 方案 | 首屏要回答的问题 | 适合 TactiScout 的部分 | 主要代价 | 判断 |
|---|---|---|---|---|
| **故事优先**：任务与结论 → 调查旅程 → 结果及边界 → 实验摘要 → 展开方法 | “这个 Agent 怎样处理真实引援任务，结果可信到什么程度？” | 与求职展示的快速理解目标一致；五步运行轨迹可以展示澄清、工具调用、恢复和 Reviewer 检查。实验结论及样本限制继续可见，细节渐进披露。 | 需克制首屏长度；把详细方法折叠时，摘要必须自足、命名明确。 | **推荐。** 关键故事与限制始终可见，单项实验方法可用原生 `<details>` 按需展开。依据是 GOV.UK 对 Details 的“只隐藏少数人需要的信息”边界，以及对顺序阅读内容避免 tabs 的建议；具体排序是项目推断。[Details](https://design-system.service.gov.uk/components/details/)；[Tabs](https://design-system.service.gov.uk/components/tabs/) |
| **时间线优先**：先按五步运行展开事件，再给结果与实验 | “运行中发生了什么？” | 最直接表现工作流状态迁移、追问和继续执行；可作为故事优先页面的主体中段。 | 用户要先读完过程才看到任务价值、报告结论和证据限制；对赶时间的读者不够结论先行。 | 不做整页主排序；保留时间线作为主故事，不将每个步骤默认折叠。这里对招聘者的阅读成本是设计推断。 |
| **研究档案优先**：实验比较 → 方法、样本与局限 → 单次运行 | “机制经受过哪些实验检验？” | 适合技术评审者深入查看消融证据；与项目“关键机制应通过消融验证”的原则吻合。 | 六组实验先于实际运行故事，会让读者先处理方法细节；要跨实验比较时，若藏在多个 tabs 中会要求来回切换和记忆。 | 作为页面后段的可深入研究区，而非首屏层级。保留每项核心结果及样本/结论边界可见，长方法细节再披露；官方指南支持避免隐藏多数用户需要的信息及 tabs 中的横向比较负担。[Accordion](https://design-system.service.gov.uk/components/accordion/)；[Tabs](https://design-system.service.gov.uk/components/tabs/) |

## 设计约束与验证建议

- 任务、运行证据、主要发现、样本规模、以及“行为检查不等于球探排序质量”这类阅读结论所必需的信息应直接显示；只把复现参数、逐项方法说明等少数读者才需要的内容放入披露区。这是将 GOV.UK Details/Accordion 的隐藏内容限制应用到本页。[Details](https://design-system.service.gov.uk/components/details/)；[Accordion](https://design-system.service.gov.uk/components/accordion/)
- 若试验区使用六个自定义 accordion 面板，采用适当层级的 heading，且让 button 成为 heading 的唯一子元素；同步 `aria-expanded` 和 `aria-controls`，支持 Enter/Space。不要无差别给每个面板加 `role="region"`，因为 APG 提醒大量可同时展开面板会造成地标泛滥。若使用原生 `<details>/<summary>`，保留其原生交互语义，不再把它伪装成 tabs。[W3C APG Accordion Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/)；[GOV.UK Details](https://design-system.service.gov.uk/components/details/)
- 不建议把五步故事拆成 tabs；这段内容天然有顺序，且读者可能要比较不同阶段。若另有真正互斥、无需同时比较的同类视图，才重新评估 tabs，并实现 APG 的键盘与状态要求。[GOV.UK Tabs](https://design-system.service.gov.uk/components/tabs/)；[W3C APG Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- 这是文档审查得出的设计假设，不是可用性研究结论。按原 issue 的验收范围，应让不了解项目的人快速复述“Agent 做了什么、证据证明了什么、还有什么没证明”，再单独检查窄屏布局与交互；GOV.UK 也建议以用户研究判断隐藏内容带来的收益是否值得。[GOV.UK Accordion](https://design-system.service.gov.uk/components/accordion/)

## 来源范围

- GOV.UK Design System：[Accordion](https://design-system.service.gov.uk/components/accordion/)、[Details](https://design-system.service.gov.uk/components/details/)、[Tabs](https://design-system.service.gov.uk/components/tabs/)
- W3C WAI-ARIA APG：[Accordion Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/)、[Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
