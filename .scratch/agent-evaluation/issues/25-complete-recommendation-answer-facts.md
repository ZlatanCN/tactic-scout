# 25: Complete recommendation answers with user-relevant candidate facts

**What to build:** Make recommendation answers complete and grounded: show every returned candidate with decision-relevant CA/PA, position rating, and distance; keep current-similarity and potential rankings separate; disclose missing PA and distinguish filter stages; state that team-position similarity is not tactical fit or transfer feasibility. Require only user-visible gold facts.

**Blocked by:** None.

**Status:** claimed
**Labels:** ready-for-agent

- [x] Make player and team recommendation answer instructions require every returned candidate row, including CA, PA, position rating, and the current-distance value.
- [x] For potential requests, report candidates with missing PA as unavailable and explain that they are excluded from the PA ranking, not judged low-potential.
- [x] Correct team recommendation gold contracts that require individual roster-member values used internally to compute a team mean; require the returned candidate facts instead.
- [x] Distinguish position-eligible profile counts from candidates remaining after age/CA/PA filters in empty-result explanations.
- [x] Define all filter-count stages separately from the final ranked lists and their result limit.
- [x] Explicitly state that team position-similarity rankings do not establish tactical fit or transfer feasibility.
- [x] Remove team-refine required facts for internal roster-member CA values that are not needed in the final answer.
- [x] Add graph-level tests at the injected model boundary for the answer instructions and structured candidate data.
- [x] Validate the 48-case pack.
- [x] Preserve the earlier four-case live smoke result as historical evidence.
- [x] Run the full offline suite after the latest prompt/contract corrections.
- [x] Review the final diff against project standards and this spec.

## Evidence

Baseline `dc3c8927-7426-490a-b99b-abd19231554c` reported 22 missing facts. Six came from two lookup trials without delivered evidence after a failed lookup. Ten were team-roster reference-profile CA/PA values that the answer does not need to recite to explain an equal-weight team mean. Six are user-relevant recommendation facts: one player recommendation omitted a returned current candidate, two youth trials omitted a candidate whose PA was missing, and all three team recommendation trials omitted a returned candidate PA.

The local recommendation contract says the current-similarity list contains name, age, position rating, CA, PA, distance, and feature differences; a potential list is separate and ordered by PA. The player and team prompts now require every returned current and potential candidate, make PA a context column rather than a ranking input, report PA-missing exclusions, explain filter stages accurately, and state the team-fit boundary. Gold contracts require returned candidate facts instead of internal roster-member CA/PA values. Four edited cases record their exposure and revised contracts in `priorTuningExposure`. The 48-case pack validates; typecheck and Ultracite pass, and all 137 Vitest tests pass.

Earlier live smoke `7c587ba5-f61c-4a1e-a32d-a6c0416fad32` used 44/75 requests (agent 8, calibration 32, judge 4) and passed its four cases. It predates the final filter-stage and team-suitability wording; the revised full development run is tracked separately in issue 26.

Revised baseline attempt `88ba4282-7042-4d27-9c1a-d3646358e5bc` completed all 96 agent trials using 394 requests and passed v8 calibration 16/16, but remained partial with two transport errors, one deterministic clarification failure, one invalid judge result, and five semantic failures. It exposed an inaccurate CA-empty explanation, two false omissions from team-reference values, and one missing team-suitability caveat; those contract and prompt issues are addressed here. The youth clarification mismatch, Mbappé source-ID claim, and invalid judge output remain separate findings.

The CA-empty case now pins `eligiblePositionProfiles=5` separately from `afterCurrentAbility=0`; the team-refine contract requires the returned candidates rather than CA values of internal roster members. The completed development run `da5005c7-f445-4ea0-bfb0-b8095dec47c3` confirmed complete candidate rows in the recommendation workflows, but one team-refine trial still confused `afterCurrentAbility`, `afterIdentityExclusion`, and `currentAttributeComplete`. A shared prompt fragment now defines every filter-count stage and states that result-limit lists are not stage counts. Its two graph-level prompt tests and the full offline suite pass. The live report predates this final shared-fragment edit; a targeted post-edit model smoke has not run.
