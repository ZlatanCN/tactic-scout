# Distinguish planner decisions from policy actions in the agent trace

Type: task
Status: resolved
Labels: ready-for-agent

## Goal

Make LangGraph's evaluation trace accurately show when the model-backed planner proposed an action, when deterministic policy selected an action, and whether policy changed the planner's proposal. The harness must not count its own fallback behavior as model orchestration.

## Why now

`usedMultipleModelActions` previously counted all `decision` trace events. Some events are deterministic exits, such as a fixed-position clarification or an empty-result policy response, so this check could pass without multiple planner calls. This obscures the split between model reasoning and the LangGraph/harness control flow that makes the project distinctive.

## Acceptance criteria

- [x] Decision trace events identify `planner` or `policy` as the source.
- [x] Planner events retain only the proposed action name and the policy-selected action name; they never include the natural-language payload or hidden reasoning.
- [x] The Harness's multiple-model-action check uses successful Planner calls when source metadata exists, with compatibility for older synthetic traces.
- [x] CLI output reports Planner decisions, deterministic policy decisions, and proposal overrides separately.
- [x] README, `CONTEXT.md`, and the issue map describe the same trace semantics.
- [x] The API and web production builds pass.

## Comments

- 2026-10-04：用 codebase-design skill 检查 LangGraph 控制流、Planner adapter 与 Harness trace；发现 trace 把 policy 结束动作计入模型决策，降低了项目编排能力的可验证性。
- 2026-10-04：未新增或运行自动化测试；本轮只执行类型检查/生产构建和差异格式检查。

## Answer

Planner/策略决策来源、提议/选中动作差异及独立计数已接入 trace 和 CLI；README、`CONTEXT.md` 与 map 已同步。`pnpm build`、`pnpm build:web` 和 `git diff --check` 通过。本轮没有运行自动化测试或真实模型复跑；因此这里只确认实现与编译，不声称模型行为结果。
