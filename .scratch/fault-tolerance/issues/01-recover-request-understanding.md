# 01: Safely recover request understanding

**What to build:** A scout's new request can recover from a temporary model failure or one malformed structured response, while an exhausted attempt produces a clear reply without executing the previous request or losing successful conversation context.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [ ] Use native LangGraph retry, timeout, and error-handler behavior at the request-understanding external boundary, following ADR-0008. Include only the minimal budget, safe-failure outcome, model-client configuration, and logging prefactoring needed to deliver this complete path; do not create a separate general retry engine.
- [ ] Recognized network/server failures may retry with bounded exponential backoff and jitter. One logical request-understanding activation makes at most three physical model requests, including the first call, transport retries, a short-rate-limit retry, and any structured-output repair.
- [ ] Disable redundant SDK/caller retries or prove they share the same request allowance. A real model client using fake HTTP transport demonstrates that the physical request count cannot silently exceed three.
- [ ] Classify known model authentication/configuration errors, provider insufficient-quota errors, and other permanent client failures as non-retryable. Agent-construction configuration failures remain clear startup failures without retries.
- [ ] A short 429 is retryable at most once only with a valid retry delay and evidence that daily quota remains. It consumes the shared three-request budget; missing/ambiguous evidence or exhausted quota causes no automatic retry. Waiting has an explicit finite bound: when the provider's required delay exceeds it, return a rate-limit outcome without retrying early or waiting indefinitely.
- [ ] Cap each physical model request at 60 seconds and propagate cancellation to the model client. Caller abort stops recovery immediately; expired or canceled responses cannot publish State updates.
- [ ] Recognized parsing/schema failures receive at most one additional physical request carrying the original message, confirmed context, output contract, and safe validation feedback. The repair consumes the existing allowance, never changes identities or invents a task, and is not a second retry budget.
- [ ] Any failure of the repair request, including a transport failure or another invalid output, terminates request understanding. Unused allowance does not restart extraction or send another repair request.
- [ ] Represent failure before a valid task has been extracted without fabricating a player-lookup/recommendation task kind. Route directly to a deterministic failure response without identity resolution, old-request execution, or downstream data calls.
- [ ] Preserve all successful active contexts, confirmed aliases, and mappings on failure. Budgets remain isolated by logical activation and thread, survive retry/repair transitions, and do not live in mutable process-global counters.
- [ ] Only recognized external/parser failures receive recovery. Unexpected programming exceptions and LangGraph control flow remain observable as exceptions; human interrupts and caller cancellation are not converted into ordinary provider failures.
- [ ] Emit structured local retry, repair, timeout, and terminal-failure events containing node, available run/thread IDs, attempt, safe category, and duration. Exclude prompts, model output bodies, credentials, full State, and raw provider payloads; a logger failure must not replace the original failure or trigger business retries.
- [ ] Tests use the approved compiled createAgent graph seam with the real request extractor and a controllable fake structured model. Cover transient success/exhaustion, network → malformed output → repair within three requests, malformed output → repair transport failure terminating after two requests, permanent errors, 429 limits including an excessive Retry-After that returns without waiting/retrying, 60-second cancellation, late responses, thread isolation, sanitized logs, and failure after a previous successful turn.
- [ ] Keep MemorySaver and existing successful task behavior; no persistent checkpointer, fallback model, planner, or final-answer factual evaluator is introduced.
