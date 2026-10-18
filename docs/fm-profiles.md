# 本地球员能力画像

导入命令：

```sh
pnpm dataset:import:fm --csv /absolute/path/players.csv \
  --in-game-date 2025-11-23 --game-build 26.3.2 \
  --database-version 26.2.0 --parser-version 0.5.10 \
  --male-only-confirmed
```

默认输出 `.data/fm/profiles.sqlite`，已存在时拒绝覆盖。更新数据时用 `--output` 指定新文件，核对完成后再切换。数据库和原始 CSV 不提交到 Git。

`--male-only-confirmed` 记录数据所有者对男子范围的确认；CSV 本身没有性别列，未确认的导入不会被标记为男子范围。本次用户已确认数据全部为男子。

画像只保留批准的 156 列。原始属性用于计算，显示属性用于 UI，两者不重复计分。出生日期替代旧存档的年龄字段。合同、身价、当前球队、伤停与未知合同字段不进入画像。

`FmProfileRepository` 提供姓名候选、来源记录查询和位置分页。同名记录全部保留；查询结果不自动代表跨来源身份关联成功。来源 `uid` 仅在该快照内使用，`unique_id` 也不作为其他 provider 的 ID。

职责模板及融合权重是待评估的显式初值。能力分与比赛证据分别保存；缺失保持未知，计算搜索优先级时使用固定的中性先验，不把缺失值当零，也不把另一来源权重重新分配给已知来源。部分画像不产生完整适配分。

schema 2 增加职责召回索引。配置 `TACTISCOUT_FM_PROFILES_PATH` 后，现有仓库会包装为融合仓库；跨来源关联使用 `TACTISCOUT_REEP_IDENTITY_DB_PATH` 指向的 Reep 索引，其中必须包含 `fm/player` 桥接。索引缺少桥接时保留独立记录，不按同名强行合并。

完整 LangGraph 测试已覆盖两类证据进入同一报告和参考球员排除。前端能力卡、实机运行、配置切换和九次三臂运行已完成，详见 `.scratch/fm-profile-fusion/spec.md`。初始融合权重不代表已证明推荐质量提升。

## 三臂对照

```sh
pnpm eval:fm-fusion --snapshot .data/evaluations/agent-optimization/understat-snapshot.json \
  --profiles .data/fm/profiles-v2.sqlite \
  --identity .data/reep/identity-with-fm.sqlite \
  --output .data/evaluations/fm-fusion/new-results.json
```

同一冻结比赛目录与画像版本，分别屏蔽能力或比赛证据，再运行融合组。覆盖中锋、中前卫、门将三个场景；每臂使用同一 LangGraph、模型、追问答复和预算，额外网页调查关闭。输出拒绝覆盖，保存实际状态、报告、耗时、工具与模型 token 用量；没有用量时保留 null。`--rounds` 可增加重复次数，奇数轮反转运行顺序。当前结果仅能说明行为、覆盖和成本，人工独立盲评之前不报告推荐质量提升。

实际页面验收发现，原有 Understat 调查前置分支可让模型在候选尚未评估时结束；已修复为优先评估有画像的候选，并补上有批量调查接口的整图回归。详见同目录计划与界面检查记录。

## 匿名评审

```sh
pnpm export:fm-review --evaluation .data/evaluations/fm-fusion/paired-v3.json \
  --identity .data/reep/identity-with-fm.sqlite \
  --output-dir .data/evaluations/fm-fusion/review-new
```

先验证各场景三臂均完成，再创建全新目录。每个场景产生独立的 `*-review.json` 和 `*-answer-key.json`。评审包可导入现有 `/review`，答案键在独立评分和裁决完成后才用于 `/adjudicate`。三臂推荐候选取并集，精确身份分组；全部评审者使用相同证据池，姓名、球队及策略排名保留在答案键。属性没有比赛分钟，保存为 null；未记录的再分发授权不伪造成开放许可证。任何失败臂都使完整三臂导出失败，原实验失败记录仍保留。

前锋早期四张匿名卡已在浏览器导入成功。最终 v4 三场景的匿名材料在 `.data/evaluations/fm-fusion/review-final/`，分别 8、6、5 张卡；答案键也记录没有推荐的空名单臂。没有真实独立评分或裁决，不计算或展示推荐质量提升。
