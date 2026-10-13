# Export blinded candidate packets for shortlist review

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Create a reproducible, source-grounded review packet from a frozen candidate pool so independent football-informed reviewers can assess role fit without seeing the model identity, system rank, player identity, or model rationale.

## Acceptance criteria

- [x] Export is built from an explicit, locally retained dataset snapshot and records source, dataset/version ID, snapshot content hash, as-of time, and derivation ruleset.
- [x] Each anonymous card includes only observed, source-backed fields needed for the frozen query: broad position, age when known, competition/season, sample size, metric value/unit, metric definition/source field, and missingness. Missing values remain missing and are not converted to zero.
- [x] The reviewer packet includes the frozen role brief and a stable anonymous card ID, but omits player name/ID, club identity, system name/rank, model rationale, and non-source-backed claims.
- [x] A separate answer key maps anonymous IDs to source player IDs and each system's rank. The packet generator never places that key in the reviewer-facing file.
- [x] Export rejects incomplete or inconsistent candidate evidence, duplicate source record IDs, rankings that reference candidates outside the frozen pool or repeat the same person, and snapshots whose declared hash does not match their content. Distinct team records for the same Wyscout person are grouped into one review card with separate evidence rows.
- [x] A local CLI writes the reviewer packet and answer key to caller-chosen paths, never calls a provider or LLM, and defaults to non-destructive output handling.
- [x] Documentation explains blinding limits, reviewer instructions, local data handling, and why adjudicated labels must be locked before joining the answer key.
- [x] Deterministic tests cover source provenance, anonymity, evidence completeness, hash mismatch, ranking joins, and refusal to overwrite existing output.

## Context

- [Human-labeled shortlist benchmark](119-human-labeled-shortlist-benchmark.md): consumes frozen, independently judged candidate pools and reports `not_evaluable` when evidence or labels are incomplete.
- [Recommendation evaluation protocol](../research/scouting-recommendation-evaluation-protocol-2026-10-06.md): blind, double-rated, query-specific 0–3/`unknown` fit judgments; unknown is not a negative label.
- [Wyscout dataset builder](../../../src/dataset/wyscout-dataset.ts): existing historical dataset snapshot includes upstream input hashes, provenance, attribution, and a derivation ruleset.

## Answer

已实现 `exportBlindedReviewPackets(input)` 和 `pnpm export:shortlist-review`。核心函数读取原始快照 JSON 字节并核对 SHA-256；只从本地快照生成来源/许可/时间/规则元数据和源字段证据卡。缺失属性保留为 `null`/`missing`，不补零；匿名卡 ID 使用 CLI 随机 HMAC 密钥生成并按卡 ID 排序，避免泄露系统名次。同一 Wyscout 外部球员 ID 对应多支球队记录时归为一张卡，指标和样本仍按来源记录分别呈现；姓名、来源球员 ID 列表、球队和各系统排名单独写入答案键。系统排名若把同一球员的多个球队记录重复列入则拒绝。

快照来源元数据、CC BY 4.0 许可、候选池身份、系统排序引用和相同指标定义会在导出前校验。CLI 只读本地文件，不连接数据源或模型；两个输出均以 `0600` 权限新建，有既有目标时拒绝覆盖，并在键文件冲突时清理刚创建的评审包。评审说明要求先保存并锁定独立评分，再打开答案键；证据组合仍可能让熟悉数据的人推测球员身份，所以材料称为去标识化，不宣称不可重识别。

验证：纯函数 8 项、CLI 2 项定向测试通过；完整套件 340/340、API/Web 构建、空标签 `not_evaluable` 命令和 `git diff --check` 通过。测试只使用固定 fixture；没有生成球员判断或提交真实的人工评审包。

## Comments

- 2026-10-09: Issue 119's offline evaluation core is complete. This ticket closes its export prerequisite; real human judgments still need to be collected for a frozen football role and candidate pool.
- 2026-10-09: The current LangGraph response exposes only final recommendations. Privacy-safe Harness traces retain candidate/evaluated IDs but intentionally omit metric values. The exporter therefore consumes the explicit candidate pool and ranking list while reading all evidence directly from the frozen warehouse snapshot; it never reconstructs missing fields from report prose.
