# 13: Only claim prior results were preserved when one exists

**What to build:** Fault responses accurately distinguish a fresh thread with no completed result from a refinement that must preserve an earlier successful result.

**Blocked by:** 09: Measure and archive the development baseline. The baseline contains repeated unsupported claims from fallback responses.

**Status:** resolved
**Labels:** ready-for-agent

- [x] In a fresh thread with no saved lookup/comparison/recommendation, do not say an earlier result remains preserved.
- [x] In a thread with a completed result, keep the accepted behavior that a failed new request does not overwrite that result.
- [x] Ensure process claims (“this request was not executed”, “the previous result remains”) match actual node/tool events and thread state.
- [x] Add tests for both fresh-thread and existing-result failure paths.

## Evidence

The development report includes multiple `lookup-identity-unavailable` and multi-turn comparison failures whose assistant response said “之前完成的结果仍然保留” despite no completed result in the thread. The semantic judge correctly counted these unsupported or false-execution claims.

## Resolution

Fallback answers now add a preservation claim only when the thread contains a committed lookup, comparison, player recommendation, or team recommendation. Identity-data failures state that dependent work did not run; data-source failures state that the query or calculation was attempted but did not complete. If the lookup search already completed before explanation failed, the answer says that result is saved and can still be followed up.

The graph tests cover a fresh thread with unavailable identity data, identity failure after a saved lookup, model retry exhaustion with a saved lookup, and a data-source failure after searches ran. Request-extraction tests cover fresh-thread network, timeout, quota, and rate-limit failures. No real model call was needed.
