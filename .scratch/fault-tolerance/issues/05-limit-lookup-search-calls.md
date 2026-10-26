# 05: Bound search tool execution in each lookup turn

**What to build:** A scout's lookup can execute search at most three times in one user turn; if the model asks for more work, the graph stops clearly before another execution and retains useful completed source data.

**Blocked by:** None (can start immediately).

**Status:** resolved
**Labels:** ready-for-agent

- [ ] Enforce a maximum of three actual search tool executions per user turn at the graph/tool-dispatch boundary. The guard acts before a fourth execution, rather than relying on the graph-wide recursion limit.
- [ ] Count each individual search call, including calls batched into one model response and failed executions. A batch that exceeds the remaining allowance reaches explicit limit handling before excess calls execute; AI/tool message relationships remain valid and omitted work is not silently presented as successful.
- [ ] Model transport retries and human clarification waiting are not search tool executions and do not consume this allowance. Do not replace the independent model-request retry budget with the tool counter.
- [ ] Retry, native checkpoint recovery within the running process, and Command resume do not reset the same turn's already consumed tool allowance. A genuinely new user message starts a fresh allowance.
- [ ] Counters and limit behavior remain isolated by thread/turn, with no process-global mutable allowance shared across conversations.
- [ ] Every permitted search remains pinned to identity-resolved source IDs. Loop-limit handling never changes player identity, merges same-named records, switches data source, or silently removes conditions.
- [ ] Reaching the limit produces a deterministic, explicit limit outcome/reply, without an unbounded extra model call to explain the failure or a false normal-success result.
- [ ] Useful successful search results already obtained in the turn remain available as Active lookup and Conversation player focus even if the graph stops before a further explanatory model call. Existing successful comparison/recommendation contexts are not erased.
- [ ] Recognized failed tool execution counts toward the cap; an unexpected programming error or caller/control-flow cancellation still propagates and is not swallowed by limit handling.
- [ ] Emit a safe local exhaustion event with node, available run/thread IDs, execution count, category, and duration, without logging prompts, tool arguments/source records, raw results, credentials, or full State.
- [ ] Full-graph tests cover repeated calls, multiple calls in one model response, failed executions, no fourth dispatch, a new-turn reset, same-turn interrupt/resume, thread isolation, exact source-ID pinning, useful-result retention, clear user output, and log redaction. Use the approved graph seam rather than private counter/helper tests.
- [ ] The slice is verifiable with the existing model and tool injection points and does not require 02; shared-file coordination is not a blocking dependency.
