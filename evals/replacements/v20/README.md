# V20 replacement held-out pack

This pack replaces the exposed v19 cases for a future held-out measurement. It has 16 cases: four each for player lookup, player comparison, player recommendation, and team recommendation. Each workflow has one ordinary, one boundary, and two multi-turn cases. The pack contains 12 cases backed by unused local FM/Understat records and four cases backed by a new synthetic API-Football roster fixture.

The case IDs, scenario-family names, player/team names, source IDs, and evidence-bundle IDs are checked for overlap with the existing development and held-out packs. Synthetic team action IDs are also checked against the fixed API-Football response payloads. The old v19 files remain unchanged. The new contracts cover:

- A Bundesliga comparison that adds a La Liga player while preserving the explicitly requested Bundesliga scope. The expected tool result omits that player's out-of-scope Understat row.
- A real identity ambiguity with an explicit resume answer, so the scripted graph interaction has no unhandled interrupt.
- A recommendation refinement that checks PA and result-limit values at the actual `recommend_player_candidates` input.
- A lookup query that asks for appearances when the fixed Understat evidence contains minutes only.

The pack is prepared but has **not** been run against a live model. Real-source evidence stays under ignored `.data/evals/v20-evidence`; the synthetic team bundle is versioned at `evals/evidence/replacement-v20-team-synthetic.json`.

## Prepare and preview locally

Real evidence preparation reads the local SQLite snapshots and sends no provider requests:

```sh
node --import tsx evals/prepare-local-evidence.ts \
  --case-directory evals/replacements/v20/cases \
  --case v20-lookup-olise-profile \
  --case v20-lookup-fuellkrug-minutes-appearances \
  --case v20-lookup-saved-season-followup \
  --case v20-lookup-aaron-martin-identity-resume \
  --case v20-compare-fuellkrug-olise-common-scope \
  --case v20-compare-fuellkrug-budimir-no-common-scope \
  --case v20-compare-add-budimir-with-bundesliga-inherited \
  --case v20-compare-add-gregoritsch-with-scope-inherited \
  --case v20-recommend-griezmann-similar-stc \
  --case v20-recommend-griezmann-high-pa-prospects \
  --case v20-recommend-refine-pa-and-result-limit \
  --case v20-recommend-refine-age-and-result-limit \
  --output .data/evals/v20-evidence
```

The preparation command also copies versioned synthetic evidence into the local evidence directory. Preview the exact 16 cases and evidence hashes before any live run:

```sh
node --import tsx evals/cli.ts preview \
  --mode held_out \
  --judge \
  --case-directory evals/replacements/v20/cases \
  --evidence-directory .data/evals/v20-evidence
```

The preview fingerprint is final only after the code, model/gateway configuration, and scoring settings are frozen. A later live evaluation requires rotated credentials and a new explicit physical-request allowance. Do not reuse the v19 held-out results for tuning.
