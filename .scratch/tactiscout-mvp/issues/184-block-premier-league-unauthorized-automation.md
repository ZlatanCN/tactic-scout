# Block unapproved Premier League automated data use

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Keep the Pulselive Premier League provider out of automatic Agent retrieval until the source grants permission for automated access, database creation, and any intended model or display use.

## Evidence

- The official Premier League website terms reserve its website/app rights and prohibit reusing or redistributing content, including creating a database from material obtained from the site, without prior written approval: [Terms of Use, intellectual property rights](https://www.premierleague.com/en/terms-and-conditions).
- The official statistics page identifies Opta/Stats Perform as the source of official Premier League performance data: [statistics clarification](https://www.premierleague.com/en/stats/clarification).
- The existing provider reads site-backed Pulselive JSON routes; public access and non-commercial intent do not establish permission for that automated collection.

## Accepted verification seam

- `createApp` HTTP turn with an injected `premier_league` repository.
- Assert HTTP 503 before checkpoint access, candidate reads, or Planner calls.

## Acceptance criteria

- [x] The Agent rejects `premier_league` before case state, candidate data, or Planner processing.
- [x] The gate cannot be bypassed by selecting a local or remote model endpoint or by a self-attested environment flag.
- [x] Documentation no longer presents the Pulselive route as an enabled data mode and records the written-permission requirement.
- [x] The provider remains isolated to deterministic tests until permission is documented; no live request was made during verification.
- [x] The relevant HTTP regression and API/Web builds pass.

## Context

- [Data-source scope and permissions](../../../docs/data-sources.md)
- [General source-processing boundary](../../../CONTEXT.md#来源处理边界)
- [Current-source official scope recheck](../research/source-scope-recheck-2026-10-13.md)

## Answer

The accepted HTTP test initially failed: with a loopback Ollama endpoint, the LangGraph turn reached the Planner and returned 502. Added a source-specific pre-turn gate that rejects Pulselive before checkpoint access, player reads, or Planner calls regardless of model endpoint. The official Premier League terms reviewed on 2026-10-13 prohibit creating a database from website/App content without prior written approval; local-only model processing would not address the separate automated-access/database permission. The provider remains available only as isolated adapter code for fixture tests. Updated `.env.example` and data-source docs so the mode is no longer presented as enabled.

Verification: the HTTP seam returned 503 with a source-specific permission message and zero checkpoint/player/Planner accesses; API and Web production builds passed. No live Premier League request was made.
