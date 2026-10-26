# 04: Refine a team recommendation in the same thread

**What to build:** A scout can refine the last successful team recommendation without repeating the team, position, or resolved roster identities, while separate threads remain isolated.

**Blocked by:** 03: Recommend candidates from a team-position profile.

**Status:** resolved

- [x] A follow-up that changes only age, CA, PA, result count, or high-potential intent inherits the last successful team, position, and roster mappings.
- [x] Omitted filter fields inherit prior values; explicit null clears a filter; explicit values replace it.
- [x] Naming a different team starts a fresh team recommendation context and does not carry over the previous roster or position profile.
- [x] An interrupted or failed refinement leaves the last successful team recommendation available in the thread.
- [x] A different thread cannot see or reuse the first thread’s team selection, roster mappings, filters, or results.
- [x] Tests cover refinement, team replacement, failure preservation, and thread isolation with independent MemorySaver state.
