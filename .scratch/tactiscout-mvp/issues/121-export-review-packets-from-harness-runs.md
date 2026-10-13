# Export blinded review packets from validated Harness runs

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: 119, 120

## Goal

Connect the local Agent Harness to the source-grounded blind-review exporter without manually copying candidate IDs or recommendation order. Only a current, fully passing Harness run can become a review request; candidates the system did not rank remain unranked.

## Scope

- Add a pure module interface that consumes a local Harness result, a frozen Wyscout snapshot, and an explicit review context.
- Derive the candidate pool from successfully evaluated player IDs and system order from the actual report recommendation list.
- Validate the Harness schema version, successful completion, all-passing checks, recommendation membership, evaluated counts, and snapshot identity coverage.
- Group split source records for the same player into one blinded person card while preserving each team stint's metrics and provenance separately.
- Extend the local export CLI to accept either an explicit review request or a Harness result plus context; preserve separate, non-overwriting reviewer packet and answer-key outputs.
- Do not infer a ranking for evaluated candidates omitted from the report, or turn Harness passes into claims about recommendation quality.

## Acceptance criteria

- [x] The pure request builder accepts a current Harness result, frozen snapshot, and explicit query/metric context.
- [x] Only a fully passing run with candidate-discovery/evaluation invariants can be exported.
- [x] Candidate pool comes from successful evaluation trace IDs; ranking comes only from report recommendations.
- [x] Evaluated count, recommendation membership, and snapshot membership are cross-checked.
- [x] Split team stints for the same source player appear together on one anonymous review card without combining their metrics.
- [x] The local CLI exports a current real Harness run with multi-club player records and retains separate protected output files.
- [x] Focused deterministic tests cover the pure builder and CLI integration.
- [x] Evaluation docs include a reproducible local command and preserve the distinction between behavior validation and recommendation quality.

## Answer

已完成 `createReviewRequestFromHarnessRun(input)`。它只接受当前 Harness schema 2 中全局和目标运行均通过的 Wyscout/curated 结果，并要求候选评估顺序与推荐已评估检查存在且通过。候选池来自成功 `evaluate_candidates` 轨迹；实际推荐列表才进入系统排名，已评估但未推荐的候选仍在评审卡中并保持无排名。候选总数、报告名次、Wyscout 数据源和快照 ID 都在交给现有盲评导出器前校验。

`pnpm export:shortlist-review` 已新增 `--evaluation` + `--review-context` 模式，旧的显式 `--request` 模式保留。两种模式都只读本地文件、不请求 provider/LLM，分开写入受保护文件并拒绝覆盖。`docs/evaluation.md` 与上下文模板给出可复现流程和“Harness 通过不等于排序质量”的解释。

当前 schema 2 的真实 Qwen/Wyscout 完整链路通过 29/29 Harness 检查（172.083 秒）：三轮同案对话、两次追问/恢复、40 名发现候选、30 人评估、10 次工具调用、52 条进度事件、Reviewer 与报告。报告只给 1 条基于 key passes 和 goals 的前锋考察线索，并明确披露历史样本、尚未评估的 10 人与缺少的终结/接应指标。

同一球员可在快照中有多个球队记录，因此盲评导出将 30 条来源球员记录归为 29 张匿名球员卡；每一球队分段的比赛与指标独立保留，不做跨队求和或加权。CLI 从实际 Harness trace 和报告提取候选及排名，核对快照后成功生成 schema v2 的 `.data/evaluations/bayern-kane-blind-packet-v2.json` 与单独的 `.data/evaluations/bayern-kane-answer-key-v2.json`；两个文件权限为 0600，均不纳入 Git。这个评审包还没有人工标签，不能据此计算 nDCG 或声称排序质量。

验证：盲评请求 builder、导出纯函数与两种 CLI 输入路径 14/14 定向检查通过；API/Web 构建及 `git diff --check` 通过。旧版 schema 1 Harness 样本仍会被拒绝，不可作为当前基准。

