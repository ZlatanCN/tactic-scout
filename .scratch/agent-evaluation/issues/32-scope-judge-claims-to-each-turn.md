# 32 · Scope judge claims to each turn

**What to build:** The semantic judge evaluates a response against that turn's participant set, evidence, actions, and saved-result state. Participants added later must not retroactively invalidate an earlier response.

**Blocked by:** None.

**Status:** resolved

## Answer

Judge input now includes each turn's user-mentioned and resolved participants. Prompt v10 explicitly scopes claims such as “all participants” to that turn and forbids retroactive use of later turns. An offline regression reproduces the two-participant comparison followed by a third-player addition and verifies the distinct per-turn participant sets. Real-model v10 calibration is tracked separately in issue 36.
