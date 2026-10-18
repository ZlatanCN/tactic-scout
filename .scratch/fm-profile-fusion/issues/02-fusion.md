# 融合召回、身份关联与 LangGraph

Status: resolved
Labels: ready-for-agent
Depends on: 01 (resolved)

## 工作

把 FM 查询接入现有 PlayerRepository/身份解析与证据评估，不把画像转换成比赛率值。增加按职责召回与参考球员比较，使用可靠桥接关联现有来源，未确认时各自保留。新增能力证据契约并接入 Planner、Reviewer、报告与前端。后续实现三臂消融 CLI 和冻结场景验证。

## 完成

融合仓库、职责计算、Planner/Reviewer、报告与参考比较均接入。真实凯恩与诺伊尔替代者对话完成，参考本人已排除；位置资格按画像与实战证据分别处理。取消、分页、未知值、别名与身份隔离回归通过。

三个冻结场景共九次运行完成，19 张真实匿名卡及答案键已生成；空名单臂不会在后续评测中丢失。前后端构建和 575 项测试通过。人工推荐质量尚未证明，未生成虚假评分。详见上级 `completion-audit.md`、`experiment-results.md` 和 `ui-review.md`。
