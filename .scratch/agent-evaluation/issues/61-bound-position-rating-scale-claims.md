# 61 · Bound position-rating scale claims

**What to build:** Keep recommendation answers from adding a position-rating scale or maximum that the structured data does not supply.

**Blocked by:** None.

**Status:** resolved

## Evidence

The source-matched v19 baseline attempt `b3ec8be9-3b3c-4707-847b-5487c0f6e867` captured `recommend-kane-real-v1` trial 3 answering “位置评分采用 20 分制.” The returned FM rows contain numeric `positionRating` values, but the recommendation result and current project docs do not state a rating scale. Judge calibration stopped after a provider 502, so this claim was not semantically judged in that partial run.

## Acceptance

- Player and team recommendation prompts instruct the model to report only returned position-rating values and not infer a scale or maximum.
- Offline prompt regressions cover both recommendation workflows.
- A bounded real-model smoke confirms the answer stays within the structured result.

## Result

Player and team recommendation prompts now say to report the numeric position rating without naming a scale or maximum absent from the structured result. Prompt regressions pass for both workflows. Smoke `ecbff675-860b-416b-838a-2e4b599b331b` used 35/41 requests, calibration passed 32/32 including validation 16/16, and the recommendation case passed code and semantic checks without a scale claim.
