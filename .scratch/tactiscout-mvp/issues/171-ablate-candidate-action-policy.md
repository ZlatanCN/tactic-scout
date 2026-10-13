# Measure the candidate action policy with a controlled graph ablation

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Verify how much the candidate action policy contributes to the LangGraph's ability to keep data queries and recommendations within the user's explicit recruitment scope.

## First-principles boundary

- The policy is a deterministic safety mechanism around a probabilistic Planner. A normal-model pass does not prove the safety gate matters; the experiment must include an adversarial proposal that violates explicit constraints.
- Use one frozen user request, one exact scripted Planner sequence, one in-memory two-candidate repository, and the same compiled graph in both arms. Toggle only `applyRecruitmentCandidatePolicy`.
- Keep later graph eligibility checks, tool budgets, evaluator, Reviewer, and report delivery active in both arms. This measures the added action-normalization policy on top of existing graph safeguards, not the value of every safety layer.
- This is a deterministic control-flow ablation, not a model-reliability estimate, shortlist-quality evaluation, live-data experiment, or comparison of agent frameworks. Do not make claims about recommendation accuracy.
- The bypass is only exposed through the `createRecruitmentConversation` experimental seam; configured/API production construction must keep the policy enabled and must not accept a user-requested bypass.

## Public seam

- `createRecruitmentConversation` with the same injected Planner and repository in enabled and bypassed candidate-policy modes; assert observable repository queries/reads and final report.
- No internal graph node tests, live model calls, CLI option, or external source access is needed for this narrowly controlled contrast.

## Acceptance criteria

- [x] The graph defaults to policy enabled, and configured production construction cannot disable it.
- [x] Both arms receive the same adversarial Planner actions and candidate fixtures; only the named candidate-action policy varies.
- [x] The enabled arm queries with the user's position, age, minutes, competition, and season; it reads/evaluates/recommends only the eligible candidate.
- [x] The bypass arm's observed query and downstream candidate outcome show which failures the central policy prevents and which later graph safeguards still catch.
- [x] The test reports only control-flow and evidence-boundary observations, with no player-quality claim.
- [x] `pnpm test`, API/Web production builds, and `git diff --check` pass.

## Answer

- Added `experimentalCandidatePolicyMode` to the low-level `createRecruitmentConversation` test seam. It defaults to `enabled`; `configuredRecruitmentConversation` does not expose the bypass, so the configured/API path cannot turn it off.
- A deterministic full-graph paired test uses the same adversarial Planner and two fixed candidates. The enabled arm queries ST, age ≤23, at least 900 minutes, EPL, 2024/25, then recommends only `eligible-forward`. The bypass arm queries La Liga 2025/26 without age/minutes limits and changes the report target to `Other Club`; shared downstream eligibility filtering and the evaluator now prevent the returned out-of-scope candidate from being read, evaluated, or recommended, so the report has no recommendation.
- The Reviewer passes both reports because neither makes an unsupported evidence claim. The contrast shows the central policy's contribution to correct query scope and team context, while also showing that shared eligibility filtering and the evaluator's read boundary keep a mis-scoped candidate out of downstream evidence processing. The Reviewer checks evidence support; it is not the user's scope policy.
- This is a deterministic control-flow ablation, not an estimate of model reliability or recommendation quality. The source fixture is synthetic.
- Verification after issue 181's constraint change: the full suite passed 427/427, `pnpm build`, `pnpm build:web`, and `git diff --check` passed. The ablation now explicitly checks repository-read and evaluation IDs in both arms.

## Research

- The [LangGraph JavaScript testing guide](https://docs.langchain.com/oss/javascript/langgraph/test) recommends compiling a graph with a fresh checkpointer to test graph behavior; direct node tests bypass checkpoint behavior. This supports using the approved whole-conversation seam for this contrast.
- The [τ-bench paper](https://openreview.net/forum?id=roNSXZpUDN) evaluates tool-agent-user policy adherence through verifiable environment outcomes and repeated trials (`pass^k`). This issue uses a deterministic adversarial Planner fixture to isolate one code gate, so it does not claim model reliability or generalize from repeated samples.

## Comments

- 2026-10-12: Issue 170's full-graph adversarial fixture found the candidate action policy is an independently observable safety mechanism. The project objective requires core mechanisms to be tested by ablation; this slice compares the same compiled graph with only that mechanism enabled or bypassed.
- 2026-10-13: Revisiting the experiment after tightening candidate intent found the bypass arm could still fetch an out-of-scope ID before its eligibility intersection. The evaluator now builds the fetch list from eligible IDs first. The paired experiment still shows the policy's query-scope and target-team effect, while accurately treating downstream eligibility as an independent safeguard.
