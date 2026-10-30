# 50 · Map required facts to user-facing labels

**What to build:** The semantic judge should recognize documented user-facing labels for structured fact fields without treating a correct paraphrase as a missing fact.

**Blocked by:** None.

**Status:** resolved

## Evidence

V15 smoke `ae7fe94a-2597-4474-9822-0c2c57511aa7` passed the player-comparison answer semantically, but the V15 judge failed required-fact coverage for the FM `currentAbility=139` fact, although the answer table said “当前能力 139.”

## Answer

Judge prompt v16 now defines `currentAbility` as equivalent to CA/当前能力 and `potentialAbility` as equivalent to PA/潜力能力; it also maps Understat `expectedGoals` to xG/预期进球. The offline anchor calibration test checks that these equivalence rules remain in the judge prompt.
