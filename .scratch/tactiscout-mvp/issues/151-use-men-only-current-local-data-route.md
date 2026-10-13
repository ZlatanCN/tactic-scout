# Use the men-only current-season route in the local workbench

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

The active local `.env` still selects FPL, so the homepage presents its 2026/27 game directory as the current live player source. The official 2026/27 FPL terms prohibit automated access and extraction. Use the existing five-league Understat adapter for local current-season research instead, while preserving its unknown data-use permissions and scope limitations.

## Proposed behavior

- The local API selects `understat`; no other `.env` settings or credentials are changed.
- The workbench reflects Understat as the selected source after the API restarts.
- The user-facing scope remains men's football and does not imply a complete registered roster, transfer market, age coverage, or source authorization.
- FPL remains an archived engineering experiment, not a current data route presented by the workbench.

## Acceptance criteria

- [x] Only `TACTISCOUT_DATA_MODE` changes in the local `.env`, from `fpl` to `understat`.
- [x] The restarted API and homepage report Understat rather than FPL as the active source.
- [x] The workbench caveat discloses missing age and unverified collection, retention, model-processing, display, and redistribution permissions.
- [x] The configured ASA route remains restricted to MLS, USL Championship, and USL League One.
- [x] The source choice and its evidence are recorded in the map and source documentation.

## Evidence

- [FPL 2026/27 terms](https://fantasy.premierleague.com/help/terms), §28(d) and §29.
- [Understat source review](../research/current-no-key-men-player-sources-after-fbref-403-2026-10-11.md).

## Answer

Changed only the local `.env` data mode from `fpl` to `understat`; no credentials or other environment settings were edited. Restarted the API and Vite server. The workbench now labels Understat as the active source and its expanded limits panel explicitly says that automated collection, local retention, LLM/RAG processing, public display, and redistribution permissions are unverified.

One bounded, sequential `UnderstatPlayerRepository.loadPlayers()` read returned 2,164 player-season records across EPL, La Liga, Bundesliga, Serie A, and Ligue 1 for 2026/27. The records contain no age field. The smoke printed only counts and competition/season names; it did not persist raw responses or call a model. This is one observed source snapshot, not proof of a complete roster, transfer market, refresh SLA, source authorization, or recommendation quality.

Verification: browser accessibility state confirmed the active source and expanded caveat; `pnpm build`, `pnpm build:web`, and `git diff --check` passed. The automated test suite was not run for this configuration and copy change.
