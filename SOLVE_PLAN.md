# Solve-for-Blank Approach — proven concept + integration plan

## User's idea (correct and powerful)
Instead of guessing blank values, place all NON-blank tiles first, then SOLVE for
what each blank must be to make the equation valid. Algebra, not brute force.

## PROVEN (prototypes, /tmp)
- O(1) exact-fraction solve works: from two probes (x=0, x=1) compute the slope and
  solve g(x)=0 for the blank's value. Validated on:
    7+?=12→5, ?+5=20→15, 3×?=18→6, 20-?=1→19, ?-1=16→17, 2×?+1=13→6
  Note it NATURALLY finds 17 and 19 — the exact values the old pruning omitted.
- Works because the equation is LINEAR in a single standalone-number unknown
  (even with × ÷, since one unknown factor is still linear).

## WHERE IT HELPS MOST
- GAME AI: enumerates ~23 faces per blank (134s on the hard 2-blank case). The 23×
  (or 23×23) factor IS the dominant cost → solve-for-blank attacks it directly.
- CALCULATOR: already grammar-pruned (~20s exhaust). Cost there is skeleton
  enumeration, not blank-digit guessing → smaller win, higher regression risk.
  Lower priority.

## SAFE DESIGN (never lose a play)
Layer solve as a FAST PATH on top of the existing COMPLETE search:
1. In permuteAndTry, defer BLANK tiles — place all non-blank rack tiles + use board
   hooks first (blanks last).
2. When only blanks remain and each blank occupies a STANDALONE-NUMBER slot
   (operators/= on both sides, not a digit-of-multidigit), SOLVE:
     - 1 remaining blank → solve directly (O(1)).
     - 2 remaining blanks → fix one over its valid values (≤23), solve the other.
   Then VERIFY with real validatePlay (accuracy guarantee).
3. FALL BACK to the current enumeration whenever a blank is NOT a solvable
   standalone number (blank as operator, blank as a digit within a multi-digit
   number, blank adjacent to digits). Never skip those cases.
This preserves the "never miss" guarantee: solve handles the common/expensive case
fast; enumeration still covers everything else.

## VERIFICATION REQUIRED before shipping (like the calculator rewrite)
- Across many positions (first-move, mid-game, 1/2/3-blank, hooks, multi-digit),
  the new search must find the SAME-OR-MORE plays as the current one, and every
  returned play must pass real validatePlay. 0 regressions, 0 invalid.
- Measure speed: target the 134s hard case dropping substantially.

## STATUS
Concept proven. Integration is a careful rewrite of permuteAndTry (the AI's hottest
function) + a verification harness. To be executed as a focused, well-tested change.
