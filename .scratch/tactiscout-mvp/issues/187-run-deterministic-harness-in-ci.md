# Run the deterministic Agent regression suite in CI

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the existing deterministic LangGraph, Harness, API and adapter regressions run automatically alongside the production builds.

## Evidence

- The current CI workflow installs locked dependencies and builds the API and web app but does not run `pnpm test`.
- The local test script runs the deterministic suite without API keys or live football-data requests; tests that exercise HTTP use local fixtures.

## Acceptance criteria

- [x] CI runs the canonical `pnpm test` script before the API and web builds.
- [x] The local deterministic suite and both builds pass on the current source.
- [x] README and evaluation documentation describe the automated regression gate without implying a remote CI run that has not occurred.

## Context

- [Evaluation and reproduction](../../../docs/evaluation.md)
- [Continuous integration workflow](../../../.github/workflows/ci.yml)

## Comments

- 2026-10-13: Claimed after the project audit found that the 436-case deterministic Agent/Harness suite was documented and passing locally but absent from the repository CI workflow.

## Answer

Added the canonical `pnpm test` step before the API and web production builds, and renamed the workflow job to describe both testing and builds. README and evaluation docs now state that CI includes the deterministic regression suite and report the current local 436/436 result. No Ollama, API key, live football source, or remote CI run was used for verification.

Verification: local `pnpm test` passed 436/436; `pnpm build`, `pnpm build:web`, YAML parsing, and `git diff --check` passed. The GitHub-hosted workflow itself has not been run because no remote operation was requested.
