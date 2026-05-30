# Confirmed bingo MISS — diagnosis (v219)

## The miss (real game, user-reported)
Position: mid-game, AI rack = 1, +/-, BLANK, BLANK, 5, +, 15, 5. Board has an '='
hook at (11,2) in an otherwise-empty row 11. AI SWAPPED (bingo=none) at 300s budget.

## A real, playable, tile-legal bingo EXISTS (verified via real Placement.validatePlay)
  1 = 6 + 5 - 15 + 5   → places 8 NEW tiles in row 11 (cols 1,3,4,5,6,7,8,9),
  hooking the existing '=' at col2. Scores 76 (8 tiles + 40 bingo bonus).
  Tile mapping from rack: 1(tile), blank=6, +(tile), 5(tile), +/-=-, 15(tile),
  blank=+, 5(tile). Uses both blanks + the single +/- + the single +. LEGAL.
  (User's own suggestion 15=-5+15+5 is valid math but needs THREE +/- and places
   only 7 tiles — not playable from this rack; but a DIFFERENT 8-tile bingo exists.)

## Reproduced
- 90s budget, aiConsecutiveSwaps=0 → AI SWAPS (no bingo). REPRODUCES THE MISS.
- 300s budget → AI finds a 74-pt bingo (still not the optimal 76).
→ This is a TIME/CAP-bound miss: the winning 8-cell window (2 blanks) isn't fully
  searched within budget. The '='-hook anchor IS generated and gets the +12 promise
  boost (anchors (11,1) and (11,3) are valid), but permuteAndTry's tile-ordering ×
  blank-face (23×23) explosion for that window exhausts the per-anchor time / cap
  before reaching blank={6,+}.

## Why this matters / changes the plan
The winning play's blanks are: 6 (a STANDALONE NUMBER → solvable) and + (operator).
This is EXACTLY the case the solve-for-blank approach targets: solving the numeric
blank (6) instead of enumerating 23 values, while enumerating the operator-blank,
would reach this play quickly. So solve-for-blank is not merely a speed nicety —
it is the fix for this class of CAP-BOUND MISS. Worth completing the integration
(carefully, with same-or-more-plays verification), because here it converts a SWAP
(0 pts) into a 76-pt bingo.

## Status
Diagnosis confirmed + reproduced. Next: complete a SAFE solve-for-blank integration
that actually reduces the per-window blank explosion (not just the last cell), so
cap-bound 2-blank windows like this are solved fast. Must verify same-or-more-plays
before shipping.

## UPDATE — user correction + refined finding
- CORRECTION (user was right): 15=-5+15+5 IS playable — the '=' is the BOARD HOOK at
  (11,2), not a rack tile. Verified ok:true via real validatePlay, score 26, with
  blanks = {15, +} (one 15 MUST be a blank since the rack has only one 15 tile; so it
  can't be blanks {5,+} as first guessed, but it IS a legal play). It places 7 NEW
  tiles → a strong PLAY, not a bingo. My earlier "not playable" was WRONG (I forgot
  the free '=' hook). The separate 8-tile bingo 1=6+5-15+5 (76) also exists.
- So on this hook the AI had at least a 26-pt play AND a 76-pt bingo available, and
  it SWAPPED (best=none) → missed both.
- Variance note: a 300s isolated repro found a 74 bingo, but the real game (worker)
  and a 90s repro both SWAP (best=none). So the miss is real and reproducible at
  shorter/realistic budgets; it's CAP/TIME-bound on the 2-blank window.
- The ×4-avoidance swap rule (score<40 + ×4 threat → swap) is NOT the cause here
  (log shows best=none, i.e. nothing found), but it's worth remembering it can also
  turn a found sub-40 play into a swap.
- FIX DIRECTION CONFIRMED: make the 2-blank window search efficient (solve numeric
  blanks like 15/6 instead of enumerating) so these plays are found within budget.
  Reproducible target: this position must yield the 76 bingo (or at least the 26 play
  rather than a swap).
