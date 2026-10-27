# 06: Calibrate a semantic judge and score scouting claims

**What to build:** The maintainer can qualify a semantic judge on known evidence/action labels, apply it to real trial answers, and inspect separate factual-contradiction, unsupported-addition, and execution-claim findings.

**Blocked by:** 01: Run a bounded player-lookup evaluation trial. The public entry, evidence/event contracts, real gateway transport, request allowance, and basic report are sufficient to begin this slice independently of the multi-turn implementation.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Extend the public evaluation entry with a semantic judge and anchor-validation mode, and demonstrate scoring on a complete lookup trial. Reuse the existing evidence/event/report contracts rather than introducing a separate production graph or private testing API.
- [x] Configure the judge model independently through the existing gateway; explicitly allow and record same-model judging. Keep the evaluated model/version label out of judge inputs and identify all results as automated review.
- [x] Use the same whole-run physical-request ledger as the agent. Include judge requests, anchor requests, retries, and bounded structured-output handling; disable uncounted SDK recovery and preserve every attempted dispatch.
- [x] Create 32 independent labeled anchors: eight correct paraphrases, eight contradictions, eight unsupported additions, and eight execution-claim errors. Each category contributes four development and four reserved validation examples.
- [x] Derive labels from fixed evidence/rules, including plausible correct variants and subtle value, identity, season, missing-fact, blocked/failed-call, provider-coverage, and saved-reuse errors. Generated answers cannot certify their own labels; do not call these human or expert annotations.
- [x] Keep development/validation anchor families separate and keep both distinct from the 48 agent cases. Record any prior judge-tuning exposure and version anchors/rubrics.
- [x] Require all 16 reserved validation anchors to match the expected pass/fail verdict and error-category label set, including no false error for correct paraphrases. A merely correct binary failure with the wrong error category does not pass calibration.
- [x] Failed/incomplete anchor validation invalidates formal semantic scores. Preserve collected agent outputs and deterministic findings, report the exact observed anchor results, and make no claim of universal judge accuracy.
- [x] If reserved-anchor findings are used for tuning, record the exposure and retire/version replacement validation examples. Do not repeatedly ask for a favorable outcome or silently keep calling exposed examples untouched.
- [x] Judge only the interaction, evidence actually supplied or legitimately reused, business definitions supplied to the agent, observed actions, and applicable contracts. Hidden fixture facts and expected golden answers cannot rescue unsupported generation.
- [x] Review every user-visible response across the scripted trial for required facts and additional factual/execution claims, aligned with the evidence and actions actually available at that turn. Later retrieval or correction cannot retroactively support an earlier false claim or erase its confirmed violation. Allow grounded paraphrases and appropriate abstention while detecting blanket refusal on answerable tasks.
- [x] Produce structured findings with answer quotations, category/verdict, valid evidence/action references or a properly scoped missing basis, and concise explanations. Validate schema, quote locations, reference existence, and evidence completeness in code.
- [x] Invalid structures/references, missing necessary evidence, or unresolved judgments become invalid/inconclusive semantic results rather than passes. Individual transport/parser recovery is bounded; no repeated judging or voting merely to obtain a desired verdict.
- [x] Distinguish contradictions, unsupported additions, and false execution claims. Requested calls are not executed actions; a returned unavailable result is not success; saved evidence is not a fresh query; identity lookup and profile lookup are distinct operations.
- [x] A confirmed critical code or semantic violation fails the trial even when a later error occurs. Keep known deterministic failures when semantic calibration is invalid, and leave unjudged semantic metrics explicitly invalid/inconclusive.
- [x] Integrate calibration identity, actual agent/judge configuration, findings, validity, role-specific request usage, and retained evidence into local per-trial reports.
- [x] Test anchor validation and full-trial judging through the shared public entry with fake gateway HTTP. Cover correct paraphrases, wrong categories, unsupported/contradicted facts, false action statements, hidden-but-undelivered evidence, invalid schema/quotes/references, uncertainty, calibration failure, bounded recovery, budget enforcement, and known-failure retention.
