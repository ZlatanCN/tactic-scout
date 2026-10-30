# ADR-0010: Keep validated workflow snapshots and derive continuation

Status: accepted

Retain independent successful snapshots for lookup, comparison, player recommendation, and team recommendation. Each completed result is validated against its owning workflow schema, and its snapshot plus `TurnOutcome` are committed together before explanation; valid empty results count as completed, while malformed results fail visibly. Outcomes distinguish executed data from saved-result reuse.

For an unqualified follow-up, derive a temporary summary from the previous request and outcome rather than storing a continuation pointer. Prefer an explicit workflow; otherwise continue the last compatible successful workflow, choose a sole compatible snapshot, or interrupt to ask among multiple candidates. Store the current-turn patch in the existing pending clarification and merge it only after the choice. Explain saved results by routing directly to the answer node. Keep the four snapshots, `resultJson` representation, serial graph state, and in-memory checkpointer; do not add an `activeTask`, Store, or database without evidence that these choices are insufficient.
