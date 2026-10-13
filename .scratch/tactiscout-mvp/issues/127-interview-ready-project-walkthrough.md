# Add an interview-ready TactiScout walkthrough

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Help a hiring manager or reviewer understand the product and reproduce its strongest verified Agent workflow without relying on undocumented setup, hidden credentials, or overstated evaluation claims.

## Scope

- Add a short, accurate demo guide linked from the portfolio-first README.
- Describe the user-visible journey: natural-language recruitment brief, grounded clarification, LangGraph progress/tool work, same-case resume, evidence report, and Reviewer boundary.
- Give the exact local startup/config path for the documented model/data mode and one representative prompt.
- Separate a live interactive run from prerecorded Harness evidence; make clear what a successful Harness proves and what it does not.
- Keep the guide short enough to use during an interview and link to deeper architecture, data and evaluation docs.

## Acceptance criteria

- [x] A first-time reviewer can find a concise guided demo path from `README.md`.
- [x] Commands and required configuration match checked-in scripts and `.env.example`.
- [x] The demo narrative is supported by a recorded end-to-end run and does not promise fixed questions/results.
- [x] The guide distinguishes Agent behavior verification from player-ranking quality and market completeness.
- [x] No credentials, ignored local artifacts, fabricated outcomes or unsupported source claims are added.

## Answer

Added [`docs/demo-walkthrough.md`](../../../docs/demo-walkthrough.md) and linked it from the portfolio README. The guide documents local Ollama + `mosaic` setup, an interactive Bayern brief, how to inspect real graph progress and answer a runtime clarification, where to verify data limitations, and the exact local Harness command. It cites a previously recorded 28/28 `mosaic` run while warning that model responses vary and a single page does not prove full-market coverage or ranking quality.

The guide also distinguishes the default fictional `demo` data mode from current multi-source data and states where saved plans persist. No ignored local artifacts, credentials, or player rows were copied into the public docs.

## Comments

- 2026-10-10: Resolved after checking commands against `package.json` and configuration against `.env.example`, and grounding evaluation claims in issue 14.
