/**
 * A-Math AI — Swap Brain 2: Probability-Driven Expected Value
 *
 * For each candidate "keep set" K (subset of rack to retain),
 * compute E[score next turn | K] = Σ_p P(complete pattern p | K, draws) × score(p).
 * Pick K with highest E[K]. Swap list = rack - K.
 *
 * Differences from Brain 1:
 *   - Probability-aware: knows that drawing a specific 19 from bag with 3 draws is unlikely.
 *   - Board-aware: if = exists on board within reach, doesn't need = in hand.
 *   - Pattern-aware: considers many bingo/yoyo patterns, not 1 fixed template.
 *
 * Inherits hard rules:
 *   - Never swap BLANKs (always keep).
 *   - Bag ≤ 4 prevents swap (enforced upstream in ai-player.js).
 *
 * Extension points (future):
 *   - Leave equity table (commented stub below).
 *   - Monte Carlo for hard-to-compute patterns.
 *   - Variance-aware objective (seek when behind, minimize when ahead).
 *   - Endgame minimax when bag ≤ 14.
 */

(function () {
  const C = window.AMath.constants;

  // ===========================================================================
  // TILE CLASSIFICATION
  // ===========================================================================

  const SMALL_NUMBER_FACES = new Set(['1', '2', '3', '4', '6', '7', '8', '9']);
  const SMALL_NUMBER_PRIORITY = {
    '1': 1, '2': 2, '3': 3, '4': 4,
    '6': 5, '7': 6, '8': 7, '9': 8,
  };

  // Operator-keep priority (lower = keep first). Tournament A-Math wisdom:
  // +/- > -, ×/÷ > ÷ > × for usefulness.
  const OPERATOR_KEEP_PRIORITY = {
    '+/-': 1, '×/÷': 2, '-': 3, '÷': 4, '+': 5, '×': 6,
  };
  function operatorKeepRank(face) {
    return OPERATOR_KEEP_PRIORITY[face] != null ? OPERATOR_KEEP_PRIORITY[face] : 99;
  }
  const HARD_TILE_FACES = new Set([
    '0', '5',
    '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  ]);

  function isBlank(t) { return t && t.type === 'blank'; }
  function isEquals(t) { return t && t.type === 'equals'; }
  function isOperator(t) {
    return t && (t.type === 'op' || t.type === 'choice');
  }
  function isSmallNumber(t) {
    return t && t.type === 'digit' && SMALL_NUMBER_FACES.has(t.face);
  }
  function isHardTile(t) {
    if (!t || !t.face) return false;
    if (t.type === 'op' || t.type === 'choice' ||
        t.type === 'equals' || t.type === 'blank') return false;
    return HARD_TILE_FACES.has(t.face);
  }

  // ===========================================================================
  // UNSEEN POOL (bag + opponent rack)
  // ===========================================================================

  function predictUnseenPool(state) {
    const inventory = C.getActiveInventory ? C.getActiveInventory() : C.TILE_INVENTORY;
    const seen = {};

    // Tiles on board
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = state.board.cells[r][c];
        if (cell && cell.tile) {
          seen[cell.tile.face] = (seen[cell.tile.face] || 0) + 1;
        }
      }
    }
    // Tiles in AI's own rack
    for (const t of state.aiRack.tiles) {
      seen[t.face] = (seen[t.face] || 0) + 1;
    }

    let total = 0, blanks = 0, equals = 0, operators = 0, smalls = 0, hards = 0;
    for (const def of inventory) {
      const remaining = def.count - (seen[def.face] || 0);
      if (remaining <= 0) continue;
      total += remaining;
      if (def.type === 'blank') blanks += remaining;
      else if (def.type === 'equals') equals += remaining;
      else if (def.type === 'op' || def.type === 'choice') operators += remaining;
      else if (SMALL_NUMBER_FACES.has(def.face)) smalls += remaining;
      else if (HARD_TILE_FACES.has(def.face)) hards += remaining;
    }
    return { total, blanks, equals, operators, smalls, hards };
  }

  // ===========================================================================
  // HYPERGEOMETRIC PROBABILITY
  // ===========================================================================

  // C(n, k) — small values, cache for speed
  const _combCache = {};
  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    if (k > n - k) k = n - k;
    const key = n + ',' + k;
    if (_combCache[key] !== undefined) return _combCache[key];
    let result = 1;
    for (let i = 0; i < k; i++) {
      result = result * (n - i) / (i + 1);
    }
    _combCache[key] = result;
    return result;
  }

  // P(exactly k of type T in n draws from pool of N with K_T of type T)
  function hyperProbExact(N, K_T, n, k) {
    if (n > N) return 0;
    if (k < 0 || k > n) return 0;
    if (K_T < 0) return 0;
    const denom = comb(N, n);
    if (denom === 0) return 0;
    return comb(K_T, k) * comb(N - K_T, n - k) / denom;
  }

  // P(at least k of type T in n draws)
  function hyperProbAtLeast(N, K_T, n, k) {
    if (k <= 0) return 1;
    if (K_T < k) return 0;
    let p = 0;
    const maxK = Math.min(n, K_T);
    for (let i = k; i <= maxK; i++) {
      p += hyperProbExact(N, K_T, n, i);
    }
    return p;
  }

  // Multivariate hypergeometric approximation:
  // P(at least needs[type] of each type in n draws)
  // = product of marginal probabilities (independence approximation)
  function hyperProbAllNeeded(pool, needs, n) {
    let totalNeeded = 0;
    for (const k of Object.keys(needs)) totalNeeded += needs[k];
    if (totalNeeded > n) return 0;

    let p = 1;
    for (const category of Object.keys(needs)) {
      const need = needs[category];
      if (need <= 0) continue;
      const K_T = pool[category] || 0;
      if (K_T < need) return 0;
      const pCat = hyperProbAtLeast(pool.total, K_T, n, need);
      p *= pCat;
      if (p < 0.0001) return 0; // early exit
    }
    return p;
  }

  // ===========================================================================
  // PATTERN LIBRARY
  //
  // Patterns are equation templates with required tile composition.
  //
  // Fields:
  //   size: total tile count when placed on board (must match for completion)
  //   needs.equals: count of '=' needed
  //   needs.operators: count of operators needed
  //   needs.smalls: count of small number tiles needed
  //   baseScore: estimated score (incl. Bingo bonus where applicable)
  //   hits3E: whether the pattern naturally lands on 3E
  //
  // CRITICAL: needs.equals + needs.operators + needs.smalls must equal `size`
  // for the pattern to be fully specified. Multi-digit numbers count as 2 tiles
  // contributing to the smalls count (since each digit is a separate tile).
  //
  // Example: 'x+x=xx' has 6 positions but the 'xx' is 2 tiles, so total = 6 tiles.
  // To make a Bingo (8 tiles), we need bigger patterns like 'xxx+xx=xxx'.
  // ===========================================================================

  const PATTERNS = [
    // === 8-tile Bingos (size=8, +40 bonus baked into baseScore) ===
    //   xxx+xx=xxx  → 1=, 1op, 6 smalls = 8 tiles ✓
    //   xx+xx=xxx   → 1=, 1op, 6 smalls = 8 ✗  (wait, 2+2+3 = 7 digits + 1 op + 1 = = 9 — too many)
    // Let me redo:
    //   'xx + xx = xxx' = 2 + 1 + 2 + 1 + 3 = 9 ✗
    //   'x + x = xxxxx' (5-digit) — not allowed (max 3 digits)
    //   'xxx + x = xxx' = 3+1+1+1+3 = 9 ✗
    //   'xx + x = xxx' = 2+1+1+1+3 = 8 ✓  → 1=, 1op, 5 smalls = 7 tiles ✗ (off by 1)
    //
    // Wait — let me count by tile not by position:
    // 'xx + x = xxx': two-digit + op + digit + equals + 3-digit
    //   = 2 tiles + 1 + 1 + 1 + 3 = 8 tiles ✓
    //   composition: 6 number tiles, 1 op, 1 =
    //   smalls: 6 (since smalls count tiles, each digit is one tile)
    // ✓
    { name: 'B8: xx+x=xxx',   size: 8, needs: { equals: 1, operators: 1, smalls: 6 }, baseScore: 70, hits3E: true },
    { name: 'B8: xxx+x=xx',   size: 8, needs: { equals: 1, operators: 1, smalls: 6 }, baseScore: 70, hits3E: true },
    { name: 'B8: x+xx=xxx',   size: 8, needs: { equals: 1, operators: 1, smalls: 6 }, baseScore: 70, hits3E: true },
    { name: 'B8: xx×x=xx',    size: 7, needs: { equals: 1, operators: 1, smalls: 5 }, baseScore: 35, hits3E: false }, // not Bingo
    { name: 'B8: x+x+x=xx',   size: 8, needs: { equals: 1, operators: 2, smalls: 5 }, baseScore: 75, hits3E: true },
    { name: 'B8: x+x-x=xx',   size: 8, needs: { equals: 1, operators: 2, smalls: 5 }, baseScore: 75, hits3E: true },
    { name: 'B8: x×x+x=xx',   size: 8, needs: { equals: 1, operators: 2, smalls: 5 }, baseScore: 78, hits3E: true },
    { name: 'B8: x×x×x=xx',   size: 8, needs: { equals: 1, operators: 2, smalls: 5 }, baseScore: 80, hits3E: true },
    { name: 'B8: -x+x=-x+x',  size: 8, needs: { equals: 1, operators: 3, smalls: 4 }, baseScore: 75, hits3E: true },
    { name: 'B8: -x×x=-x×x',  size: 8, needs: { equals: 1, operators: 3, smalls: 4 }, baseScore: 78, hits3E: true },

    // === 7-tile YoYo patterns (uses 7 from rack + 1 board hook, hits 3E) ===
    //   yoyo means 7 placed + 1 existing = 8-position equation
    //   For pattern modeling, treat as 7 tiles needed (board hook covers 1 slot)
    //   We assume the hook is either = or an operator (board-aware logic adjusts below)
    { name: 'Y7: x+x=xx (yoyo)', size: 7, needs: { equals: 1, operators: 1, smalls: 5 }, baseScore: 50, hits3E: true },
    { name: 'Y7: x+x+x=xx (yoyo)', size: 7, needs: { equals: 1, operators: 2, smalls: 4 }, baseScore: 55, hits3E: true },
    { name: 'Y7: x×x=xx (yoyo)', size: 7, needs: { equals: 1, operators: 1, smalls: 5 }, baseScore: 55, hits3E: true },

    // === Smaller plays (no Bingo bonus, lower scores) ===
    { name: 'M6: xx+x=x',     size: 6, needs: { equals: 1, operators: 1, smalls: 4 }, baseScore: 18, hits3E: false },
    { name: 'M5: x+x=x',      size: 5, needs: { equals: 1, operators: 1, smalls: 3 }, baseScore: 14, hits3E: false },
    { name: 'M4: x+x=x (with hook)', size: 4, needs: { equals: 0, operators: 1, smalls: 3 }, baseScore: 10, hits3E: false },
  ];

  // Sanity: validate at init that needs sums to size
  (function validatePatterns() {
    for (const p of PATTERNS) {
      const sum = (p.needs.equals || 0) + (p.needs.operators || 0) + (p.needs.smalls || 0);
      if (sum !== p.size) {
        console.warn('[Brain2] Pattern needs mismatch:', p.name, 'sum=', sum, 'size=', p.size);
      }
    }
  })();

  // ===========================================================================
  // BOARD AWARENESS
  // ===========================================================================

  // Returns true if any '=' is on the board (a potential hook for plays).
  // v1: simple presence check. Future: actual reachability via open lines.
  function boardHasReachableEquals(state) {
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = state.board.cells[r][c];
        if (cell && cell.tile) {
          const face = cell.tile.assigned || cell.tile.face;
          if (face === '=') return true;
        }
      }
    }
    return false;
  }

  // ===========================================================================
  // RACK CLASSIFICATION
  // ===========================================================================

  function classifyRack(rack) {
    const blanks = [], equals = [], operators = [], smalls = [], hards = [];
    for (const t of rack) {
      if (isBlank(t)) blanks.push(t);
      else if (isEquals(t)) equals.push(t);
      else if (isOperator(t)) operators.push(t);
      else if (isHardTile(t)) hards.push(t);
      else if (isSmallNumber(t)) smalls.push(t);
      else hards.push(t);
    }
    // Sort smalls by priority (smallest first = most preferred)
    smalls.sort((a, b) =>
      (SMALL_NUMBER_PRIORITY[a.face] || 99) - (SMALL_NUMBER_PRIORITY[b.face] || 99)
    );
    // Sort operators by keep priority: +/- > ×/÷ > - > ÷ > + > ×
    operators.sort((a, b) => operatorKeepRank(a.face) - operatorKeepRank(b.face));
    return { blanks, equals, operators, smalls, hards };
  }

  // ===========================================================================
  // KEEP-SET ENUMERATION
  // ===========================================================================

  function buildKeep(classified, numEquals, numOps, numSmalls, label) {
    const { blanks, equals, operators, smalls } = classified;
    const keepIds = new Set();
    // Always keep BLANKs
    for (const t of blanks) keepIds.add(t.id);
    // Keep unique-face equals (up to numEquals)
    const seenEq = new Set();
    for (const t of equals) {
      if (seenEq.size >= numEquals) break;
      if (!seenEq.has(t.face)) { keepIds.add(t.id); seenEq.add(t.face); }
    }
    // Keep unique-face operators
    const seenOp = new Set();
    for (const t of operators) {
      if (seenOp.size >= numOps) break;
      if (!seenOp.has(t.face)) { keepIds.add(t.id); seenOp.add(t.face); }
    }
    // Keep unique-face smalls (already sorted smallest first)
    const seenSm = new Set();
    for (const t of smalls) {
      if (seenSm.size >= numSmalls) break;
      if (!seenSm.has(t.face)) { keepIds.add(t.id); seenSm.add(t.face); }
    }
    return { id: label, keepIds, label };
  }

  function enumerateKeepSets(classified, hasBoardEquals) {
    const { blanks, equals, operators, smalls, hards } = classified;
    const candidates = [];
    const hasOwnEquals = equals.length > 0;

    // Brain 1's seed template (baseline)
    if (hasOwnEquals) {
      candidates.push(buildKeep(classified, 1, 1, 2, 'seed-B(has=)'));
    } else {
      candidates.push(buildKeep(classified, 0, 1, 1, 'seed-A(no=)'));
    }

    // Board has = → variants with 0 own = (use board hook)
    if (hasBoardEquals && hasOwnEquals) {
      candidates.push(buildKeep(classified, 0, 1, 2, 'no-eq-1op (board=)'));
      candidates.push(buildKeep(classified, 0, 2, 2, 'no-eq-2op (board=)'));
    } else if (hasBoardEquals && !hasOwnEquals) {
      candidates.push(buildKeep(classified, 0, 2, 2, 'no-own-eq-2op (board=)'));
    }

    // Extra operator
    candidates.push(buildKeep(classified, hasOwnEquals ? 1 : 0, 2, hasOwnEquals ? 2 : 1, 'extra-op'));

    // Extra small
    candidates.push(buildKeep(classified, hasOwnEquals ? 1 : 0, 1, hasOwnEquals ? 3 : 2, 'extra-small'));

    // Many smalls (aggressive)
    candidates.push(buildKeep(classified, hasOwnEquals ? 1 : 0, 1, 4, 'many-smalls'));

    // Aggressive: 2 equals + 2 op + 3 smalls
    if (equals.length >= 2) {
      candidates.push(buildKeep(classified, 1, 2, 3, 'aggressive'));
    }

    // Minimal: blanks + maybe 1 =
    candidates.push(buildKeep(classified, hasOwnEquals ? 1 : 0, 0, 0, 'minimal'));

    // Keep-all (do nothing — baseline for comparison)
    const keepAll = new Set();
    for (const t of [...blanks, ...equals, ...operators, ...smalls, ...hards]) {
      keepAll.add(t.id);
    }
    candidates.push({ id: 'keep-all', keepIds: keepAll, label: 'keep-all' });

    // De-dupe by keepIds content
    const seen = new Set();
    const unique = [];
    for (const c of candidates) {
      const key = [...c.keepIds].sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(c);
    }
    return unique;
  }

  // ===========================================================================
  // CATEGORIZE KEPT TILES (count by type)
  // ===========================================================================

  function categorizeKept(rack, keepIds) {
    const c = { blanks: 0, equals: 0, operators: 0, smalls: 0, hards: 0 };
    for (const t of rack) {
      if (!keepIds.has(t.id)) continue;
      if (isBlank(t)) c.blanks++;
      else if (isEquals(t)) c.equals++;
      else if (isOperator(t)) c.operators++;
      else if (isHardTile(t)) c.hards++;
      else if (isSmallNumber(t)) c.smalls++;
    }
    return c;
  }

  // ===========================================================================
  // EXPECTED VALUE PER KEEP SET
  //
  // The AI plays AT MOST ONE pattern per turn — so EV should reflect the
  // BEST single pattern that completes, not the SUM of all possible patterns.
  //
  // Approach: For each pattern, compute (P_complete × score). Sort by this product.
  // Use a conditional-style approximation: assume the AI plays the highest-scoring
  // pattern that's available. EV ≈ max over patterns of (P × score).
  //
  // For better discrimination between similar keep sets, we use a softened sum:
  //   EV = max + 0.25 * (second_best + 0.5 * third_best)
  // This rewards keep sets that have backup patterns, but the dominant term is max.
  // ===========================================================================

  function expectedScoreForKeep(state, candidate, pool, hasBoardEquals) {
    const rack = state.aiRack.tiles;
    const kept = categorizeKept(rack, candidate.keepIds);
    const keepSize = candidate.keepIds.size;
    const drawsAvailable = rack.length - keepSize;

    if (drawsAvailable <= 0) {
      // Rack full of keepers — no swap. Floor EV if rack has = + op + smalls (can play as-is).
      let floor = 0;
      if (kept.equals > 0 && kept.operators > 0 && kept.smalls >= 2) floor = 8;
      return { ev: floor, perPattern: [], drawsAvailable: 0 };
    }

    const contributions = []; // { pattern, p, score, ev }

    for (const p of PATTERNS) {
      let missEq = Math.max(0, (p.needs.equals || 0) - kept.equals);
      let missOp = Math.max(0, (p.needs.operators || 0) - kept.operators);
      let missSm = Math.max(0, (p.needs.smalls || 0) - kept.smalls);

      // Board has = → patterns of size ≤ 7 (hook plays) don't need own =
      if (hasBoardEquals && p.size <= 7) {
        missEq = 0;
      }

      // BLANKs in keep act as wildcards (cover Eq first, then Op, then Sm)
      let availBlanks = kept.blanks;
      const useEq = Math.min(missEq, availBlanks); missEq -= useEq; availBlanks -= useEq;
      const useOp = Math.min(missOp, availBlanks); missOp -= useOp; availBlanks -= useOp;
      const useSm = Math.min(missSm, availBlanks); missSm -= useSm; availBlanks -= useSm;

      const totalMissing = missEq + missOp + missSm;
      if (totalMissing > drawsAvailable) continue;

      // SIZE CHECK: the pattern requires `p.size` tiles total.
      // Kept tiles that match the pattern + drawn tiles must reach p.size.
      //
      // Useful kept tiles (counted toward pattern size):
      //   - up to needs.equals of kept equals
      //   - up to needs.operators of kept operators
      //   - up to needs.smalls of kept smalls
      //   - blanks used to fill missing requirements (useEq+useOp+useSm)
      //   - remaining unused blanks (still take up tile slots in pattern as wildcards)
      const usefulKept = Math.min(kept.equals, p.needs.equals || 0)
                       + Math.min(kept.operators, p.needs.operators || 0)
                       + Math.min(kept.smalls, p.needs.smalls || 0)
                       + (useEq + useOp + useSm)        // blanks placed in missing slots
                       + availBlanks;                    // unused blanks (still consume a slot)
      const tilesStillNeededForSize = p.size - usefulKept;

      // If we'd need to draw more than possible, skip
      if (tilesStillNeededForSize > drawsAvailable) continue;
      // If we don't need to draw anything (overshoot), the pattern is already complete or
      // overspecified — count it as fully complete
      if (tilesStillNeededForSize <= 0) {
        // We already have enough useful tiles — basically certain to play this pattern
        let scoreEst = p.baseScore;
        if (p.hits3E && p.size === 8) scoreEst *= 1.3;
        contributions.push({ pattern: p.name, p: 1.0, score: scoreEst, ev: scoreEst });
        continue;
      }

      // P(draw needed tiles by category) — the categorical missing
      const needs = { equals: missEq, operators: missOp, smalls: missSm };
      const pComplete = hyperProbAllNeeded(pool, needs, drawsAvailable);

      let scoreEst = p.baseScore;
      if (p.hits3E && p.size === 8) scoreEst *= 1.3;

      const ev = pComplete * scoreEst;
      contributions.push({ pattern: p.name, p: pComplete, score: scoreEst, ev: ev });
    }

    // Sort by EV descending — we care about the best single pattern
    contributions.sort((a, b) => b.ev - a.ev);

    // EV = best pattern + small bonus for backup patterns
    // (rewards keep sets with multiple viable patterns, but dominated by max)
    let totalEv = 0;
    if (contributions.length > 0) totalEv = contributions[0].ev;
    if (contributions.length > 1) totalEv += 0.25 * contributions[1].ev;
    if (contributions.length > 2) totalEv += 0.10 * contributions[2].ev;

    return {
      ev: totalEv,
      perPattern: contributions.filter(c => c.p > 0.005),
      drawsAvailable: drawsAvailable
    };
  }

  // ===========================================================================
  // MAIN ENTRY POINT
  // ===========================================================================

  function computeSwapTiles_brain2(state) {
    const rack = state.aiRack.tiles;
    if (rack.length === 0) {
      return { tileIds: [], reasoning: 'Brain2: empty rack' };
    }

    const pool = predictUnseenPool(state);
    const classified = classifyRack(rack);
    const hasBoardEquals = boardHasReachableEquals(state);

    const candidates = enumerateKeepSets(classified, hasBoardEquals);

    let best = null;
    const summaries = [];
    for (const cand of candidates) {
      const result = expectedScoreForKeep(state, cand, pool, hasBoardEquals);
      summaries.push({ label: cand.label, ev: result.ev, size: cand.keepIds.size, perPattern: result.perPattern });
      if (!best || result.ev > best.ev) {
        best = { candidate: cand, ev: result.ev, perPattern: result.perPattern };
      }
    }

    if (!best) {
      return { tileIds: rack.map(t => t.id), reasoning: 'Brain2: no candidate (fallback)' };
    }

    const toSwap = rack.filter(t => !best.candidate.keepIds.has(t.id)).map(t => t.id);

    // Logging: pick top probabilities for Bingo and YoYo for visibility
    let pBingo = 0, pYoyo = 0;
    for (const pp of best.perPattern) {
      if (pp.pattern.indexOf('B8') === 0) pBingo = Math.max(pBingo, pp.p);
      if (pp.pattern.indexOf('Y7') === 0) pYoyo = Math.max(pYoyo, pp.p);
    }

    const topN = Math.min(4, summaries.length);
    const topLabels = summaries
      .slice()
      .sort((a, b) => b.ev - a.ev)
      .slice(0, topN)
      .map(s => s.label + '=' + s.ev.toFixed(1))
      .join(' ');

    const reasoning =
      'Brain2: candidates=' + summaries.length +
      ' best=' + best.candidate.label +
      ' E[score]=' + best.ev.toFixed(1) +
      ' (P_bingo=' + pBingo.toFixed(2) + ', P_yoyo=' + pYoyo.toFixed(2) + ')' +
      ' swap=' + toSwap.length +
      ' boardEq=' + (hasBoardEquals ? 'Y' : 'N') +
      ' top' + topN + '=[' + topLabels + ']';

    return { tileIds: toSwap, reasoning: reasoning };
  }

  // ===========================================================================
  // FUTURE EXTENSION POINTS (stubs)
  // ===========================================================================

  // function leaveEquityLookup(keepFaces) { /* TODO */ }
  // function monteCarloPatternMatch(keepSet, pool, draws, iterations) { /* TODO */ }
  // function varianceAwareObjective(ev, variance, scoreDelta) { /* TODO */ }
  // function endgameMinimax(state, depth) { /* TODO */ }

  // ===========================================================================
  // EXPORTS
  // ===========================================================================

  window.AMath = window.AMath || {};
  window.AMath.aiSwapBrain2 = {
    computeSwapTiles_brain2: computeSwapTiles_brain2,
    // Expose helpers for testing
    _predictUnseenPool: predictUnseenPool,
    _hyperProbExact: hyperProbExact,
    _hyperProbAtLeast: hyperProbAtLeast,
    _PATTERNS: PATTERNS,
  };
})();
