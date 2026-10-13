# Review Agent Engineer hiring signals against TactiScout

Type: research
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Identify which capabilities current Agent Developer / AI Agent Engineer roles ask candidates to demonstrate, using employer-owned job postings, then map those signals to evidence already present in TactiScout and identify the highest-value project gap.

## Scope

- Search current public roles relevant to agent engineering, including China-based roles and international roles where the employer publishes an official description.
- Use the employer's own job page as the source of truth. Record the page and checked date; distinguish active roles from stale or inaccessible listings.
- Summarize repeated requirements without claiming the sample represents the whole labor market.
- Compare each requirement with concrete project evidence and identify what is missing or weakly evidenced.
- Do not add resume claims or claim model/recommendation quality without evidence.

## Acceptance criteria

- [x] A research report is saved under `.scratch/tactiscout-mvp/research/` with direct citations to primary employer sources.
- [x] The report distinguishes recurring signals, role-specific requirements, and limitations of the small sample.
- [x] TactiScout evidence is linked to authoritative code/docs/issue records; gaps are concrete and ranked by hiring value and feasibility.
- [x] The report recommends one next actionable issue that advances the portfolio without changing existing evidence boundaries.
- [x] Report links and formatting were reviewed.

## Answer

Reviewed six employer-owned job postings from Tencent, OpenAI, and Anthropic as of 2026-10-13. The repeated signals are complete task delivery, evaluation-led iteration, harness/runtime engineering, reliability and security, cost/latency awareness, and product judgment. The sample is purposive and small; senior distributed-runtime requirements are role-specific and should not be copied into this single-user portfolio without a concrete need.

The highest-value gap remains real human judgments of shortlist quality. Existing frozen packets and the `/review` and `/adjudicate` flows are ready, but real independent reviews are still absent. Continue issue [168](168-collect-independent-one-on-one-review-labels.md) as a human-owned task; preserve `not_evaluable` until the required judgments and adjudication exist. The report does not claim ranking quality or broad market representativeness.

See [Agent Engineer hiring signal review](../research/agent-engineer-hiring-signal-review-2026-10-13.md) for employer links, per-role evidence, project mapping, limitations, and the recommended next step.
