# 210 — 通用球员身份解析与确认

Type: task
Status: resolved
Labels: ready-for-agent

## Objective

允许用户在自然语言引援需求中用中文名、外文名、已知别名、外号或轻微错字提及任意球员。身份识别必须与球队现役情况、比赛数据记录和球员表现证据分离；不确定时停止并让用户确认，不能猜人或把查询失败说成不存在。

## Acceptance

- [x] 原始提及保留，解析器分别报告唯一确认、待确认候选、未找到、服务不可用。
- [x] Wikidata 多语言标签/别名与足球运动员职业用于身份核验；联网搜索先生成候选，唯一且跨站一致的结果还需 Wikidata 职业校验后才能继续。
- [x] 别名/轻微错字召回可以建议候选，但相似度本身不能自动确认身份；多候选不会按排名第一消歧。
- [x] 歧义时对话展示具体候选身份供用户选择；无候选时询问补充线索；服务不可用时明确说明查询状态。
- [x] 用户确认后在同一案件中恢复 LangGraph，并基于确认实体重查目标球队样本、位置和本人排除。
- [x] Wikidata 身份不被当作现役球队、年龄、合同、能力事实；不同数据源球员记录不因姓名而合并。
- [x] 已解析结果显示可纠正的“按该球员处理”；无匹配表现记录时明确披露样本缺口，不输出“市场无人”。
- [x] 固定测试覆盖中文简繁标签、外文重音、已知别名、错字、同名、未命中、服务失败、取消与用户确认；整图验证本人排除与候选搜索可继续。
- [x] 使用相同固定案例对精确匹配/错字召回及整图身份核验做配对消融；记录覆盖变化与错误自动确认数。

## Design constraints

- 不预载全球球员百科；采用按需解析和有界内存缓存。
- 只保留必要的实体字段与来源链接；不保存搜索摘要正文。
- 只有经过 Wikidata 足球运动员职业校验的实体可以作为实体候选。
- 参考球员与本地表现记录之间没有可靠来源 ID 时，只做明确标注的单源精确名称匹配；不跨源合并身份。
- 用户确认的实体 ID 是本次案件决策输入，不覆盖或改写原始自然语言。

## Verification

- `tests/player-name-resolver.test.ts`: resolver contract, multilingual/alias/fuzzy/ambiguity/error behavior and resolver ablations.
- `tests/recruitment-conversation.test.ts`: whole LangGraph flow pauses on uncertainty, resumes on a selected identity, rechecks team context and excludes only the selected reference when exact source-name evidence exists.
- API/web contract tests: identity question is serialized and submitted with a bound question ID.

## Experiment log

- Resolver ablation uses the same four fixture mentions in both arms. Exact-only and fuzzy-enabled arms each resolve the two exact multilingual names (2/2); fuzzy recall adds two misspelling suggestions (2 vs 0); fuzzy auto-confirmations remain 0.
- Whole-graph paired control: without the resolver, the reference name can remain in the shortlist; with a resolved identity, the exact same-provider record is excluded and the teammate remains. Uncertain identity pauses before candidate search; selecting a current option resumes the same case, rechecks the team sample, and continues.
- Tavily fallback is tested as hint-only: it cannot start candidate search or silently set identity; confirmation is required. Without fallback, the case asks for more identifying context. A confirmed historical reference absent from the current team sample is reported as `not_observed_in_team_sample`.
- Live lookup on 2026-10-16: `基米希` returned a unique two-host Tavily lead, verified by Wikidata as Joshua Kimmich (Q13865408), and continued automatically. The misspelling `基米西` returned Joshua Kimmich and Joshua King, so it paused with both choices rather than guessing.

## Limits

- Coverage depends on Wikidata labels/aliases and what Tavily can find. No resolver can promise every nickname, typo, local transliteration, or undocumented player; unresolved names pause for user context.
- Traditional and simplified names work when an exact corresponding Wikidata label/alias is returned. The project does not include a general Chinese conversion or phonetic transliteration corpus.
- A single web-backed result continues only after the same player name is corroborated on at least two HTTPS hosts and Wikidata confirms the footballer occupation. Search quality can still vary, so the report labels the method and keeps the resolved identity user-correctable.
- The ablation is a deterministic fixture experiment, not a measured real-world identity precision/recall benchmark. The two live lookups are smoke evidence only, not a coverage estimate.
- Final verification on 2026-10-16: `pnpm build`, `pnpm build:web`, Web tests (8/8), focused identity and conversation tests (38/38), and the full `pnpm test` suite (561/561) passed. Earlier local-listener `EPERM` failures did not recur.
