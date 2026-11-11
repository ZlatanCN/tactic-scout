# Test organization

Tests are organized around observable behavior and the public seam that owns it:

- `application/` exercises compiled graph workflows through invocation, saved state, and native clarification resume.
- `runtime-context/` covers input budgets, compaction, and evidence selection or batching.
- `persistence/` verifies public managed Dev Server behavior across checkpoints and restarts.
- `domain/` checks deterministic identity, result, data, and answer contracts.
- `providers/` checks provider adapters at their external data seams.
- `reliability/` checks retries, timeouts, cancellation, and failure reporting.
- `evaluation/` separates evaluation infrastructure and judge behavior from versioned case-pack contracts.
- `fixtures/` holds reusable domain data, model profiles, and boundary adapters.

Keep each test file centered on one contract. Split files when a case changes the behavior being verified, not just when a line-count threshold is reached. Keep reusable fixtures focused on data construction or a single external test seam; keep assertions in the contract test that owns them.

Use the compiled graph for workflow and runtime-context behavior. Use the managed Dev Server for persistence behavior. Avoid assertions against private node calls when a public graph state or outcome can show the behavior.

For mechanisms that claim to preserve coverage, completeness, recovery, or input cost, compare behavior at the same public seam. Boundary tests vary request size around a trigger. Ablation tests hold the source data fixed and remove one mechanism or budget grant. The core runtime-context counterfactuals are:

- Without a verified model window, request understanding does not call the model or read sources. A fitting request follows the ordinary path; a request above the soft trigger takes the compaction path.
- The full oversized instruction exceeds the model input budget; chunked extraction and merge complete the same request.
- A full saved lookup exceeds the soft input trigger; bounded evidence batches fit and reuse the saved result.
- A full comparison exceeds the hard input budget; adaptive participant batches fit. A batch response that omits its participants cannot complete the explanation. If one participant cannot fit, active time is exhausted, or one batch call is removed, the graph returns the complete validated result with an incomplete-explanation notice.

Keep expected values independent of implementation calculations. For persisted progress, exercise checkpoint restore through the public managed Dev Server API; for graph behavior, invoke or resume the compiled graph.
