# 11: Align the ambiguous-profile case with the graph's clarification

**What to build:** The synthetic multi-profile recommendation case can resume the clarification the graph actually requests and reach the recommendation tool.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Make the case wording explicit that `Synthetic Ambiguous` is the reference profile if that remains the intended contract.
- [x] Script the observed `fm_profile` clarification selecting `fm-amb-b`. If the intended workflow also needs a recommendation-role clarification, define a valid alternative path for each accepted order instead of requiring one exact node sequence.
- [x] Preserve the expected selected FM profile and ranking contract independently of the model's output.
- [x] Add an offline full-graph test asserting the clarification resumes, the ranking tool runs, and the report contains a visible final answer.

## Evidence

All three trials of `recommend-ambiguous-profile-synthetic-v1` interrupted with `clarificationKind: fm_profile`. The case only provided `recommendation_role` followed by `fm_profile`, and had no alternative path. The evaluation driver therefore recorded “The scripted clarification does not match the graph,” no assistant message, and no ranking action. These are fixture/driver failures; they do not establish that the ranking algorithm failed.

## Resolution

The prompt now explicitly asks to use `Synthetic Ambiguous` as a reference profile, and the script answers the observed `fm_profile` interrupt with `fm-amb-b`. The fake-gateway full-graph regression now resumes and invokes `recommend_player_candidates`; all selected-case checks pass. The original three baseline failures remain in the archived baseline report. No live model request was needed for this fixture correction.
