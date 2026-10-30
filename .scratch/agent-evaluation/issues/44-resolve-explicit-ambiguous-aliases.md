# 44 · Resolve explicit ambiguous aliases as player names

**What to build:** A non-pronoun player mention that appears in the user's message must proceed to identity resolution even when structured extraction labels its reference scope ambiguous.

**Blocked by:** None.

**Status:** resolved

## Evidence

V14 trial `compare-same-identity-synthetic-v1` extracted both “Elias Demo” and the alias “Demo,” but `normalizeExtractedPlayer` dropped the second mention because it was marked ambiguous and was not a pronoun. The graph then saw one player and asked for another comparison target instead of recognizing both mentions as the same identity.

## Answer

Normalization now promotes a literal non-pronoun mention present in the current message to an explicit identity lookup when extraction marks it ambiguous. Tests cover the extraction seam and the full graph resolving both names to the same canonical player and returning `insufficient_distinct_players` without searching records.
