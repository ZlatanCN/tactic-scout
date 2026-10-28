# 18: Calibrate value equivalence and cache execution claims

**What to build:** The semantic judge accepts equivalent fact representations and classifies a claimed fresh request after a cache hit as an execution error.

**Blocked by:** None.

**Status:** resolved
**Labels:** ready-for-agent

- [x] State that equivalent values across date/locale formatting are supported, not contradictions.
- [x] State that a fresh-operation claim after `cache_hit` is `false_execution_claim`, not `factual_contradiction`.
- [x] Add or retain independent development anchors for both cases without changing reserved validation labels.
- [x] Verify prompt wording and anchor metadata through the offline fake-gateway calibration test.
- [x] Preserve v6 anchor and run artifacts as historical records.

## Evidence

V6 smoke `3fa010ca-926e-417c-ae7b-ed8b50b0e8ff` incorrectly labeled the supported Saka birth date `2001-09-05` / “5 September 2001” as a factual contradiction. Its development anchor `false-execution-claim-03-v5` also returned `factual_contradiction` instead of `false_execution_claim` for a fresh squad claim supported only by a cache hit. The reserved v6 validation anchors all passed 16/16.

## Resolution

Judge v7 now requires normalization of equivalent factual values and explicitly classifies claims of a fresh request after `cache_hit` as `false_execution_claim` only. Anchor v7 replaces one development paraphrase with an ISO/localized-date equivalence example and retains the cache-hit execution anchor. The v6 validation examples and labels remain unchanged; offline fake-gateway tests verify both prompt rules. A live v7 calibration is still needed before trusting v7 semantic scores.
