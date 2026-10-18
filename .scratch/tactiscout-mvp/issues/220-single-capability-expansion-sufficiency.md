# 220 — Evaluate expansion sufficiency for one requested capability

Type: research
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Question

Should the investigation stop calling the expansion Planner when the user requests only one measurable capability and at least three independent candidates already have direct evidence for it?

## Evidence

- In issue 219's real Qwen 3.5 9B run, the request explicitly asked for a left-back with ball-playing ability.
- The graph identified one requested measurable area: `后场出球`. Eight of 20 evaluated records had its ability evidence, and the report returned three leads.
- Before this change, `expansionEvidenceIsSufficient()` required at least two measurable areas, so the graph called the expansion Planner.
- The Planner request had a 6,108-character context and timed out at the configured 60 seconds without token usage. The bounded fallback then returned a report from the existing evidence.

This establishes a long-tail wait for this case, but it does not establish that earlier stopping preserves shortlist quality. Expanding the sample could find stronger candidates.

## Decision criterion

For ordinary `expand`, evidence is sufficient when every requested capability area is measurable and at least three independently identified candidates each have direct evidence for every requested measurable area. If any requested area is unmeasurable, or fewer than three independent candidates jointly cover all measurable areas, the expansion Planner still runs. This creates a limited evidence-backed shortlist; it does not claim the search pool is complete or the ranking is optimal.

## Paired full-graph evaluation

Three interleaved pairs used the same custom English left-back request, Understat snapshot, local Qwen 3.5 9B model, LangGraph, tools, policies, Reviewer, and budgets. The only changed factor was whether the graph applied the sufficiency rule before calling the expansion Planner.

| Measure | Rule enabled | Rule bypassed |
| --- | ---: | ---: |
| Harness checks | 3/3 runs passed | 3/3 runs passed |
| Median end-to-end time | 35.072 s | 78.674 s |
| p95 end-to-end time | 36.059 s | 91.222 s |
| Mean Planner expansion calls | 0 | 1 per run |
| Expansion Planner outcomes | deterministic finish in 3/3 | 2 model responses, 1 timeout fallback |
| Recommendations / evidence references | 3 / 3 each run | 3 / 3 each run |
| Same recommendation identity and evidence order within pairs | 3/3 pairs | 3/3 pairs |

The rule reduced median time by 43.602 seconds (55.4%) in this fixed case, while recommendation identity order and evidence order stayed identical in all three pairs. All six runs passed the registered behavior checks. The evidence supports this narrow latency and control-flow change; it does not establish general ranking quality, market completeness, transfer suitability, or that early stopping is always preferable. No independent blind scout labels were available. Raw output is in the Git-ignored `.data/evaluations/issue-220-single-capability-expansion-ablation-20261018.json`.

## Acceptance

- [x] Define a narrow evidence threshold: all requested capabilities measurable, and at least three independent candidates directly evidence all of them.
- [x] Compare enabled and bypassed behavior in three paired full-graph runs on the same frozen case.
- [x] Preserve the same recommendation identity/evidence order across every pair, without interpreting this as a general ranking-quality result.
- [x] Implement the deterministic policy and retain a pure-function threshold test plus a full-graph regression test.
- [x] Ensure trace attribution reports deterministic policy decisions as policy decisions.
- [x] Full test suite (661/661), API build, Web build, and `git diff --check` pass.

## Comments

- 2026-10-18: Identified while verifying issue 219. The first implementation attempt was held at the pure function and full-graph seams until the threshold and acceptance boundary were defined.
- 2026-10-18: Implemented the bounded one-capability threshold after the three paired full-graph run showed 3/3 identical recommendation identity/evidence order and a 55.4% median-latency reduction. This is a fixed-case mechanism result, not a quality claim.
