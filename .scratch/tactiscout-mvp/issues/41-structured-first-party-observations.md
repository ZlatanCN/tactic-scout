# Record structured first-party match observations

Type: task
Status: open
Labels: ready-for-human
Blocked by: none

## Goal

Make TactiScout's own match observations more useful to later scouting work by collecting a small set of repeatable ability dimensions alongside match-specific evidence, while preserving the fact that ratings are subjective human judgments.

## Scope

- Record team, observed position, and role context as explicitly observed facts, separate from verified current affiliation.
- Record viewing scope as full match, partial match, or edited clips, with an optional minute-range note; legacy records remain explicitly unknown.
- Allow up to one 1–5 human rating per TactiScout-defined ability dimension in a match record; include dimension, phase, optional match minute, and concrete evidence.
- Keep all ratings optional. An unobserved dimension stays unknown and must not be filled by an LLM.
- Preserve observer attribution, match/season context, access and AI/RAG permissions through local persistence and retrieval.
- Do not average ratings across matches or observers, standardize them, create a player-wide capability score, or include them in tactical-fit calculations.
- Keep existing free-form strengths, risks, and evidence notes for backward compatibility.

## Acceptance criteria

- Existing saved observations without structured ratings remain readable and editable.
- The UI can add/remove optional dimension records, choose the ordinal rating, capture a concrete evidence scene, and save/reopen the record.
- Invalid ratings, duplicate dimensions within a single match record, and evidence notes shorter than the minimum are rejected by the shared schema.
- [x] Any newly submitted structured rating requires nonblank competition, season, match, and viewing scope; unrated records may retain unknown context, and previously saved records remain readable.
- When AI/RAG processing is enabled, retrieval text includes each rating, dimension, sample time, observer, and an explicit subjectivity caveat; without consent, none of the text enters retrieval.
- README, `CONTEXT.md`, MVP spec, and an ADR agree that ratings are human-authored sample evidence, not objective statistics or an automatic score, and that the current scale has not been calibrated.
- Frontend and backend compile; no claim is made about inter-rater reliability until actual double-coded data is collected and evaluated.

## Research and decision

- [Data source research refresh](../research/football-data-source-research-refresh-2026-10.md): approved evidence types and current-data source limits.
- [ADR-0004](../../../docs/adr/0004-first-party-observation-ratings.md): sample-bound human ratings are kept separate from calculated statistics and deterministic fit scores.
- Dimensions: progression, ball retention, chance creation, off-ball movement, pressing, defensive positioning, duels, transition response. Each has a plain-language definition and possession phase.

## Comments

- 2026-10-04：扩展现有第一方观察功能；不另建平行笔记库。球员、样本、来源与权限继续由 issue 23 的本地观察模块管理。
- 2026-10-04：新增观察时球队/位置/职责与可选的 1–5 能力维度记录。该档位只描述单场主观判断，不聚合、不参与职责适配分；RAG 授权后才随署名上下文进入检索。
- 2026-10-04：服务端 `pnpm build` 与网页 `pnpm build:web` 均通过。工作台已目视核对表单展开、能力条目布局和本机交互；尚未收集真实双人标注样本，不能据此声称评分一致性可靠。
- 2026-10-04：观察库新增覆盖摘要，统计比赛上下文完整记录、结构化维度记录和检索状态，不按球员姓名合并。首批采集方法见 [issue 40 规程](../../../docs/scouting/first-party-observation-protocol.md)。
- 2026-10-07：一手方法研究显示，结构化表单不会自动提升观察可靠性，比赛情境也会影响表现判断。新增观看范围和分钟范围字段，并将缺失范围保留为未知；AI/RAG 文本明确 1–5 档是未校准的暂定判断。采集规程把 3/12 双人复评限定为流程试点，要求保留两份独立原始记录且不生成共识档位。当前产品仍允许编辑/删除，不能声称原始评分具备不可变审计保护。
- 2026-10-07：API 与网页生产构建通过。已存在的授权观察索引不会自动重建；若要让旧片段带上新的观看范围和“量表未校准”说明，需要在工作台重新保存对应记录。未运行观察模块测试。
- 2026-10-07：在运行中的浏览器检查观察弹窗默认宽度及 390×844 窄屏视口。观看范围和分钟范围字段可见，无横向溢出；无障碍树暴露“完整比赛/部分比赛/剪辑片段”选项，键盘路径可进入原生选择框。未创建或保存测试记录；真实 AI/RAG 索引消费该字段尚未实跑。
- 2026-10-10：状态改为 `ready-for-human`：产品录入与检索流程已实现；后续证据需要真人观看比赛和独立记录，不能由 agent 代造。
- 2026-10-11：Standards review found that a structured rating could be saved without its match sample. The shared input schema now requires competition, season, match, and viewing scope whenever ratings are present; the form marks those fields required only while a rating exists. Unrated records may still leave context unknown, and the persisted-record schema continues to read existing records with missing context. The shared-schema regression passed; API and Web production builds passed. This does not supply real observer samples or validate rating reliability, so the issue remains `ready-for-human`.

## Answer

进行中：结构化录入、观看范围上下文与权限感知检索已实现。下一阶段需要实际记录若干场比赛，再按规程做小规模流程试点；现有 3/12 双人复评设计不用于验证信度。更正式的一致性评估需预先确定样本设计和统计方法。

## Human action

在工作台记录真实观看过的比赛观察，再按[第一方观察规程](../../../docs/scouting/first-party-observation-protocol.md)完成小规模双人复评流程试点。不得用合成观察替代真实采样，也不得把 3/12 流程试点解读为量表信度验证。
