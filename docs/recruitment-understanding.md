# 通用招募对话

## 主链路

`record_turn → understand_request → choose_action → execute_tool → choose_action`。
身份或位置存在实质歧义时，沿用现有 interrupt/checkpoint；恢复后重新理解需求，再继续调查。用户选择身份或球场位置属于结构化回答，由状态标记，不依据用户文本前缀判断可信度。

任务分为补强、相似推荐、替代。相似推荐不要求目标球队。模型理解表达，程序校验原话与限制，身份服务核实人名，数据仓库提供实际可用画像。

## 模块边界

| 职责 | 文件 |
| --- | --- |
| 需求契约 | `src/domain/recruitment-brief.ts` |
| 用户依据、硬限制与可见候选指代校验 | `src/recruitment/brief.ts` |
| 模型结构化输出与有界纠错 | `src/recruitment/brief-interpreter.ts` |
| 流式可见正文与 token 归一 | `src/recruitment/model-output.ts` |
| 图内身份和需求更新 | `src/recruitment/conversation/understanding-node.ts` |
| 统一位置集合与查询意图 | `src/recruitment/candidate-search-intent.ts` |
| 参考能力/表现比较 | `src/recruitment/reference-similarity.ts` |
| 当前需求展示 | `web/src/features/recruitment/components/RecruitmentBriefSummary.tsx` |

不复制身份解析、工具执行、候选评估、保存计划和进度模块。未明确指定的年龄、预算不补造数值。未知位置不等于允许任意位置；宽位置也不等于已具备细分位置资格。

## 相似性

能力比较要求同一 FM 版本；表现比较要求可比较的来源、赛事、赛季、位置与足够分钟。两者分别保存距离和比较维度数量；缺失为 null，不能补零。距离不是转会可行性、成功概率或实力排名。

上一份可见报告的顺序作为候选指代上下文。“第三个”必须对应该报告第三人，不能从内部搜索列表挑人。新参考替换旧参考排除条件，本人始终排除。

## 模型与失败恢复

复用服务端 `OPENAI_*` 配置，不将密钥送到浏览器。Ollama 推荐通过 `config/ollama/Modelfile` 创建 16k 上下文别名；本机 11434 端点明确覆盖 presence/frequency penalty 为 0，远程端点不附加该参数。

结构化内容不合法时最多纠正一次，纠错只包含必要的字段和校验说明。连接故障不自动重复调用。LangGraph 流中的可见正文既可能是字符串，也可能是 text block 数组；只解析可见正文，不读取 reasoning 内容。

理解失败保留原始输入、显示重试，不读取成空市场结果。旧报告可以保留供参考；终态进度不能声称新报告已生成。

## 实验入口

```sh
pnpm eval:recruitment-understanding --suite regression --output /tmp/understanding-regression.json
pnpm eval:recruitment-understanding --suite heldout --output /tmp/understanding-heldout.json
pnpm eval:recruitment-understanding --suite followup --output /tmp/understanding-followup.json
pnpm eval:recruitment-mechanisms --mode graph --snapshot /absolute/frozen-players.json --output /tmp/mechanisms.json
pnpm eval:recruitment-mechanisms --mode identity --output /tmp/identity.json
```

输出路径必须不存在，文件权限 0600。模型实验串行执行；同一批比较记录冻结输入、配置哈希、真实模型调用、token 和轨迹。独立表达只测理解，不能替代身份或整图质量。没有匿名人工评审时，不能把报告完成或候选变化称为推荐质量提升。
