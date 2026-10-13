# 多来源当前赛季表现池

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

通过一个稳定的 `PlayerRepository` 接口，把现有 Understat 五大联赛与 ASA 北美男足当前赛季表现数据放进同一次自然语言球探调查，扩大候选发现范围，同时在 LangGraph 报告中逐条保留来源、赛事、赛季和指标证据。

## Scope

- 新增显式 `mosaic` 数据模式；不改变默认数据模式及用户 `.env`。
- 仅组合 Understat 当前五大联赛和 ASA 的三项北美男足赛事（MLS、USL Championship、USL League One）；其它 ASA 赛事不进入 mosaic。[Issue 149](149-separate-usl-super-league-from-mens-candidate-pool.md) 记录该范围的仓库与报告回归。
- 各来源按已缓存的当前赛季快照读取；来源失败时整次候选查询失败，不把部分来源结果伪装成完整多来源覆盖。
- 跨赛事自然语言搜索按赛事分组轮转分页，避免第一页被单一来源占满；精确联赛筛选仍只返回目标赛事。
- 保留每条来源记录原生 ID 和 `sourceIdentity`；不按姓名、球队名或数字 ID 跨来源合并。
- Peer comparison 只返回相同 provider、赛事、赛季和位置组样本；不将不同赛事的原始指标解释成同一尺度，也不对全部赛事作统一排名声明。
- Understat 年龄未知；跨来源或未限定赛事的年龄上限明确返回 `unsupported_scope`，不得静默丢弃欧洲记录或将未知年龄当作满足限制。只有明确限定到 ASA 男足赛事时才执行其年龄筛选。
- 报告标出真实观察到的赛事、赛季和记录范围；披露非完整注册名单、年龄覆盖缺口、不同来源指标口径及来源失败的影响。
- 编写仓库接口测试、过滤/轮转/peer grouping 回归，并以真实本地模型跑完整的仓库 → 多轮 LangGraph → Reviewer → 报告 Harness。

## Acceptance criteria

- [x] `mosaic` 模式显式启用，默认配置和现有 provider 模式保持不变。
- [x] 测试证明 Understat + ASA 合并不改写来源 ID；超出支持范围的 ASA 记录被过滤；姓名相同的跨来源球员记录不会被猜测合并。
- [x] 未指定赛事时分页轮转九个目标赛事；赛事筛选、位置、年龄和分页边界都有确定结果。
- [x] 跨来源年龄上限筛选明确失败并要求调整约束；只查 ASA 男足赛事时，可用该来源的年龄数据筛选。
- [x] 同来源比较样本不跨 provider、competition、season 或 position group。
- [x] 任一来源不可用时，LangGraph/Harness 明确记录来源查询失败，不能将其误报成零匹配或成功的部分覆盖。
- [x] 报告的数据范围来自本次实际读取记录，并展示能力缺口及年龄限制。
- [x] 本机 Qwen 3.5 9B 完成一次真实的多轮对话/追问、同案恢复、候选发现、分批评估、Reviewer 和最终报告；Harness 检查工具轨迹、来源身份、证据覆盖、交互终态和报告限制。
- [x] 指定测试、API/Web 构建及 `git diff --check` 通过；报告明确推荐排序准确性未验证。

## Research

- [Understat 五大联赛整链路](94-understat-five-league-conversation-chain.md)：已有 2026/27 五联赛球员表现池及三次完整 LangGraph Harness 运行。
- [ASA 北美赛事覆盖](76-asa-current-north-america-coverage.md)：已有 MLS、USL Championship 与 USL League One 当前赛季表现池和 2026 端点覆盖。
- [PitchAPI 扩展覆盖复核](../research/pitchapi-expanded-current-coverage-2026-10-08.md)：虽新增多地赛事与高级逐场指标，服务条款及数据留存/本地模型处理范围未从官方公开资料确认，因此本 issue 先组合已有来源，不用未核准数据填充仓库。

## Answer

已完成。`mosaic` 将 Understat 五大联赛与 ASA 北美候选记录通过统一 `PlayerRepository` 提供给 LangGraph；记录保留 provider/赛事/赛季/原始 ID，不按姓名合并，比较组不跨来源或赛事，跨来源年龄条件会明确拒绝。ASA 子池仅含三项产品支持赛事；其它 ASA 记录由 [issue 149](149-separate-usl-super-league-from-mens-candidate-pool.md) 的全链路回归验证不会进入报告。

2026-10-09 全链路实跑：本机 Qwen 3.5 9B + LangGraph 完成一轮真实对话。首轮宽位置搜索读到 1,387 条匹配记录，第一页轮转覆盖全部 9 个赛事；用户回答一次澄清后，同一案件继续按中锋需求搜索（316 条匹配记录），评估 10 名 ASA 候选，经过方法检索、候选分页、工具评估、Reviewer 到最终报告。Harness 场景通过（1/1），共 5 次工具调用、29 条进度事件，耗时 116.474 秒。Planner 一次扩样输出达到长度上限，运行按既有确定性回退完成了有证据的结论。

验证：`pnpm test` 299/299、`pnpm build`、`pnpm build:web` 与 `git diff --check` 通过。单次真实运行验证链路和行为契约，不验证推荐排序准确率、长期稳定性或来源对采集/缓存/本地模型处理/展示的授权；来源授权边界仍需单独核实。

### 2026-10-09 — 按用户确认的完整仓库到报告链路复验

进程级设置 `TACTISCOUT_DATA_MODE=mosaic`，未改动 `.env`，本机 Qwen 3.5 9B 再运行 `bayern-kane-replacement`。首轮跨来源宽位置查询轮转覆盖 9 个赛事、匹配 1,387 条记录并读取 20 人；Agent 随后追问职责，收到“中锋”补充后在同案搜索，匹配 316 条记录，读取 20 人并评估其中 10 名 ASA 候选。Planner 检索 2 条方法片段、球员报告检索为 0，Reviewer 通过并生成最终报告；报告的实际读取范围显示 332 条记录、9 个赛事、2026 与 2026/27 两个赛季。

本次 Harness 28/28 检查通过，用时 141.570 秒；1 次用户补答、5 次工具调用、29 条进度事件。扩样 Planner 输出达到 1,024 token 上限，LangGraph 按当前证据覆盖安全收束，而没有读取下一页。故本次证明多来源仓库到报告的对话、追问恢复、来源边界和 Reviewer 契约；同时暴露扩样决策截断会提前结束调查，不能据此宣称已充分搜索 316 条匹配范围或验证推荐排序准确性。

## Comments

- 2026-10-11: 官方赛事范围复核确认 USL Super League 属于职业女足。该 issue 的历史 mosaic 实跑和 NWSL 排除测试没有验证 USLS 排除；“ASA 四项北美男足赛事”属于错误分类。issue 149 跟踪修复和整图报告回归，不改变本文保留的 2026-10-09 运行结果。

### 2026-10-09 — 4K 上下文下无 fallback 整链复验

上轮错误地把扩样截断归因于 1,024 token 输出预算；读取 Ollama SSE 用量后确认是默认 4,096 token 上下文被 4,079 prompt tokens 几乎占满，模型只产出 17 tokens。扩页输入现移除与分页决策无关的工具历史，结构化能力覆盖、候选证据和 nextOffset 仍单独传入。默认输出预算和上下文下，Planner 正常返回 finish，fallback 数为 0；真实 `mosaic`→追问/同案恢复→候选评估→Reviewer→报告 Harness 28/28 通过（68.759 秒）。该次评估 10 人，只读取有限样本，不代表覆盖全部匹配记录或验证推荐排名准确性。
