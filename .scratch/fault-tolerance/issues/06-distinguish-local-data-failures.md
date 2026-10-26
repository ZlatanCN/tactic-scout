# 06: Distinguish local data failures from programming errors

**What to build:** A scout receives clear non-retried outcomes for recognized missing or corrupt local football data across identity, lookup, comparison, and FM recommendation workflows, while an actual programming bug remains visible to the maintainer rather than being disguised as a provider or tool failure.

**Blocked by:** None (can start immediately).

**Status:** resolved
**Labels:** ready-for-human

- [ ] Audit the current local identity/source-reading, comparison, player recommendation, team-ranking, and related graph/tool failure boundaries as one scoped behavior change. Perform only the classification/prefactoring required to distinguish recognized data-boundary failures from bugs.
- [ ] Recognized missing/unreadable/corrupt SQLite snapshots and provider-payload parsing/schema failures produce explicit safe data-unavailable outcomes where applicable. Preserve the distinction between unavailable data and a valid search with no matching record.
- [ ] Valid not-found responses, completed empty comparisons/candidate lists, unsupported filters/positions, unresolved player identity, missing FM profiles, and no qualifying team-position reference keep their existing domain meaning rather than becoming transient errors.
- [ ] Local deterministic operations do not gain automatic network-style retries, an LLM repair call, a substitute source/model, weaker hard conditions, or Saga compensation.
- [ ] Catch only identified I/O, parser/schema, and data-boundary failures. Unclassified TypeError, violated invariants, and other programming errors propagate to run rejection instead of becoming tool_error, provider_error, identity_error, or empty data by default.
- [ ] Apply the same distinction to built-in tool execution behavior: ToolNode/default wrappers do not swallow unexpected bugs, caller cancellation, or LangGraph control-flow exceptions into ordinary tool-result messages.
- [ ] Known failures do not replace Active lookup, Active comparison, Active recommendation, Active team recommendation, confirmed aliases, or mappings. A successfully completed empty business result still updates its active context normally.
- [ ] Team identity/mapping failure continues to stop before ranking an incomplete Team roster snapshot; comparison scope rules and all existing FM ranking/eligibility semantics remain unchanged.
- [ ] Human identity, FM-profile, team, position, age, role, and season clarifications remain interrupt/Command control flow. Waiting or resuming does not trigger data retries, error fallback, or unintended duplicate tool execution.
- [ ] Failure outcomes avoid unfiltered raw exception/provider/SQLite payloads. Safe local terminal-failure logs contain node, available run/thread IDs, attempt/category, and duration, without prompt, source records, raw roster, credentials, or full State; logging failure does not mask the original problem.
- [ ] Test through complete graph invocations with isolated MemorySaver, fake data tools/identity lookups, and temporary local fixtures where needed. Cover recognized unavailable/malformed data versus genuine not-found/empty data, preservation of prior successful contexts, successful empty-result commits, injected unexpected errors in all four workflows, ToolNode transparency, and interrupt/resume without extra retries.
- [ ] Tests observe user replies, outcome category, saved context, actual call counts, rejection, and sanitized log output through approved public seams; they do not test private catch/classification helpers.
- [ ] Keep the local/private, MemorySaver-only recovery scope and avoid a general codebase refactor, dependency upgrade, persistent checkpointer, or new telemetry service.
