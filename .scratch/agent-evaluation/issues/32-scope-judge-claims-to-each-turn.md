# 32 · Scope judge claims to each turn

**What to build:** The semantic judge evaluates a response against that turn's participant set, evidence, actions, and saved-result state. Participants added later must not retroactively invalidate an earlier response.

**Blocked by:** None.

**Status:** resolved

## Answer

Judge input now includes each turn's user-mentioned and resolved participants, their selected provider source IDs, identity-record competition/season metadata, and exact action inputs. Prompt v12 scopes claims such as “all participants” to that turn, uses action parameters to review filter claims, and forbids retroactive scope changes or treating identity-record scope as the requested query result. Offline regressions cover participant/source mappings and action parameters. V10 baseline and V11 smoke are recorded in issues 36 and 40; v12 calibration is tracked in issue 41.
