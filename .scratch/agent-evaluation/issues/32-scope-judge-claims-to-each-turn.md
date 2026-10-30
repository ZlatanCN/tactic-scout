# 32 · Scope judge claims to each turn

**What to build:** The semantic judge evaluates a response against that turn's participant set, evidence, actions, and saved-result state. Participants added later must not retroactively invalidate an earlier response.

**Blocked by:** None.

**Status:** resolved

## Answer

Judge input now includes each turn's user-mentioned and resolved participants, their selected provider source IDs, identity-record competition/season metadata, clarification answers, post-resume resolution status, and exact action inputs. Prompt v14 scopes claims such as “all participants” to that turn, uses inputs from actual tool events to review filter claims, and forbids treating model-requested arguments as proof that a tool ran. Offline regressions cover participant/source mappings, tool inputs, and identity confirmation after Command resume. V10, V11, and V13 results are recorded in issues 36, 40, and 41; v14 calibration is tracked in issue 42.
