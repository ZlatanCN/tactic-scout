# 20: Exclude alternate FM profiles for a reference identity

**What to build:** A player recommendation does not return another FM profile linked to the same canonical identity as a selected reference, and its answer identifies the selected reference profile clearly.

**Blocked by:** None.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Expand reference/exclude FM IDs to all linked profiles for the same resolved identity before candidate ranking.
- [x] Use the same identity-level exclusion for team roster profiles.
- [x] Preserve the selected profile alone as the reference mean; exclude its alternate profiles as candidates.
- [x] Ensure the answer reports the selected reference profile's FM ID, CA, and PA when available.
- [x] Update the ambiguous-profile evaluation contract and add an offline full-graph regression.

## Evidence

V8 smoke `426f3ce3-1b71-41cd-b782-7259b48d52e1` selected `fm-amb-b` as the reference, but returned `fm-amb-a`—a second FM profile bridged to the same Reep identity—as a recommended candidate. The answer also omitted the reference profile's required CA value (142).

## Resolution

Recommendation inputs now expand selected FM IDs through the Reep registry and exclude every linked FM profile for reference and explicit-exclusion identities. Team recommendations apply the same expansion to mapped roster and named-reference profiles. Only the selected profile contributes to the reference mean. The recommendation prompt identifies the selected reference FM ID, CA, and PA separately from candidates. The ambiguous-profile case's expected tool sources now omit `fm-amb-a`; full-graph and player/team adapter regressions pass. Full Vitest passes 133 tests, and the 48-case evidence inventory is ready.

Targeted post-fix smoke `c0d751ad-4aee-43cf-893a-2e7d86aed9f5` used 35/60 requests. Deterministic checks and semantic review passed, and v8 validation/development anchors each passed 16/16. The local report is `.data/evals/runs/c0d751ad-4aee-43cf-893a-2e7d86aed9f5/report.md`.
