# 25: Complete recommendation answers with user-relevant candidate facts

**What to build:** Ensure recommendation answers include all returned candidates and their decision-relevant CA/PA values, while keeping current-similarity and potential rankings separate. Make the gold contracts require only facts relevant to the user-visible answer.

**Blocked by:** None.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Make player and team recommendation answer instructions require every returned candidate row, including CA, PA, position rating, and the current-distance value.
- [x] For potential requests, report candidates with missing PA as unavailable and explain that they are excluded from the PA ranking, not judged low-potential.
- [x] Correct team recommendation gold contracts that require individual roster-member values used internally to compute a team mean; require the returned candidate facts instead.
- [x] Add graph-level tests at the injected model boundary for the answer instructions and structured candidate data.
- [x] Validate the 48-case pack.
- [x] Run the full offline suite.
- [x] Review the code and ticket against project standards and this spec.

## Evidence

Baseline `dc3c8927-7426-490a-b99b-abd19231554c` reported 22 missing facts. Six came from two lookup trials without delivered evidence after a failed lookup. Ten were team-roster reference-profile CA/PA values that the answer does not need to recite to explain an equal-weight team mean. Six are user-relevant recommendation facts: one player recommendation omitted a returned current candidate, two youth trials omitted a candidate whose PA was missing, and all three team recommendation trials omitted a returned candidate PA.

The local recommendation contract says the current-similarity list contains name, age, position rating, CA, PA, distance, and feature differences; a potential list is separate and ordered by PA. The player and team prompts now require every returned current and potential candidate, and make PA a context column rather than a ranking input. Potential requests explicitly report PA-missing exclusions. Team case gold now checks candidate rows, not each internal roster member's CA/PA. The four edited cases record the baseline exposure and revised contracts in `priorTuningExposure`. The 48-case inventory is ready; typecheck, Ultracite, and all 137 Vitest tests pass. A targeted live-model smoke remains pending a separately authorized request cap.
