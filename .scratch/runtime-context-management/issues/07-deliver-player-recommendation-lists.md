# 07: 球员推荐两份名单完整交付

Status: resolved
Label: ready-for-agent
Blocked by: 03
Parent: [运行时上下文管理](../spec.md)

**What to build:** 能力相似和高潜推荐在两份名单都很大时仍完整交付，保持原排名、来源日期和筛选含义；解释可以分批，已计算的候选不能静默缩成一部分。

## Acceptance criteria

- [x] 覆盖 current / potential 各 20 人的结果，分别保持全部顺序及每行姓名、FM ID、年龄、位置评分、CA、PA、currentDistance。
- [x] 参考画像、目标位置、年龄计算日期、FM 日期、筛选条件及阶段计数保留；单份列表 limit 不被说成两份合计上限或总体候选数。
- [x] 证据批次由程序按完整模型输入预算自适应安排；不重新排名、补算缺失属性或混合 PA 与能力相似度，新增模型调用使用共享 grant。
- [x] 逐批校验 digest、精确候选引用、顺序及行字段覆盖；额度耗尽时按完整已验证结果确定性渲染两份名单并标明解释未完成。
- [x] Saved recommendation 不调用 ranker / provider，原快照日期保持；potentialCandidates 的未请求 null 与请求后空列表明确区分。
- [x] 完整图与 evidence collector 覆盖模型实际候选 / 字段及确定性回退证据，没有把完整存储快照冒充为模型已见内容。

## Blocked by

- [03: 一次自动文字压缩后完成任务并记住额度](03-compact-text-with-durable-allowance.md)

## Spec coverage

规格用户故事：4, 12, 13, 14, 17, 18, 19, 22, 23, 24, 25, 30, 51, 56, 58, 59。

## Comments

- 2026-11-08：用户确认拆分粒度和依赖（“合适了”），按批准的提案发布；尚未认领或实施。
- 2026-11-11：已完成。新增球员推荐专属投影，按列表分别切分并保留完整候选行、rank、参考画像、过滤阶段计数、日期和结果 digest；批次规划逐个测算模型输入并选择最大可容纳分组。批次完整性校验将回答中的候选、FM ID、rank、年龄、位置评分、CA、PA 和 currentDistance 与原始结果逐项匹配。保存结果通过完整图验证不重跑 ranker；额度耗尽回退到确定性完整名单和完整 provenance。Evaluation collector 分别记录模型收到的 list projection 与程序回退渲染依据。模型自然语言中事实关系的语义正确性继续由现有 evaluation judge 检查，未运行 live judge。
- 2026-11-11 最终验证：球员推荐投影 2/2、完整图成功 / 额度耗尽用例通过；全量测试 118 个 suite / 495 个用例、`pnpm typecheck` 和 `ultracite check src tests evals` 通过。双轴 Spec / Standards 审查没有未解决发现。
