# 64 · Prepare independent v20 held-out evaluation pack

**What to build:** A versioned, fixed-evidence 16-case held-out pack that replaces the exposed v19 split for the next live evaluation.

**Blocked by:** None.

**Status:** resolved

## Scope

- Add a separate pack under `evals/replacements/v20/`; keep all v1–v19 cases, evidence, and reports unchanged.
- Include 16 cases, four each for lookup, comparison, player recommendation, and team recommendation. Use 12 real cases based on unused local FM/Understat records for the three player workflows and four synthetic API-Football roster cases. One real lookup case must include an identity interruption with a scripted answer. Use new scenario-family names, evidence-bundle IDs, player/team names, and source IDs that do not occur in the existing development or exposed held-out packs.
- Correct the three exposed evaluation-contract issues in the new pack:
  - A comparison with an explicit league scope must expect only in-scope records after adding a player from another league.
  - Every identity interruption in a scripted multi-turn case must have an explicit resume answer.
  - Recommendation PA/result-limit filters must be asserted from the executed tool input (`expectedActionValues`), not generic request constraints.
- Include other ordinary and boundary cases so all four workflows remain covered; golden expectations must come from the new fixed evidence and be independent of agent output.
- Wire `--case-directory` through CLI preview and run so the isolated pack can be inspected without replacing the active v1 benchmark.
- Validate case schemas, evidence hashes, split/workflow/category counts, and no case/player/team-name/scenario-family/evidence/source-ID overlap with existing packs. Check synthetic team action source IDs against the fixed API-Football response payloads.
- Do not run a live model or provider evaluation in this ticket. A later live run needs a frozen code/config revision, a previewed fingerprint, rotated credentials, and a new explicit physical-request allowance.

## Acceptance

- The 16 cases are `held_out`, with four cases per workflow and one ordinary, one boundary, and two multi-turn cases per workflow.
- Real cases reference only unused local fixed evidence. Synthetic cases use a new roster fixture. Evidence hashes validate, all API-Football action IDs exist in its fixed response payloads, and pack IDs/names/families/source IDs do not overlap existing development or held-out cases.
- CLI preview using `--case-directory evals/replacements/v20/cases` reads only the replacement pack and reports all evidence ready.
- The three corrected case contracts directly check comparison scope, scripted interrupt resumes, and actual recommendation tool-input filters.
- Offline tests and typecheck pass. No live requests are dispatched.

## Result

- Prepared 16 cases: 12 real player cases from the current local snapshots, and 4 synthetic team cases. Each workflow has four cases with one ordinary, one boundary, and two multi-turn scenarios.
- Verified no overlap with existing development or exposed v19 case IDs, player/team names, scenario families, evidence bundles, or source-record IDs. Pack assertions also verify synthetic team action IDs against the API-Football fixture. The three corrected contract seams are covered by pack assertions.
- Local real evidence bundles are generated under ignored `.data/evals/v20-evidence`; the new synthetic API-Football fixture is versioned separately. CLI preview and evidence preparation now accept the isolated `--case-directory`.
- Offline preview reports all 16 evidence bundles ready and estimates 629 requests for 48 trials plus calibration/judging. `modelConfigurationReady=false`, `heldOutFreezeReady=false`, and no live model/API requests were sent.
- The full evaluation remains a separate future step: rotate credentials, freeze code/scoring/model configuration, preview the final fingerprint, then obtain a new explicit physical-request allowance.
