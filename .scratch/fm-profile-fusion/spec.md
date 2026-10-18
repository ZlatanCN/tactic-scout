# FM 能力画像与比赛证据融合

Status: resolved
Labels: ready-for-agent

## 目标

将本机 FM26 CSV 导入可复用的 SQLite 画像库，与现有比赛数据共同召回、精确身份关联、评估和比较候选。主报告突出职责与取舍，不展示 FM 来源品牌；后台保留来源、版本、日期和映射证据。只保留确认的 156 列。

## 验收清单

- [x] 流式导入、156 列白名单、范围校验、原子发布、禁止覆盖、版本 manifest 和查询索引。
- [x] 姓名与别名召回、可靠跨来源映射；歧义与无映射记录独立保留。
- [x] 十类职责、共同召回、完整分页、缺失值语义、融合模型与参考比较。
- [x] LangGraph 工具与调查策略、Planner 画像说明、Reviewer、参考球员排除、取消和报告证据。
- [x] 候选卡、完整属性、性格与整体参考、比较界面；使用设计 skills 并做真实页面检查。
- [x] 冻结前锋/中场/门将三场景，现有来源/FM/融合九次运行及真实盲评包。
- [x] 最终构建、全量回归、运行状态与文档汇总。

## 不变量

属性不是比赛率值，不使用出场分钟作为属性可用性门槛。原始/显示两种尺度不重复计分；缺失不是零，缺少来源不转移权重。仅唯一精确桥接可附加另一来源画像，FM ID 不当作其他 provider 的 ID。原始导出、数据库、密钥、实验原文与答案键不提交 Git。用户确认本次数据全部为男子，manifest 记录 dataset_owner 确认，不从姓名推断。

## 实际数据与配置

102,708 条画像、156 列；当前 `.data/fm/profiles-v2.sqlite`，schema 2。原 CSV SHA-256：`431eecb0a892bf7be8e056832a6fd9e553f461d1b629fdd080ea31e847bd85eb`。本地 Reep 索引 `.data/reep/identity-with-fm.sqlite` 含 fm/player 桥接。两条路径已启用在私有 `.env`。

## 验证证据

真实 Ollama 凯恩替代者报告生成两名候选，包含属性与比赛资料并排除 Kane。最新真实诺伊尔替代者报告生成 Maignan、Safonov、Verbruggen，排除 Neuer；卡片展示门线与出击出球职责，不再默认显示无关进球/助攻。

前端 390px 无页面溢出；属性标签、展开/折叠、选择比较、清除比较与键盘交互实机通过。匿名包实际导入 `/review`，属性与比赛样本分别呈现。详见 `ui-review.md`。

三臂结果 `.data/evaluations/fm-fusion/paired-v4.json` 九次均完成；最终匿名材料 `.data/evaluations/fm-fusion/review-final/`，三个场景各 8、6、5 张卡及独立答案键。空名单臂也保留在后续质量数据集。详见 `experiment-results.md` 与 `completion-audit.md`。

没有真实独立人工评分和裁决，不声称推荐质量提升，不计算 nDCG。画像提高本次有界调查的可评估覆盖；冻结实验缺少额外位置网页详情，本机耗时较长，均在结果中明确保留。

最终验收：575/575 全量回归通过；服务端 TypeScript、前端 TypeScript 与 Vite 构建通过；最终服务监听本机 8000，前端 5190。最终匿名材料验证为 3 包、19 卡、9 个实验臂，无候选姓名或来源 ID 泄漏。完整证据见 `completion-audit.md`。
