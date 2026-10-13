# Reject malformed Harness CLI options

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Reject incomplete repeatable options and duplicate single-value options instead of silently changing a Harness run's effective configuration.

## Requirements

- `--answer` remains repeatable when every occurrence has a non-empty value.
- An occurrence of `--answer` with no value or followed by another option fails with a concise error.
- Single-value options such as `--scenario`, `--runs`, and `--message` reject duplicates rather than taking the first value silently.
- Invalid options fail during argument parsing, before data repositories, knowledge bases, or models are accessed.
- Valid option behavior remains unchanged; boolean experiment flags and data-mode policy remain unchanged.

## Verification

- [x] TypeScript build passes.
- [x] `git diff --check` passes.
- [x] Manually verify malformed CLI argument handling without starting a model run.

## Answer

The Harness CLI now rejects repeated single-value options and rejects any `--answer` occurrence without a non-option value. Valid repeated answers remain supported. Parsing happens before repository creation, knowledge-base setup, historical preflight, or model execution.

Verification: `pnpm build` and `git diff --check` passed. Two CLI smoke invocations exited with code 2 and the expected errors for a dangling `--answer` and duplicate `--scenario`; neither started a model run. No automated tests were added.

## Comments

- 2026-10-13: Claimed after the Harness CLI audit found that a dangling `--answer` is ignored and duplicate single-value options silently use the first value.
- 2026-10-13: Resolved after the parser fix, production build, diff check, and two invalid-argument smoke checks.
