# Return shortlist leads when relevant evidence was observed

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the LangGraph final decision produce useful follow-up scouting leads when candidates were evaluated and direct evidence exists for the requested abilities, while keeping every lead constrained to measured evidence.

## Context

A real ASA run evaluated three winger candidates; all three had observed goal output and chance-creation metrics, and the report correctly showed 3/3 coverage for both. The Qwen Planner nevertheless returned an empty shortlist. Reviewer retried once, then erased the recommendation after a second citation failure. Harness checks currently allow an empty recommendation list even when directly requested evidence is observed, so this usability regression passed silently.

## Acceptance criteria

- [x] Conclusion schema requires at least one evaluated lead when directly relevant requested evidence exists, and only exposes relevant evidence keys for those leads.
- [x] Conclusion instructions frame the list as leads for human follow-up, not a claim of objective ranking accuracy; an empty list remains valid when no relevant evidence/candidate exists.
- [x] Reviewer still checks the recommendation against each requested capability and fails closed for malformed or unrelated evidence.
- [x] Harness can require a non-empty lead when observed requested evidence makes one actionable, while leaving ranking accuracy unclaimed.
- [x] Deterministic tests cover required/optional recommendation behavior, evidence key restrictions, and the new Harness invariant.
- [x] Full tests, API/Web builds, and a real ASA multi-turn run pass; report contains at least one evidence-backed follow-up lead.

## Comments

- 2026-10-06: Current real-run artifact is `/private/tmp/tactiscout-asa78-e2e.json` (not committed). All 14 behavior checks passed, but recommendations were empty despite goal and chance-creation coverage being observed for 3/3 evaluated players. This is a usability failure separate from ranking accuracy.
- 2026-10-06: Wired deterministic evidence-reference alignment into LangGraph Reviewer. It repairs only citations to directly requested metrics already observed for a model-selected candidate; normal evidence review still runs afterward. Full suite passed 226/226; API and Web builds passed.
- 2026-10-06: Real ASA/Qwen multi-turn artifact `/private/tmp/tactiscout-asa79-final.json` (not committed) passed all 15 Harness checks in 99.5 seconds. The case paused for position clarification, resumed the same case, evaluated three candidates, reported 3/3 coverage for goals and chance creation, and returned one winger lead citing `asaExpectedAssistsPer90` and `goals`. This validates the behavior chain, not recommendation ranking accuracy; the ASA pool is current MLS performance data, not a global transfer market, and no licensed player-report excerpt was retrieved.

## Answer

The final-decision schema requires a follow-up lead when evaluated candidates have directly relevant observed evidence, and restricts evidence choices to those measures. The LangGraph Reviewer aligns malformed citations only to the same candidate's available requested metrics, then validates the conclusion normally. Empty recommendations remain valid when no relevant evidence is observed. Full tests, API/Web builds, and the real ASA multi-turn Qwen Harness passed; no claim is made about ranking accuracy.
