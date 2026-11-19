# TactiScout

TactiScout 是基于 LangGraph.js 的足球资料 Agent。它从 Football Manager（FM）、Understat、Reep 身份注册表和可选的 API-Football 球队阵容中读取资料，用于球员查询、比较和推荐。

项目目前面向本地开发和私有演示，没有前端或独立应用数据库。LangGraph 管理请求路由、澄清中断、线程状态和受管会话持久化。

## 功能

| 工作流 | 处理方式 |
| --- | --- |
| 球员查询 | 先解析球员身份，再用确认过的来源 ID 查询 FM 画像或 Understat 赛季记录。 |
| 球员比较 | 确认参与者和范围后，由确定性比较节点读取数据；模型只解释已验证的结果。 |
| 球员推荐 | 使用 FM 位置属性排序能力相似球员；用户询问潜力时，另列按 PA 排序的名单。 |
| 球队推荐 | 解析 API-Football 球队和当前阵容，将阵容成员映射到 FM 画像后，按明确指定的位置推荐球员。 |

需要确认球员、球队、阵容映射或条件时，图会暂停并等待同一线程中的回复；恢复时继续原请求。

## 数据与身份边界

- FM 是固定日期的能力快照，只支持其中的 CA、PA、位置和属性；不能据此推断赛季表现、当前注册或转会状态。
- Understat 记录属于具体赛事和赛季，不代表球员当前所在球队或实时状态。
- 同名不代表同一身份。跨来源记录只有在 Reep 明确关联，或用户确认后，才能作为同一球员使用。
- 球队推荐要求用户指定球队和 FM 位置。若阵容成员无法映射到本地 FM 画像，流程会暂停，不会猜身份或把该球员重新推荐出来。
- API-Football 当前阵容在进程内缓存七天。API key 只从本地环境读取；不要提交密钥或公开分发原始阵容数据。

本地 FM、Understat 和 Reep SQLite 文件不包含在 Git 仓库中。启动前需准备相应数据，并让 `.env` 中的数据路径指向这些文件。FM 和 Understat 数据发送到模型前分别受来源处理许可控制，默认关闭。

## 本地启动

需要 Node.js 22.13 或更新版本、pnpm、可用的 OpenAI 兼容模型端点和本地资料数据库。

```bash
pnpm install
if [ ! -f .env ]; then cp .env.example .env; fi
```

在 `.env` 中配置模型凭据。示例文件默认指向 `http://127.0.0.1:3425/v1` 的本地网关；如果你使用其他端点，请同步修改 `OPENAI_BASE_URL`。示例中的 `TACTISCOUT_MODEL_CONTEXT_PROFILE` 留空；自定义网关必须先填写匹配模型名和 base URL 的真实上下文能力，才能调用模型。球队推荐还需要 `API_FOOTBALL_KEY`。

本地数据路径可按需修改：

| 环境变量 | 示例默认路径 | 用途 |
| --- | --- | --- |
| `TACTISCOUT_FM_PROFILES_PATH` | `.data/fm/profiles-v2.sqlite` | FM 画像与位置评分 |
| `TACTISCOUT_UNDERSTAT_DB_PATH` | `.data/understat/understat.sqlite` | Understat 赛季表现 |
| `TACTISCOUT_REEP_IDENTITY_DB_PATH` | `.data/reep/identity-with-fm.sqlite` | 跨来源身份关联 |

启动 LangGraph Dev Server：

```bash
pnpm dev
```

图 ID 为 `agent`，定义在 [`langgraph.json`](langgraph.json)。真实 `.env` 和 `.data/` 均被 Git 忽略。

### 自定义模型网关

可信官方端点上的已知模型可使用项目能力资料。自定义网关或未知模型需要在 `TACTISCOUT_MODEL_CONTEXT_PROFILE` 提供与当前模型名和 `baseURL` 精确匹配的 profile，其中必须包含实际的 `maxOutputTokens`，以及 `contextWindowTokens` 或 `maxInputTokens`。不要猜测模型窗口；profile 细节见 `.env.example` 和 [`model-context.ts`](src/model-context.ts)。

FM 与 Understat 的远程模型处理许可单独配置：

```dotenv
TACTISCOUT_FM_AI_PROCESSING_ALLOWED=false
TACTISCOUT_UNDERSTAT_AI_PROCESSING_ALLOWED=false
```

只有在理解并接受相应来源资料会发送给模型端点后，才为所需来源显式开启许可。

## 运行时上下文管理

每次模型调用前都会估算完整输入并应用有限输出上限。接近预算阈值时，系统会自动处理旧上下文；单条超长请求会分块提取并合并任务条件。大结果会按工作流投影和分批解释，同时保留完整原文、来源记录和已验证结果。

每个请求默认最多使用 6 次额外上下文处理模型调用和 120 秒累计活动时间，两者任一耗尽即停止。失败和重试也计入额度；正常重启不会清零。只有上下文处理额度耗尽且源请求仍有效时，球探明确要求继续才会追加新额度。若处理仍无法完成，系统保留已完成数据并说明未完成范围。

provider 实际报告输入溢出或模型输出被截断时，系统会在预算内缩减或恢复；不能恢复时不会把部分输出标记为完成。阈值、缓存失效和继续规则见[运行时上下文设计](.scratch/runtime-context-management/spec.md)与 [ADR-0012](docs/adr/0012-model-input-budget-and-persisted-evidence.md)。

## 会话持久化

通过 `pnpm dev` 启动的受管 Dev Server 在正常停止并重启后保留线程状态、待恢复的澄清和已保存结果。继续同一会话时使用原线程。直接在代码中调用 `createAgent()` 默认使用进程内存；它本身不提供重启恢复。强制终止进程、断电或存储损坏不在恢复保证范围内。

球员身份记忆通过对话中的显式操作查看、纠正或删除；详见[本地会话恢复说明](docs/local-development.md)。

## 开发与验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm exec ultracite check src tests evals CONTEXT.md
```

测试使用假模型、固定证据和本地模拟 provider；不会调用真实模型或足球数据 API。首次 tokenizer 计数可能从 `tiktoken.pages.dev` 下载编码文件。

本地评测的 smoke、development、held-out 流程，固定证据准备和请求预算说明见 [`evals/README.md`](evals/README.md)；测试组织与选取测试边界见 [`tests/README.md`](tests/README.md)。

## 代码导航

```text
src/
├── agent.ts                 # StateGraph 组装和工作流路由
├── state.ts                 # 请求、线程上下文、澄清与结果快照
├── request-extraction.ts    # 结构化请求理解
├── request-building.ts      # 当前轮请求构造和条件继承
├── workflow-continuation.ts # 最近成功工作流和已保存结果续接
├── context-processing-*.ts  # 上下文状态、额度和续接
├── nodes/                   # LangGraph 节点
├── player-data/             # FM、Understat、Reep 数据和身份逻辑
├── team-data/               # API-Football 球队与阵容适配
└── tools/                   # 模型可调用的数据工具
```

架构词汇见 [`CONTEXT.md`](CONTEXT.md)，已接受的架构决策见 [`docs/adr/`](docs/adr/)。
