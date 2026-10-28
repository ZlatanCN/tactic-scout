# 17: Provide per-turn active-result state to the semantic judge

**What to build:** Claims that a previous result remains available are evaluated against the graph's actual per-turn conversation state, not only visible answer text and tool events.

**Blocked by:** None.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Record the kinds of completed results available after each scripted turn in evaluation-only observations.
- [x] Include those per-turn state observations in semantic-judge input and explain how to use them as evidence for preservation claims.
- [x] Add a public-runner test where a prior comparison remains active after the next comparison fails; the judge must not mark a true preservation statement unsupported.
- [x] Ensure a missing active result does not support a preservation claim.
- [x] Keep production graph state and live behavior unchanged.

## Evidence

Smoke run `949b845b-53d1-433f-981f-95758b55aa5a` completed a successful comparison before a later `data_unavailable` outcome. The graph retained the prior comparison, but the semantic judge lacked a direct per-turn state observation and marked “此前已完成的结果仍保留” as unsupported.

## Resolution

Evaluation-only turn observations now record the active result kinds present after each turn. The semantic judge receives this state evidence and uses it only to assess result-retention claims; a successful action by itself still does not prove that a result remains active. A fake-gateway public-runner regression covers the comparison failure after a completed comparison. No production State or graph behavior changed.

Anchor pack v6 also replaces one development example with a prior successful comparison followed by a claim of retention when the active-result state is empty; that claim is labeled unsupported. Its two saved-lookup validation examples now carry explicit active lookup state so correct reuse answers remain supported. The reserved v5 validation examples and labels must be rerun against the v6 judge prompt before semantic scores are trusted.
