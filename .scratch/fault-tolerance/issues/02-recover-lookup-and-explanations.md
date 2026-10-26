# 02: Recover lookup and final explanation model failures

**What to build:** A scout can recover from temporary model outages during lookup, lookup follow-up, comparison explanation, player recommendation explanation, and team recommendation explanation; if recovery fails, the agent clearly reports it while retaining the newest completed data result.

**Blocked by:** 01: Safely recover request understanding.

**Status:** resolved
**Labels:** ready-for-agent

- [ ] Reuse the proven model-request configuration, physical-request accounting, safe failure contract, and local logging from 01 at every remaining model boundary: lookup model steps, lookup follow-ups, and final explanations for comparison, player recommendation, and team-directed recommendation.
- [ ] Each logical model activation has at most three physical requests and a 60-second limit per request. Recognized network/server failures and eligible short rate limits follow the shared policy; permanent errors, caller cancellation, and programming errors do not receive inappropriate retries.
- [ ] Keep a later legitimate model step in the lookup Agent loop distinct from a retry of the current step. Separate activations and threads do not inherit exhausted budgets; no uncounted SDK retry layer is enabled.
- [ ] Retrying a model call does not rerun identity resolution, completed search/comparison/ranking tools, or roster acquisition. Confirmed source IDs, effective filters, selected team, and mappings stay unchanged.
- [ ] A successful lookup tool response remains available as Active lookup and Conversation player focus even if the next lookup-model call fails before producing explanatory text. Commit completed source data independently of the following model invocation.
- [ ] If final explanation fails after a successful comparison or recommendation, preserve the newly completed Active comparison, Active recommendation, or Active team recommendation, including a completed empty result. Do not roll back the run to an older business result.
- [ ] After a known external failure is exhausted, produce a deterministic failure reply without calling the failing model again or claiming that an explanation succeeded. Preserve completed structured results for a later follow-up.
- [ ] Propagate attempt/caller cancellation to model calls, stop retries after caller abort, and prevent late model responses from appending messages or replacing current State.
- [ ] Human clarification continues through interrupt and Command resume without consuming a model retry budget while waiting. Unexpected model-wrapper/programming exceptions still reject the run.
- [ ] Emit safe retry, timeout, and exhaustion metadata with the same redaction and correlation contract as 01; no raw prompts, source records, roster data, model output, or credentials enter logs or fault State.
- [ ] Full-graph fake-model tests cover lookup, saved-result follow-up, comparison, player recommendation, and team-directed recommendation. Assert bounded requests, source/identity stability, cancellation, deterministic failure replies, no duplicate data calls, preservation of the newest successful result, thread isolation, and sanitized logs.
- [ ] The work delivers model failure recovery only; the independent search-execution limit remains owned by 05, and free-text factual correctness validation remains out of scope.
