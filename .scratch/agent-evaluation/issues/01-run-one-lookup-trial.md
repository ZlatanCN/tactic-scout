# 01: Run a bounded player-lookup evaluation trial

**What to build:** The maintainer can preview and run one player-lookup Scouting evaluation trial through the real agent, inspect actual evidence and behavior, and receive a local report under an explicitly enforced gateway-request allowance.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Deliver one public evaluation entry shared with the CLI and approved integration-test seam. Make the minimum preparation changes necessary for this complete path; avoid an infrastructure-only framework or production graph refactor.
- [x] Run the real compiled createAgent graph, normal request extractor, identity resolver, source readers, and lookup tool over a small versioned real-format fixture. Do not inject an extracted request, resolved identity, or prerecorded tool result as a substitute for the actual workflow.
- [x] Establish the case, evidence-manifest, expected-behavior, delivered-evidence, execution-event, and trial-result contracts needed by the lookup path and subsequent slices. Include stable case/trial/turn/operation identities, origin, source identities/dates, and evidence references. The initial pilot case contributes to the later 12-case lookup set rather than increasing the final dataset count.
- [x] Use a fresh trial process with explicit source paths, MemorySaver/thread, and provider-client state established before graph import. Preserve the configured gateway/source-processing requirements and keep evaluator observations outside production State.
- [x] Validate run configuration, fixture compatibility, declared scope, provenance, and integrity before model dispatch. Undeclared missing/corrupt assets or hash mismatches stop with zero gateway requests; an explicitly declared synthetic data fault validates its expected absence/defect and reaches the real graph/readers.
- [x] A missing resource or request outside declared coverage never silently falls back to a live API or the full local corpus. Distinguish invalid fixture coverage from an agent request that violates its allowed scope.
- [x] Require an explicit whole-run physical-model-request allowance. Disable uncounted SDK retries and decrement the shared allowance immediately before each gateway HTTP dispatch, including the actual extractor/lookup requests and their bounded retries. Prevent request N+1 when the allowance is N.
- [x] Establish a reusable role-aware request ledger for later judge/anchor callers without giving them an independent hidden allowance. Report requested allowance, actual dispatches, available model/token metadata, and unavailable metadata honestly.
- [x] Record the pilot's requested and actual tool operations, parsed business outcome, selected source IDs, delivered evidence, visible response, timing, and code-check results. A model-requested call or ordinary returned value is not itself proof of successful data retrieval.
- [x] Provide a preview with selected work, prerequisites, fixture identity, and request-count estimate without network dispatch. Support explicit single-trial execution with the real configured model.
- [x] Produce basic local per-trial JSON and readable Markdown output with expected versus observed behavior, source/evidence references, errors, and unfinished work. Mark semantic evaluation as not yet assessed rather than implying a fully judged pass.
- [x] Persist collected output on cancellation, request exhaustion, or provider failure, and stop further dispatch. An incomplete trial must not become a clean result.
- [x] Keep private source extracts, databases, and reports in the ignored local evaluation-data area; version synthetic evidence, definitions, extraction recipes, and manifests without credentials.
- [x] Test through the public evaluation entry with a local fake gateway HTTP service and temporary SQLite fixtures while retaining the real transport/parser, graph, identity, and data tools. Assert real HTTP counts, code-check/report behavior, preflight rejection, declared data faults, cancellation, and partial artifacts without paid calls.
