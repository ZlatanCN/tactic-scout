# 199 — 招募工作台 UI/UX 改版

Type: task
Status: resolved
Labels: ready-for-agent

## Objective

应用 frontend-design 与 better-ui，并结合既有竞品研究，优化主要招募工作台的布局、导航、报告阅读、控件与响应式。

## Design

白色成果区、冷灰背景、深绿主操作。Avenir Next/苹方承载球队工作台的紧凑信息；没有新增字体请求。计划放侧边，首次进入突出自然语言输入，活跃案件桌面对话/成果并排，中小屏用视图切换。研究工具进入原生可键盘操作的次级菜单。

## Changes

- 首屏移除大横幅和空报告；输入、示例与数据范围清楚分层。
- 打开已有报告优先成果视图；追问显示对话，完成后切换报告；新建重置视图。
- 保存操作在任务标题旁，报告视图可直接使用；完整调查记录按需展开。
- 候选之前直接提示关键能力缺口；详细覆盖移到可展开区域，完整来源仍可查。
- 统一工作台字号、表面、按钮、候选与比较表；说明与数值保持真实，没有补造评分。
- 悬停限定 hover-capable pointer；按钮 .96/150ms ease-out 仅在 no-preference 下启用，频繁视图切换没有缩放；滚动区域 contain；菜单外13px圆角对应内4px+8px内距+1px边框。
- 键盘跳过导航入口；工具菜单 Escape 可关闭；手机保留新建/保存可达入口。

## UI polish review

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | web/src/styles.css（共享 hover 规则） | 触屏可能保留 hover | hover 规则置于媒体条件，focus/selected 规则独立保留 | Hover effects only on hover-capable pointers |
| MEDIUM | web/src/workbench.css（控件与动效） | 按钮反馈和运动口径不一致 | .96/150ms，disabled 不缩放，reduced-motion 回退，频繁视图切换仅背景反馈 | Press scales to 0.96 / Gate motion / High-frequency interactions |
| MEDIUM | web/src/App.tsx（工作台视图） | 小屏串行堆叠，关键报告/追问可能离开主视图 | 明确切换并按结果状态定位，保存始终可达 | Broken interaction outranks polish |
| LOW | web/src/workbench.css（工具弹层） | 弹层细节继承通用样式 | 按嵌套内距计算圆角、透明边框与分层阴影 | Concentric radius / Shadows for elevation |

## Verification

- 浏览器实际观察默认首屏、保存案件恢复、对话/报告切换、空候选报告、详细证据折叠、工具菜单与新建恢复。
- 1440px 并排布局、390px 窄屏报告观察；窄屏 page width = viewport width = 390，无整页横向溢出。临时 viewport 已恢复。
- Web 构建和 git diff --check 通过；存在原有约500kB chunk 提示。本轮没有添加或运行自动测试。
- Not verified：当前真实快照只有零候选，非空2–3人候选比较的浏览器验收未完成；真实模型等待/追问的新流程、实体手机、VoiceOver、浏览器动画面板10%回放未运行。相关状态由现有组件代码复核，不能据此声称完整交互验收。
- Approve：仅上述实际检查的布局、空态与控件范围，未发现剩余 HIGH；未检查范围不作批准。

截图：`/tmp/tactiscout-workbench-redesign.jpg`。生产业务链路、数据来源、计划存储接口保留；本轮重点是主要工作台，盲评、评估、Showcase 页面没有全面重设计。
