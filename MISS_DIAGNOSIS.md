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

## CORRECTION (user was right)
I initially dismissed 15=-5+15+5 as not tile-legal — that was WRONG. The user's
exact placement makes "15" from the 1 and 5 TILES (cols 0,1), not a single 15 tile:
  1@(11,0) 5@(11,1) =hook@(11,2) -@(11,3) 5@(11,4) +@(11,5) 15@(11,6) +@(11,7) 5@(11,8)
Verified via real validatePlay: ok=true, 8 NEW tiles, equation 15=-5+15+5, score 70.
Tile mapping: 1, 5, +/-=(-), 5, +, 15, blank=+, blank=5. Blanks are + and 5 — exactly
as the user stated. My error: I assumed "15" had to be the single two-digit tile and
thus miscounted operators. Lesson: a multi-digit number in a play can be composed of
single-digit TILES, which changes tile-legality.

So there are (at least) TWO missed playable bingos on this position:
  - 15=-5+15+5  (70 pts) — blanks = + and 5 (5 is standalone → solvable)
  - 1=6+5-15+5  (76 pts) — blanks = 6 and + (6 is standalone → solvable)
Both are cap/time-bound misses; both have a solvable standalone-number blank +
an operator blank → solve-for-blank is the correct fix. These are now the concrete
regression targets the fix must satisfy.

## ROOT CAUSE FOUND (two distinct bugs)
Window cells are collected by walking ONE direction from an anchor, skipping
occupied cells (collectPlacementCells). Anchors = empty cells ADJACENT to a tile.

BUG 1 — 76-bingo (1=6+5-15+5), cells [1,3,4,5,6,7,8,9]: REACHABLE from anchor
(11,1) going right (col1, skip '='@col2, col3..col9). So it SHOULD be found. It is
not found within budget → the cause for THIS one is in blank-face generation/time
for that specific window (still to pin down), NOT geometry.

BUG 2 — 70-bingo (15=-5+15+5), cells [0,1,3,4,5,6,7,8]: needs col0. col0 is only
reachable by starting collection at col0 and going right, but (11,0) is NOT adjacent
to any tile, so it is NOT generated as an anchor. From (11,1) going right you start
at col1 and never include col0; from (11,1) going left you get only [1,0] then OOB.
So this window is UNREACHABLE by the current anchor+single-direction collection.
This is a genuine WINDOW-GENERATION GAP: a bingo whose far end lands on a board-edge
empty cell separated from the hook can't be framed. Fix would require generating
windows that extend PAST the anchor on the far side (or seeding anchors at empty
cells that are reachable along a line from a tile within N steps, not just immediate
neighbors).

## Next
Tackle BUG 2 (window generation) — it's a concrete, testable gap and likely the
class behind several "obvious" misses. Then re-examine BUG 1. Keep both bingos as
regression targets (70 and 76 on this position).
