# 31 · Restate required fields in structured-request repair feedback

**What to build:** When request extraction returns an invalid structured object, the single repair prompt explicitly lists required fields and valid null/omission rules so the repair does not drop another required field.

**Blocked by:** None.

**Status:** resolved

## Answer

Request repair feedback now restates the required `constraints`, `kind`, `players`, and `teams` fields, explains that empty collections must be `[]`, allows `kind: null`, and tells the model to omit optional enum fields instead of setting them to `null`. The original one-repair limit remains unchanged.

## Evidence

Development run `38e8d637-8ebc-47ad-878f-f9500cf7bef1` showed a third-turn age refinement fail after the model first returned `comparisonAction: null` and then omitted required `teams` in its repair. No recommendation tool call ran, so the previous `maxAge` result correctly remained active.

Regression tests verify the repair prompt contains the schema reminder and that a valid repaired kindless `maxAge` refinement applies after an identity confirmation. Smoke `efdcaa7c-9a98-40be-ab99-c223e3b61550` passed all deterministic checks, including a recommendation call with `maxAge=21`; it used 8/30 requests and did not run semantic judging.
