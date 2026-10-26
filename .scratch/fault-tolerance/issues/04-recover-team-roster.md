# 04: Recover current-roster acquisition and resume identity confirmation

**What to build:** After a scout selects a team, its current roster can recover from temporary provider failure, remain safely cached, and continue the same FM identity confirmation workflow without duplicate fetches or ranking an incomplete roster.

**Blocked by:** 03: Recover API-Football team searches.

**Status:** resolved
**Labels:** ready-for-human

- [ ] Apply the API error evidence, native recovery, physical-request accounting, and cancellation contract established in 03 to current-squad acquisition and its graph task boundary.
- [ ] Each logical roster-fetch activation makes at most three physical requests, each capped at 15 seconds. Network/server failures use bounded backoff and jitter; eligible short 429 recovery happens at most once within the same budget. Permanent/configuration/quota/bad-data failures do not retry.
- [ ] Retry only the provider acquisition failure. Local Reep/FM mapping, missing profiles, unsupported positions, and other deterministic domain outcomes are not rerun as network recovery merely because they share a task node.
- [ ] Preserve successful roster caching for seven days. A cache hit consumes no outbound request allowance; failed responses and responses arriving after abort/expiry never populate or refresh the successful cache.
- [ ] A valid GET that completed and populated the cache before a later local mapping failure may remain cached. Do not claim that node/checkpoint rollback undoes an already valid external read or its prior cache insertion.
- [ ] Propagate caller/attempt cancellation to the HTTP client, stop subsequent retries, and prevent canceled or late work from updating the current request, mappings, or successful context.
- [ ] A successful normalized roster retains its selected team identity, provider player IDs, broad positions, and retrieval timestamp. Recovery does not change which squad or FM source records the scout selected.
- [ ] Human confirmations retain all prior resolved roster mappings and continue through interrupt/Command resume. Human waiting is not a timed external call, consumes no retry/tool allowance, and does not cause another provider fetch while the successful cache is valid.
- [ ] A known provider failure or unmapped roster member stops recommendation before ranking. Preserve the previous Active team recommendation and any current confirmed mappings; never rank a partial roster or weaken squad exclusion rules.
- [ ] Known local identity/data failures retain a clear non-retried outcome, while unexpected errors from the roster-mapping boundary propagate instead of being hidden by a broad catch. Human interrupts are never handled as external errors.
- [ ] Error handlers return the existing safe outcome/failure route after known provider recovery is exhausted, without changing successful active contexts or calling a model to generate an error explanation.
- [ ] Emit safe local retry, timeout, and terminal-failure metadata using the shared provider logging contract; do not log the raw roster, names/source records, credentials, prompt, or full State.
- [ ] Graph and API-client tests cover transient recovery/exhaustion, mixed request budgets, seven-day hits/expiry, no failed/late cache insertion, prior valid cache preservation after a later local error, several sequential roster confirmations without refetch, no-profile stopping, caller abort, thread isolation, source-date preservation, and sanitized logs using deterministic fakes.
- [ ] Keep MemorySaver and the existing read-only workflow; no durable database, new roster source, Saga, or ranking-formula change is introduced.
