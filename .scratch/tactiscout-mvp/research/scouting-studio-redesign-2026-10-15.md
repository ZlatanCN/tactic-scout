# 球探工作室视觉改版

## 范围与方向

主工作台：新建需求、计划导航、对话、候选报告、比较和报告档案。其余页面通过共享主题继承配色，未宣称逐页重构或验收。

- 纸白背景 #f1f3f7，白色内容面 #ffffff，墨蓝正文 #19283f，蓝色动作 #2855c5，次要文字 #5c6a7e，结构线 #dce2ec。
- 使用系统可用的 Inter / Avenir Next / 苹方字体，标题 28–36px，正文 14–16px，指标数字 28px、等宽数字。
- 宽屏保持左侧计划导航；主区域在对话和报告间切换，报告获得完整阅读宽度。
- 球员姓名、球队和重点指标优先；样本不足明确标记。完整来源、指标口径、原始取舍保留在详情中。
- 保留有证据候选与背景记录的区分；没有依据的记录不能参与比较。默认最多展示四项重点指标，其余在完整指标中读取。
- 选一人显示下一步，选二至三人显示比较；未选择时不显示空比较卡。

## 参考与取舍

实际查看 Linear Insights、Stripe Financial Connections 和 Rauno Craft 页面。吸收主次、留白及内容主体优先的原则，不复制营销页的大幅插图或动效。

应用 frontend-design、better-layout、better-writing、better-typography、better-colors、better-accessibility、better-ui、emil-design-eng 的相关规则。没有引入新的动效依赖；原有 reduced-motion 保留。没有为使用 skill 而加入图形、动画或额外组件。

## 验证

- Web 构建通过；仍有既存主包超过 500kB 的提示。
- Web 的恢复/重复提交回归 3 项通过；候选证据展示消融 3 项通过。
- 浏览器实际读取已有三人报告，验证选一人提示、两人比较、展开详情。
- 320px 首页和报告 document.scrollWidth 均为 320，无页面横向溢出；表格可在自身区域横向滚动。
- 未做物理手机、VoiceOver 或全站逐页验收。
