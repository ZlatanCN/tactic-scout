# 40 · Calibrate v11 and smoke the remaining v10 findings

**What to build:** Use a fresh bounded real-model run to validate the v11 judge input and the request-classification/lookup-scope fixes against the findings in the v10 development report.

**Blocked by:** None.

**Status:** resolved

## Result

V11 smoke `57d3f600-a776-49eb-8ec9-d84372ef6f81` covered five cases and used 55/120 requests: 18 Agent, 32 Calibration, and 5 Judge. Calibration passed 32/32, including validation 16/16. Four cases passed code and semantic checks; the Mbappé lookup passed deterministic checks but received one semantic unsupported-fact finding because the judge could not see the search tool's exact input parameters. No requests were denied, and no network failures occurred. This finding led to the v12 action-input change; issue 41 tracks its validation.
