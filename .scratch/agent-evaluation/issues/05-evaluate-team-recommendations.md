# 05: Evaluate frozen-roster team recommendations

**What to build:** The maintainer can evaluate a complete team-directed recommendation against a fixed squad snapshot, including team selection, FM identity mapping, native confirmations, actual ranking, and exact squad exclusion.

**Blocked by:** 02: Evaluate lookup conversations and execution evidence. This provides the scripted clarification driver and action/evidence observation needed for team and roster confirmations.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Deliver 12 team-recommendation cases: four ordinary, four boundary/adversarial, and four multi-turn. Preserve the agreed eight-development/four-held-out distribution, origins, scenario grouping, and tuning provenance.
- [x] Confirm reusable real team/squad snapshots during preparation. If capture is necessary, estimate and explicitly bound source requests in this ticket, honor provider errors/quotas, and record exact retrieval/source provenance. Missing credentials/evidence is a preparation problem rather than permission to fabricate real source data.
- [x] Keep source-capture accounting distinct from model-request accounting. Do not defer the capture allowance until the final baseline ticket or create an implicit dependency cycle.
- [x] Freeze team/squad HTTP payloads, team and provider-player IDs, retrieval dates, relevant Reep bridges, FM profiles/positions/aliases, and expected candidate pool. Label constructed or modified roster evidence.
- [x] Run the real API-Football adapter over prepared HTTP responses and an explicit case-local clock/client. A trial never falls back to the live API or the full local corpus; distinguish unexpected fixture coverage from an out-of-contract agent request.
- [x] Exercise real team resolution, translated-name confirmation, ambiguous teams, position clarification, and exact provider-team selection through the normal graph.
- [x] Run actual roster-to-FM mapping via Reep bridges or scripted explicit confirmation. Preserve resolved members across sequential interrupts, avoid name-only identity guesses, and stop before ranking an unresolved/partial roster as required.
- [x] Cover a missing local profile, unavailable identity data, empty squad, and no eligible position reference, including native alternative-position or named-reference clarification where required.
- [x] Verify actual team-position reference computation, position eligibility, filters, separate potential handling, and exact exclusion of every mapped roster FM identity. Golden arithmetic and exclusion expectations must be independently established.
- [x] Preserve the distinction between squad retrieval date and FM snapshot date in observed evidence and required-answer contracts.
- [x] Verify in-trial successful roster cache reuse during confirmations/refinements and independent provider/client/cache state between trials. A cache hit or mapping operation must not be described as a fresh provider retrieval.
- [x] Include team changes and condition refinements, appropriate state inheritance/reset, and failure preservation of the previous Active team recommendation.
- [x] Record provider acquisition attempts/outcomes, mapping/confirmation evidence, direct ranking-tool execution, effective filters/exclusions, and the evidence actually delivered for explanation.
- [x] Produce per-case code findings and reports for the complete synthetic path, maintaining the accepted ability-profile scope rather than inferring transfer feasibility or tactical fit.
- [x] Test through the public evaluation entry using fake gateway HTTP, fixed API HTTP payloads, and real local mapping/ranking readers. Verify native resumes, no live fallback, dates, incomplete-roster stopping, and squad exclusion without paid calls.

## Comments

- Captured Real Madrid (API-Football team 541) and Bayer Leverkusen (team 168) with the approved four-request allowance. Their frozen current squads contain 8/38 and 5/30 members with no local FM profile, so the real-source cases verify the agreed safe-stop behavior. Synthetic complete-roster cases exercise successful ranking, potential ordering, and exact squad exclusion through the real algorithm.
- The raw capture and real evidence bundles remain local under ignored `.data/evals/`; versioned cases record their hashes and source IDs.
