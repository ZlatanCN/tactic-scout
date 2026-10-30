# 39 · Link judge participants to their selected source records

**What to build:** For each turn, the semantic judge should receive the provider source IDs selected for every confirmed participant, including the scope metadata attached to those identity records.

**Blocked by:** None.

**Status:** resolved

## Evidence

V10 judged that the Mbappé lookup result did not identify source ID 3423 as the confirmed player. The input listed the participant name but omitted the participant-to-source-ID link, although identity resolution had selected that Understat ID in the same turn.

## Answer

Per-turn judge participants now include selected provider IDs and their competition/season metadata; action events also include the exact tool input. The prompt distinguishes identity evidence from the requested query result and tells the judge to inspect supplied tool parameters before judging filter claims. Offline regressions verify participant/source mappings and action inputs. V11 smoke found that action inputs were still needed to adjudicate an explicit “not filtered by La Liga” claim; that led to the v12 input extension.
