# 03: Recover API-Football team searches

**What to build:** A scout's selected-team search survives temporary API-Football failures within a predictable request/time budget, while quota, configuration, and invalid-data failures receive an immediate clear outcome without replacing a successful team recommendation.

**Blocked by:** None (can start immediately).

**Status:** resolved
**Labels:** ready-for-human

- [ ] Deliver the complete team-name → API-Football search → unique selection, clarification, or safe failure path. Include the minimal API error/attempt/cancellation/logging contract required by that path; do not publish an infrastructure-only slice.
- [ ] Preserve safe HTTP status, provider error code, retry delay, and quota evidence so recognized transport/server errors, short throttling, exhausted quota, authentication/configuration errors, and invalid responses are distinguishable.
- [ ] Throw only tagged transient API failures into native LangGraph retry policies. Keep permanent provider failures and valid domain outcomes as structured results. Unexpected programming errors and caller/control-flow cancellation propagate.
- [ ] Make at most three physical HTTP requests per logical team-search activation, including the initial request and all retries. Use bounded exponential backoff and jitter; retries do not reset request accounting or leak budgets between threads.
- [ ] A short 429 may cause at most one retry only when a valid Retry-After and remaining daily quota are known. Count it within the same three-request limit. Missing/invalid evidence, exhausted quota, and insufficient-quota provider codes do not retry; never retry before the required delay or wait without a configured bound.
- [ ] Handle retry delays expressed as supported delta-seconds or HTTP dates using a controlled clock. Repeated throttling stops after its single allowed retry even when another general attempt slot remains.
- [ ] Cap each HTTP request attempt at 15 seconds, pass the attempt/caller AbortSignal to the transport, stop retries on caller abort, and ignore responses arriving after cancellation/expiry.
- [ ] Missing API credentials make no HTTP request. Authentication/client errors, malformed JSON, and schema-invalid responses do not masquerade as transient network failures or retry. A valid empty team search remains a not-found outcome rather than a provider fault.
- [ ] Preserve existing identity rules: a unique direct search may select automatically, translated search names require confirmation, and ambiguous teams are presented with country context. Recovery does not silently replace the original team mention, selected provider ID, or prior successful Active team recommendation.
- [ ] Exhausted known external failures pass through a typed, state-first error handler to a safe task failure response. They do not overwrite successful active contexts, and unclassified bugs do not become generic provider outcomes.
- [ ] Emit structured local retry/timeout/exhaustion events with node, available run/thread IDs, attempt, safe category, and duration, without API keys, authorization headers, raw provider bodies, team/roster payloads, prompts, or full State. Logging failure does not replace the business failure.
- [ ] Tests use the existing API client fake-fetch/clock seam and the compiled createAgent graph seam. Cover ordinary recovery, exact request caps, network → short 429 → server failure, repeated short 429, quota exhaustion, invalid credentials/payloads, 15-second timeout, caller abort, late responses, translated/ambiguous selection, context preservation, thread isolation, unexpected bugs, and log redaction without real API quota.
- [ ] Native policies are explicit on the relevant boundary; no blanket retry policy is applied to local ranking or human clarification. The public API client contract remains usable for current-squad adoption in 04.
