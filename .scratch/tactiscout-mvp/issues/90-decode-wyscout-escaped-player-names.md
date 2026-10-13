# Decode escaped Unicode in Wyscout source names

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Decode double-escaped Unicode text found in the Wyscout open-data files before it reaches the curated snapshot and scouting report.

## Acceptance criteria

- [x] Player names containing literal `\\uXXXX` sequences render as the intended Unicode characters.
- [x] Team and competition labels pass through the same source-text normalization.
- [x] A regression test covers the Wyscout source representation.
- [x] The existing local historical snapshot is rebuilt from already-downloaded source files, without changing the source scope or fetching new data.
- [x] The running report shows the corrected name.

## Comments

- 2026-10-08：窄屏报告验收发现 `Rémi Walter` 显示为字面量 `R\\u00e9mi Walter`。对原始 Wyscout `players.json` 解析后的 2,081 个姓名字段发现了 `\\uXXXX` 文本，快照构建器保留了这些反斜线；因此在数据源入口修正并重建本机快照，不在 React 展示层做替换。
- 2026-10-08：在 Wyscout provider 读取球员名、球队名和赛事名时解码 `\\uXXXX`，保留源 ID 与统计值不变。新增定向回归测试，先复现 `R\\u00e9mi Sample` 再验证 `Rémi Sample`、`Clément FC` 与 `Ligue d’été`；目标测试通过，TypeScript 构建通过。使用已有 `.data/wyscout-open-data` 重新构建快照，记录数仍为 2,682；没有下载新数据。重启本地 curated API 后以相同需求重跑真实 Qwen/LangGraph 报告（174.6 秒），UI 展示 `Rémi Walter`，其余历史样本范围与限制保持一致。

## Answer

已完成。Wyscout 入口统一解码姓名、球队和赛事文本；定向回归测试与 TypeScript 构建通过。本机历史快照基于既有来源文件重建，未扩展数据；真实报告现显示正确 Unicode 姓名。
