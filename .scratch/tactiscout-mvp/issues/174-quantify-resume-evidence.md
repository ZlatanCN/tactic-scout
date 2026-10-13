# Quantify the resume narrative with audited experiment evidence

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Strengthen the bilingual resume-ready project summary with one concise, verifiable full-graph ablation result, without implying that Harness pass rates establish player-ranking quality.

## Evidence boundary

- Use the sanitized local aggregate from the three-pair Wyscout 2017/18 evidence-evaluator ablation and its resolved protocol in issue 153.
- State that each enabled run passed 31/31 behavior checks and produced 3 evidence-backed leads with 6 references; the evidence-withheld control produced no recommendations in all three paired runs.
- The withheld arm intentionally passes its no-evidence contract but scores 29/31 on the ordinary capability-coverage checks. Do not call both arms 31/31 or say the control arm passed the ordinary Harness.
- Note that all three paired downstream Planner/tool traces matched. Scope the result to this frozen historical scenario; ranking quality remains unevaluated without independent scout labels.
- Do not use the recent Understat run as a resume metric: automated collection, retention, model/RAG processing, and public display permissions remain unverified.

## Acceptance criteria

- [x] The Chinese and English resume entries each include one concise quantitative outcome from issue 153.
- [x] The entries distinguish an evidence-flow ablation from a ranking-quality evaluation and link to the detailed walkthrough/evaluation record.
- [x] No count, pass rate, source permission, or ranking-accuracy claim exceeds the sanitized aggregate and issue 153 protocol.
- [x] The README still links to the updated bilingual entry; touched Markdown links and whitespace are checked.

## Answer

Updated the Chinese and English resume summaries and one-minute interview script with the strongest controlled result from the frozen Barcelona U23/Wyscout 2017/18 case. The three enabled runs each passed 31/31 behavior checks and produced 3 leads with 6 evidence references; all three evidence-withheld controls produced no recommendations and matched the enabled downstream Planner/tool trace. The control arm's ordinary capability checks remain 29/31 while its explicit no-evidence contract passes 3/3; the wording preserves this distinction. The result is described as evidence-flow validation only. Ranking quality remains unevaluated pending independent scout labels.

Validation: the figures were checked against the Git-ignored aggregate without printing candidate identities; the evaluator section anchor exists; the README still links to the updated walkthrough; `git diff --check` passes. No tests were needed for this documentation-only change.

## Comments

- 2026-10-13: The current bilingual entries describe architecture and ablation categories but omit the strongest measured result. The Git-ignored aggregate was read using count-only output: three paired runs; enabled 3/3 at 31/31 with 3 leads and 6 evidence references each; withheld 3/3 at 29/31 ordinary checks and 3/3 explicit no-evidence contract, with zero leads; downstream traces matched in all three pairs.
