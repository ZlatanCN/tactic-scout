# 32 · Scope judge claims to each turn

**What to build:** The semantic judge evaluates a response against that turn's participant set, evidence, actions, and saved-result state. Participants added later must not retroactively invalidate an earlier response.

**Blocked by:** None.

**Status:** resolved

## Answer

Judge input now includes each turn's user-mentioned and resolved participants, their selected provider source IDs and canonical identity IDs, identity-record competition/season metadata, clarification answers, post-resume resolution status, exact tool inputs, and per-turn outcome status. Prompt v15 uses actual tool event inputs, resume confirmation, season semantics, and business field mappings to review claims. Offline regressions cover participant/source mappings, tool inputs, identity confirmation after Command resume, and distinct-identity comparison outcomes. V10, V11, V13, and V14 results are recorded in issues 36, 40–42; v15 calibration is tracked in issue 49.
