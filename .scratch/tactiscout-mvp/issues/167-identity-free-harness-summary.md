# Export identity-free summaries from local Harness runs

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make real local Harness runs reviewable without retaining their candidate-level output. Summary mode must produce a small aggregate artifact and suppress the default candidate-bearing trace/progress output.

## Accepted verification seam

- Pure `createIdentityFreeHarnessSummary(input)` projection over ordinary Harness output.
- Existing local Harness CLI `--summary-output <path>` contract, including refusal to overwrite an existing file before any model or data access.

## Acceptance criteria

- [x] The summary reports aggregate Harness checks, run count, latency, model token usage, tool counts, evidence coverage, and report/candidate counts.
- [x] The summary omits candidate names and IDs, prompt text, report prose, source/player identities, endpoint details, traces, and progress payloads.
- [x] Summary mode suppresses trace/progress output and does not print the full Harness JSON to stdout.
- [x] Summary output is created with owner-only permissions and exclusive-create semantics; an existing destination is rejected before model/data access and remains byte-for-byte unchanged.
- [x] Summary mode clearly rejects ablation/experiment flags until their schemas have an explicitly designed aggregate projection.
- [x] Tests verify the pure projection against identity-bearing input and the CLI's output-file behavior.
- [x] Documentation states that the summary is behavioral evidence only and does not validate recommendation quality or data-source permissions.

## Context

The normal CLI output includes candidate identifiers, report details, trace events, and progress payloads. The latest Understat/Qwen run was therefore recorded only as aggregates; redirecting ordinary CLI stdout/stderr to preserve a run would retain more data than necessary while source retention permissions remain unverified.

## Answer

Implemented `createIdentityFreeHarnessSummary(input)` as a positive field allowlist. It aggregates Harness checks, nearest-rank p50/p95 duration, model request/token totals, across-tool-call match/result counts, progress counts, evidence coverage, low-sample counts and report totals. It omits scenario identifiers as well as player names/IDs, request/report prose, endpoint data, trace events and progress payloads. The CLI `--summary-output <path>` mode suppresses trace/progress logging, writes owner-only (`0600`) JSON with exclusive-create semantics, and rejects an already existing output path before loading the data snapshot or contacting the model. Ablation modes fail closed until a safe shape is designed.

Verification: identity-bearing projection fixture, private-file/exclusive-write behavior, dangling-symlink preflight and experiment rejection tests passed; existing CLI tests prove an existing destination is rejected without contacting the local endpoint. A real Understat/Qwen/LangGraph run completed 31/31 Harness checks and wrote `.data/evaluations/understat-identity-free-summary-verified-2026-10-12.json`; it contains aggregates only, is Git-ignored, and has mode `0600`. The actual run recorded 20 evaluated source records, 220/340 metric values and 20 low-sample records. `pnpm test` passed 404/404; API/Web builds and `git diff --check` passed. This does not establish scouting ranking quality or Understat processing rights.

## Comments

- 2026-10-12: Claimed after the real Understat run exposed that ordinary Harness output is too detailed for an identity-free saved artifact. The implementation supports regular runs first and fails closed for ablations.
