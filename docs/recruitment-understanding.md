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
| 原子条件到来源查询/能力证据的编译与未支持条件识别 | `src/recruitment/criterion-compiler.ts` |
| 流式可见正文与 token 归一 | `src/recruitment/model-output.ts` |
| 图内身份和需求更新 | `src/recruitment/conversation/understanding-node.ts` |
| 条件编译后的候选查询意图与旧候选重新核验 | `src/recruitment/candidate-search-intent.ts` |
| 参考能力/表现比较 | `src/recruitment/reference-similarity.ts` |
| 当前需求展示 | `web/src/features/recruitment/components/RecruitmentBriefSummary.tsx` |

不复制身份解析、工具执行、候选评估、保存计划和进度模块。未明确指定的年龄、预算不补造数值。未知位置不等于允许任意位置；宽位置也不等于已具备细分位置资格。

## 条件账本与来源能力

`RecruitmentBrief.criteria` 是用户条件的唯一来源；位置、年龄边界、最低出场时间、赛事范围、能力证据偏好及 FM 数值都以独立条目保存。Planner 的查询提案由案件账本覆盖，先前发现或评估的候选也必须重新满足最新条件，不能因旧一轮命中而留在名单中。

FM 身高、CA、PA 与属性通过现有 FM 快照读取。可在独立画像范围内使用时按画像检索；目标球队、赛事或上场时间需要现役表现记录时，只通过已验证的身份桥接使用 FM 值。缺少 FM 数据的硬条件不会默默放宽，系统会暂停并说明；偏好按有数据的记录排序，缺失值保持未知。FM PA 是快照潜力参考，不是发展承诺，也不会与比赛表现合并成综合分。

当前不能筛选或核验的 required/excluded 条件会阻止推荐，要求用户决定移除条件还是保留并暂停；不可排序的 preferred 条件会保留在需求展示和报告限制中。报告中的 FM 覆盖区分候选范围、可比较记录和满足数值门槛的记录。

## 相似性

能力比较要求同一 FM 版本；表现比较要求可比较的来源、赛事、赛季、位置与足够分钟。两者分别保存距离和比较维度数量；缺失为 null，不能补零。距离不是转会可行性、成功概率或实力排名。

上一份可见报告的顺序作为候选指代上下文。“第三个”必须对应该报告第三人，不能从内部搜索列表挑人。新参考替换旧参考排除条件，本人始终排除。

## 模型与失败恢复

复用服务端 `OPENAI_*` 配置，不将密钥送到浏览器。生产模型请求由已配置的网关处理；实验不得把凭证写入配置文件、日志或浏览器。

每个需求理解或 Planner 操作共享同一重试额度：网络断连、HTTP 408/429/5xx 或单次模型超时最多自动重试一次，使用短退避和抖动；较长的 `Retry-After` 不会让请求无限等待。一次操作最多向模型发 4 个请求，上下文压缩和一次结构修正也计入总额度。用户取消会立即结束，不会触发重试；额度耗尽后保留案件和原始输入，提示用户稍后重试。可重试时进度流会显示正在重试。

只读数据源查询仅对明确分类的网络中断或超时自动重试一次。鉴权、权限、参数校验、位置范围不支持等确定性错误不重试；未分类的提供方错误会保留为查询失败，不能当成零匹配结果。用户改变筛选范围后，旧范围的失败状态清除，再按新条件调查。

结构化内容不合法时最多纠正一次，纠错只包含必要的字段和校验说明。LangGraph 流中的可见正文既可能是字符串，也可能是 text block 数组；只解析可见正文，不读取 reasoning 内容。

最终报告最多展示 5 名具备本轮证据的候选；候选池只有更少的合格人选时按实际数量展示，不为凑数推荐。若已评估池里有 5 名或以上可支持的候选，结构化结论必须给出 5 名。用户表达“年轻”等年龄偏好时，年龄只作为软排序依据：有年龄记录的人选按偏好排序，未知年龄排在已知年龄之后，不从模糊表达捏造年龄上限。

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
