# 08: 招募入口完成新版 RAG 集成验收

Type: task
Status: open
Labels: ready-for-human
Blocked by: 07: 同网关模型自动评审与冻结验收门。

## What to build

分析者通过普通招募 JSON/SSE 入口完成多来源资料综合与一次补查；完整运行可在本机复现，只有满足全部资格条件时才取得相应基线资格。

## Acceptance criteria

- [ ] 普通应用装配能按需触发资料综合调查，完成首轮及最多一次补查，返回多来源引用和明确缺口；单独 knowledge reader/evaluation runner 不算应用接入完成。
- [ ] JSON 与 SSE 对同一案件给出一致的资料状态、阶段、引用和最终报告。
- [ ] 来源撤回、预算耗尽、取消、未知外呼恢复和引用失效均遵守边界；无效必要引用不留在依赖它的主张中。
- [ ] 冻结验证集使用全流程清单运行，结果签名绑定来源、模型、索引和题包；未决、超预算或签名不匹配时不生成通过记录。
- [ ] 交付可复现命令、报告、失败样例和面试讲解说明；所有模型质量指标明确标为自动估计。

## Comments

- 2026-10-23：普通 JSON/SSE 应用入口与引用投影已有确定性 transport 测试。冻结 validation 的 candidate 在单题模型调用 cap 下返回 HTTP 502，后续 baseline、Oracle、自动控制与验收阶段未运行；最终计划预估 1,001/1,000。没有完整 application run 或 acceptance record，不可报告为通过。需要增加经过批准的网关预算后再重新执行。
- 2026-10-23：用户已授权将全流程网关上限提高到 1,100 次；冻结 Agent 评测现可重新预检。此项仍保持 open，直到完整流程和验收门真实完成。
- 2026-10-23：新的冻结预检通过（1,001/1,100）；候选 Agent、基线、Oracle 和 acceptance 尚未运行。
- 2026-10-23：45 题候选跑完但用了复用的耗尽调查账本，结果只作 harness 诊断。已修复 case ID 隔离；剩余 282 次预算不足以完成新的候选、基线及 Oracle 全流程，未生成 acceptance。
- 2026-10-23：run-ID 隔离诊断跑到第 11 题后遇 gateway EOF，没有完整 run artifact。用户已将总上限授权提高到 1,300，重新预检需至少 1,284；仍必须完整完成 candidate/baseline/Oracle 后才尝试 acceptance。
- 2026-10-23：candidate/baseline/Oracle 已完整运行，验收记录 `not_accepted`。无阶段签名或预算违规；阻断原因是候选退步、基线阈值未达标，以及自动控制存在未决项。此 issue 保持 open。
- 2026-10-23：已补真实 `createApp` 的普通 JSON/SSE 知识问答测试，覆盖最终引用在检索后撤回时两边一致返回 `abstained`、零主张且不泄漏招募报告文案。知识问答 Planner 只暴露 `search_methodology`、`finish`，并在同一预算内完成无证据拒答。
- 2026-10-23：模型网关公共层已移至 `src/platform/`，并加入 Planner 与最终报告生成的独立计时。引用投影只保留最终重新解析成功的证据；不可用或找不到的引用会删除依赖它的旧证据与主张。显式球队/阵容样本检查仍走招募路径。
- 2026-10-23：网关配置后来按用户指示由 `group/free` 改回 `codex/gpt-6-luna`。没有在 `group/free` 下重新完成冻结质量评测；历史 Luna 验收仍为 `not_accepted`，本 issue 不因代码修复而关闭。
- 2026-10-23：普通 `createApp` 入口现有组合测试覆盖首轮和一次补查（RAG round 1/2）、双来源部分回答及引用、无证据拒答、JSON/SSE 同请求一致，以及取消后恢复时账本阻止未知查询再次外呼并安全拒答。最终引用撤回另有同一真实应用入口的双传输抑制测试。
- 2026-10-23：修复英文招聘问句 `How many minutes did the candidate play?` 被误路由到知识问答的问题；知识分类只在来源/研究上下文中接受英文问法，明确候选意图优先留在招聘流程。
- 2026-10-23：最终 Standards 复核另外发现评测题生成器应直接依赖 `src/platform`、泛化的英文 `find` 会误判论文问句，以及首个过期账本快照会返回旧状态；三项均已修复并加入回归覆盖。
