# 16: Reconcile team roster coverage counts with resolution evidence

**What to investigate:** Establish one deterministic, source-grounded mapping count for the frozen Real Madrid roster and ensure the agent answer and judge receive the same count and provenance.

**Blocked by:** 09: Measure and archive the development baseline. The frozen team snapshot and all three trials are available.

**Status:** resolved
**Labels:** needs-triage

- [x] Recompute roster size, mapped FM profiles, and missing profiles directly from the captured roster and local FM/identity snapshot.
- [x] Compare the recomputed totals with `resolve_team_roster_identity` events and the assistant's reported `30/38 mapped, 8 without profiles`.
- [x] Determine whether the counts differ because the report uses Reep matches, usable local FM profiles, or only target-position-capable profiles; name the measure explicitly.
- [x] Add a deterministic check for the chosen count and pass a compact structured coverage summary to the answer/judge rather than relying on a language model to count a long event list.

## Evidence

The baseline showed different counts across the frozen preparation note, action events, and semantic judge explanations for Real Madrid. One judge output also used operation IDs as evidence IDs in this case, which is tracked separately in issue 14. Do not change the expected count until the snapshot and mapping rules are reconciled.

## Resolution

The frozen Real Madrid capture contains 38 roster members, 30 local FM profiles, and 30 Reep API-Football player bridges that each resolve to one unique local profile. The remaining eight roster members have no local FM profile; there are zero user-confirmed mappings and zero pending confirmations. All three trial action logs agree with 30 `resolved` and eight `no_profile` results, which matches the prior agent answer. The semantic judge's inconsistent totals came from counting the long per-member event list rather than the returned mapping results. Five mapped profiles meet the STC rating threshold of 15; that is a separate position-capability measure, not the roster-mapping count. The API-Football roster was captured on 2026-10-27; the FM snapshot date is 2025-11-23.

The code now computes one `teamRosterCoverage` summary from resolved roster state, names the mapping measure explicitly in the assistant response, provides the same count and mapping-method provenance to the semantic judge, and checks the summary against the case contract. A synthetic fake-gateway regression verifies that the answer, deterministic check, and judge input share the same coverage. The Real Madrid case declares its frozen expected coverage of 30/38. Baseline artifacts remain unchanged; no live API or model call was needed.
