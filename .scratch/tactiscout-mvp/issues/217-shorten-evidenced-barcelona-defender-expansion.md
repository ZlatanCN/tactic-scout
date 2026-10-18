# Shorten an already evidenced Barcelona defender investigation

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Objective

修复“为巴萨寻找一个新的后卫，要能参与出球和高位防守”中的两项可复现问题：

1. 泛称后卫请求曾可接受主要角色不是后卫、但带有兼职后卫能力值的球员。
2. 候选和证据已经足够形成有限 shortlist 时，LangGraph 仍调用一次扩页 Planner；本机模型等待后超时，当前证据才由确定性回退收束，造成无收益的长尾等待。

## Public seams

- `playerPositionMatches()`：同一球员记录的位置资格。
- `createRecruitmentConversation()`：完整 LangGraph 的候选、评估、扩页决策和报告链路。
- `pnpm eval:local-agent --message ... --expected-position DEF --compare-expansion-sufficiency --runs 3`：同一整图、同一冻结数据和本机模型下的三对交错消融。
- `evaluateLocalAgentScenario()`：公开 Harness 行为验收面。

## Acceptance criteria

- [x] 泛称 `DEF` 只按主要能力角色判断是否属于后卫组；显式 `CB` 请求仍可使用来源支持的兼职中卫证据。
- [x] 同一 replay 身份下的多条来源记录不会被算作多个独立候选。
- [x] 只有在每个用户提出的能力区域都可测、至少两项可测区域、并且至少三名独立候选共同覆盖全部可测能力时，普通 `expand` 阶段才确定性收束。
- [x] `expand_recovery` 继续保留模型恢复；不可测能力、单一能力区域或覆盖不足时仍交给扩页 Planner。
- [x] 三对真实整图消融说明确定性收束移除无收益扩页 Planner 调用和约 60 秒等待；候选与证据合同以及推荐身份顺序、证据顺序保持一致，但收束说明文案会不同。
- [x] 更新 Harness 归一化、实验 CLI 汇总字段及定向回归。

## Design notes

- 后卫位置族仍然用于召回；候选资格和推荐仍由候选自己的证据判断。
- “高位防守”没有直接数据确认球队采用的防线高度。`overall defending` 和 `ball playing defender` 是当前能力画像中的职责代理，不能被描述为已验证的高位战术适配。
- 本优化只改变证据已经足够时是否调用普通扩页 Planner。它不改变候选发现、评估、Reviewer、推荐证据合同，以及两臂的推荐身份与证据顺序；确定性收束的说明文案与“扩围失败后回退”的文案不同。
- 实验必须交错运行两臂，控制模型、仓库、知识库、工具预算、图和政策；静态 fixture 可证明控制流，只有真实整图配对运行支持延迟和实际动作结论。

## Answer

位置资格现在分离“宽泛召回”和“推荐资格”：泛称后卫请求按主要能力角色判断，Rodri 类 `CB=15, DM=20` 的记录不再因为兼职中卫值进入后卫候选；显式中卫请求不会被这一规则误杀。

LangGraph 新增普通扩页阶段的确定性充分性策略。它只在一项案件同时满足以下条件时绕过模型：所有能力区域均有可测指标、至少两项区域、至少三名独立候选共同覆盖全部可测指标。回退或恢复阶段不套用该捷径。

修复后的最终实验使用本机 `tactiscout-qwen3.5:9b`，共 3 对交错运行，`allPassed=true`、`ablationAllPassed=true`。确定性收束臂没有扩页 Planner 请求，p50 / p95 为 56.513 / 61.378 秒；保留 Planner 臂每轮均发起一次扩页请求，3/3 在等待后回退，p50 / p95 为 114.473 / 122.162 秒。两臂均输出 3 人推荐、5 条证据引用，缓存覆盖均为 18 人、整体防守 16 人、后场出球 16 人；三对的推荐身份顺序和证据顺序均相同。

该结果支持“消除已经足够时的不必要模型等待”，不能证明推荐排序或引援判断质量提升；样本只有这个冻结需求、一次数据快照和三对运行。

## Comments

- 2026-10-18：开始验收时定向构建和 125 项位置、结论策略、完整图及 Harness 回归全部通过。
- 2026-10-18：最终真实结果保存在 Git 忽略的 `.data/evaluations/expansion-sufficiency-barcelona-defender-rerun.json`。
