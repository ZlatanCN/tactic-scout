# 02: Evaluate lookup conversations and execution evidence

**What to build:** The maintainer can evaluate complete lookup conversations, including identity clarification and saved-result follow-ups, and inspect reliable evidence of what the agent requested, attempted, completed, blocked, or reused.

**Blocked by:** 01: Run a bounded player-lookup evaluation trial.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Extend the public evaluation entry with scripted user turns and native interrupt/Command resume. One trial retains its own thread and state across turns; unrelated trials remain isolated.
- [x] Deliver the 12 player-lookup cases and their independent contracts: four ordinary, four boundary/adversarial, and four multi-turn cases. Assign three ordinary, three boundary, and two multi-turn cases to development, with the remaining one ordinary, one boundary, and two multi-turn cases held out.
- [x] Cover Chinese names/aliases, repeated confirmed mentions, canonical cross-source identities, similarly named unlinked records, genuine ambiguity, missing facts, saved-result follow-ups, and explicit refresh requests. Derive source/identity expectations from the frozen records and bridges.
- [x] User scripts supply only predeclared information and select the declared identity from actual candidates. Permit contract-declared alternative clarification order; missing candidates, unexpected clarification kinds, or exceeded script bounds are findings rather than opportunities for the harness to repair the agent.
- [x] Complete the common observation contract for model-requested calls, attempted invocations, guard-blocked dispatch, schema rejection, returned results, business success, unavailable results, valid not-found/empty results, thrown failures, cache hits, and saved-result reuse.
- [x] Observe the real tool/identity/team-data boundaries without replacing their algorithms. The common observer must accommodate tools called directly by deterministic nodes as well as ToolNode lookup calls; it must not infer execution solely from AIMessage tool calls or tool-end callbacks.
- [x] Associate observations with case/trial/turn/operation, exact source identities, effective conditions, outcome/evidence references, and timing. Distinguish identity candidate lookup from a completed player-profile lookup.
- [x] Record which evidence was actually supplied to each model step and which saved result was legitimately reused. The entire fixture corpus and hidden expected facts cannot be supplied as a substitute for observed evidence.
- [x] Verify that source IDs remain pinned to the confirmed identity, source scopes are retained, lookup calls remain bounded, and condition/context changes follow the case contract.
- [x] Verify state and evidence continuity after clarification, appropriate updates for successful empty results, and preservation of earlier successful context after a declared source-data failure.
- [x] Allow intentionally missing/corrupt source fixtures to reach the actual failure path when declared; reject undeclared preparation faults before dispatch. Never convert a failed or unavailable action into a fabricated success/empty result.
- [x] Show actual execution and reuse references in per-trial reports so the semantic judge can later check fresh-search, provider-coverage, and success claims. Leave unresolved action evidence explicitly incomplete.
- [x] Keep fixture provenance, scenario-family grouping, prior tuning exposure, independent expected facts, and split assignments with each case for final benchmark freezing.
- [x] Use the approved public-entry/real-graph seam to test conversations, native resumes, legal route differences, blocked/schema-invalid/failed/unavailable/empty/success states, fresh-process isolation, source-ID binding, and saved-result reuse with fake gateway HTTP.
