# Block new Agent use of the retired FPL source

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Keep the FPL adapter available for isolated historical fixtures, but prevent new recruitment cases from automatically reading its data or sending that data to a Planner. The repository documentation already says FPL is not an active automated source because the official 2026/27 terms prohibit automated access and extraction.

## Accepted verification seam

- `createApp` HTTP behavior for an FPL-backed natural-language case turn.
- The request must fail before checkpoint reads, player reads, or Planner calls.

## Acceptance criteria

- [x] An FPL-backed recruitment turn returns HTTP 503 with a source-policy explanation.
- [x] The turn does not read checkpoint state, player data, or call the Planner, including when a loopback Ollama endpoint is configured.
- [x] Existing FPL provider mapping fixtures remain available without issuing network requests.
- [x] `docs/data-sources.md` and the issue map describe the runtime block without presenting FPL as an active route.

## Answer

The shared LangGraph turn policy now rejects FPL before checkpoint lookup, candidate reads, or Planner execution; `TACTISCOUT_DATA_MODE=fpl` remains useful only for isolated offline fixtures and historical records. The message points to the documented source restriction. The gate does not depend on a user-controlled override flag or model endpoint.

Verification: the new HTTP regression first failed against the old behavior (Planner called and HTTP 502), then passed with HTTP 503 and zero checkpoint, player, and Planner reads. `pnpm test` passed 397/397; `pnpm build`, `pnpm build:web`, and `git diff --check` passed.

## Evidence

- [FPL data-source policy](../../../docs/data-sources.md#fantasy-premier-league-fpl)
- [FPL 2026/27 terms](https://fantasy.premierleague.com/help/terms)
- [Men-only current local route](151-use-men-only-current-local-data-route.md)

## Comments

- 2026-10-12: Adversarial review found that `TACTISCOUT_DATA_MODE=fpl` still passed the shared LangGraph model-processing gate despite the documented prohibition. The HTTP regression reproduced the Planner call before the policy fix.
