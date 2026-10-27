# 08: Freeze and validate the complete scouting benchmark

**What to build:** The maintainer can select, preview, validate, and run one versioned 48-case scouting benchmark with independently supported expectations, an honest development/held-out split, and reproducible evidence coverage.

**Blocked by:** 03: Evaluate real player comparisons; 04: Evaluate real FM player recommendations; 05: Evaluate frozen-roster team recommendations; 07: Run repeated evaluations with comparable reports.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Assemble and freeze the workflow cases delivered by the earlier slices rather than postponing all case authoring until this ticket. The final pack has exactly 48 stable cases, 12 per workflow, without counting pilot cases twice.
- [x] Verify four ordinary, four boundary/adversarial, and four multi-turn cases in each workflow. Each contributes three ordinary, three boundary, and two multi-turn development cases, plus one ordinary, one boundary, and two multi-turn held-out cases: 32 development and 16 held-out overall.
- [x] Reach the agreed target of 32 cases based on unchanged real snapshot evidence and 16 based on constructed boundary evidence. Preserve actual provenance; modified real evidence is synthetic/mixed, and unavailable real source records must not be invented to satisfy counts.
- [x] Validate stable definitions, expected tasks/outcomes, identity/source bindings, effective conditions, required/prohibited facts, business-rule references, scripted clarifications, and declared execution bounds across all cases.
- [x] Check golden source facts/identities against fixed source records/bridges and arithmetic/order against independent calculation or preverified frozen answers. No candidate output or production ranking invocation may certify its own gold.
- [x] Group related evidence/scenario families and paraphrases into one split. Record prior prompt/code-tuning exposure and the evaluation-cycle version from which held-out cases were reserved; do not portray historical bug cases as universally unseen.
- [x] Keep all judge anchors and anchor development/validation families distinct from the formal agent cases. Preserve the 32-anchor composition and 16 reserved validation identities already delivered by the judge slice.
- [x] Freeze extraction recipes, source/roster dates and IDs, manifests/hashes, aliases, Reep bridges, FM attributes/positions, feature-map identity, candidate pools, and declared synthetic defects. Report the finite evidence/candidate scope honestly.
- [x] Validate that undeclared missing/corrupt/incompatible fixtures fail preflight with no model dispatch, while intentional declared faults execute the genuine graph/readers. No case may silently use live APIs, the full corpus, or hidden golden hints.
- [x] Provide public-entry selection/preview/integrity validation for the complete pack and each split. Require the agreed evaluated-version/scoring freeze metadata for held-out execution, while keeping ordinary construction/integrity checks separate from using held-out results for tuning.
- [x] Demonstrate the integrated pack with offline fake-gateway runs of representative/full declared paths through the real graph and actual algorithms, including native clarifications and explicit failure cases. Observe public reports and evidence/request records rather than private helper internals.
- [x] Produce a readable benchmark inventory and integrity result documenting counts, sources, grouping, independent expectations, known exposure, case versions, and all unresolved preparation issues. A missing real fixture or invalid label remains visible rather than silently reducing coverage.
