/**
 * A-Math AI — Smart Swap Strategy v2
 *
 * Philosophy: KEEP seed tiles for next-turn Bingo; SWAP everything else.
 *
 * Per user spec:
 *   Scenario A (rack has NO =):
 *     Keep: all BLANKs + 1 operator + 1 smallest number
 *   Scenario B (rack has =):
 *     Keep: all BLANKs + 1 = + 1 operator + 2 smallest numbers
 *
 *   Bag prediction overlay:
 *     - If unseen operator ratio < 15% → keep 2 operators instead of 1
 *     - If unseen small-number ratio < 20% → keep 1 extra small number
 *
 *   Hard tiles (0, 5, 10-20): never kept — always swap
 *   Small numbers: 1, 2, 3, 4, 6, 7, 8, 9 (single digits except hard tiles 0, 5)
 *     Keep smallest first (1 > 2 > 3 > 4 > 6 > 7 > 8 > 9)
 */

(function () {
  const C = window.AMath.constants;

  // Small-number priority (lower index = more preferred to keep)
  const SMALL_NUMBER_PRIORITY = {
    '1': 1, '2': 2, '3': 3, '4': 4,
    '6': 5, '7': 6, '8': 7, '9': 8,
  };

  // Hard tile faces (never keep in swap strategy)
  const HARD_TILE_FACES = new Set([
    '0', '5', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  ]);

  // In Mathayom, two-digit tiles vary in difficulty:
  //   Easy to use (many factors, keep these): 10, 12, 14, 16, 18
  //   Hard to use (prime/÷5, swap first): 11, 13, 15, 17, 19, 20
  const MATHAYOM_EASY_TWODIGIT = new Set(['10', '12', '14', '16', '18']);
  const MATHAYOM_HARD_TWODIGIT = new Set(['11', '13', '15', '17', '19', '20']);

  // Expendability score for Mathayom two-digit tiles (higher = swap sooner)
  const MATHAYOM_TWODIGIT_SWAP_PRIORITY = {
    '19': 100, '17': 95, '13': 90, '11': 85, // primes — hardest to use
    '15': 80, '20': 75,                        // ÷5 — need a 5 tile
    '14': 40, '16': 35, '18': 30,              // even composites — easier
    '12': 25, '10': 20,                         // very flexible — keep longest
  };

  function isSmallNumber(tile) {
    if (!tile || tile.type !== 'digit') return false;
    return SMALL_NUMBER_PRIORITY[tile.face] !== undefined;
  }

  function isOperator(tile) {
    if (!tile) return false;
    return tile.type === 'op' || tile.type === 'choice';
  }

  function isEquals(tile) {
    return tile && tile.type === 'equals';
  }

  function isBlank(tile) {
    return tile && tile.type === 'blank';
  }

  function isHardTile(tile) {
    if (!tile || !tile.face) return false;
    // Specials are never hard
    if (tile.type === 'op' || tile.type === 'choice' ||
        tile.type === 'equals' || tile.type === 'blank') {
      return false;
    }
    return HARD_TILE_FACES.has(tile.face);
  }

  /**
   * Predict bag composition.
   * Returns { unseenTotal, unseenHard, unseenOps, unseenSmall,
   *           hardRatio, opRatio, smallRatio }
   */
  function predictBag(state) {
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

    const smallFaces = new Set(['1', '2', '3', '4', '6', '7', '8', '9']);
    const opFaces = new Set(['+', '-', '×', '÷', '+/-', '×/÷']);

    let unseenTotal = 0, unseenHard = 0, unseenOps = 0, unseenSmall = 0;

    for (const def of inventory) {
      const remaining = def.count - (seen[def.face] || 0);
      if (remaining > 0) {
        unseenTotal += remaining;
        if (HARD_TILE_FACES.has(def.face)) unseenHard += remaining;
        if (opFaces.has(def.face)) unseenOps += remaining;
        if (smallFaces.has(def.face)) unseenSmall += remaining;
      }
    }

    return {
      unseenTotal: unseenTotal,
      unseenHard: unseenHard,
      unseenOps: unseenOps,
      unseenSmall: unseenSmall,
      hardRatio: unseenTotal > 0 ? unseenHard / unseenTotal : 0,
      opRatio: unseenTotal > 0 ? unseenOps / unseenTotal : 0,
      smallRatio: unseenTotal > 0 ? unseenSmall / unseenTotal : 0,
    };
  }

  /**
   * Compute swap tiles using seed-keeping strategy.
   *
   * @returns { tileIds: [string], reasoning: string }
   */
  function computeSwapTiles(state) {
    const rack = state.aiRack.tiles;
    if (rack.length === 0) return { tileIds: [], reasoning: 'empty rack' };

    const bagInfo = predictBag(state);
    const hasEquals = rack.some(isEquals);

    // Determine keep targets based on scenario + bag prediction
    let keepOpsTarget = 1;
    let keepSmallTarget = hasEquals ? 2 : 1;
    let keepEqualsTarget = hasEquals ? 1 : 0;  // keep 1 = for equations; 2nd = always swap

    // BEGINNING PHASE: when bingo-fishing (early game), keep 2 operators
    // because bingo equations typically need 2+ operators (e.g., 3+4-2+1=5+3)
    const aiSwaps = (state.aiConsecutiveSwaps || 0);
    const aiPlays = (state.aiActualPlayCount || 0);
    const isBeginning = aiPlays === 0; // haven't played any tiles yet
    if (isBeginning) {
      keepOpsTarget = 2; // keep both operators for bingo
    }

    // Bag prediction overlay
    if (bagInfo.opRatio < 0.15) {
      keepOpsTarget = Math.max(keepOpsTarget, 2);  // keep an extra operator
    }
    if (bagInfo.smallRatio < 0.20) {
      keepSmallTarget += 1;  // keep an extra small number
    }

    // Classify tiles into keep/swap lists
    const keepIds = new Set();

    // 1. Always keep BLANKs
    for (const t of rack) {
      if (isBlank(t)) keepIds.add(t.id);
    }

    // 2. Keep up to keepEqualsTarget = tiles
    const equalsTiles = rack.filter(isEquals);
    for (let i = 0; i < Math.min(keepEqualsTarget, equalsTiles.length); i++) {
      keepIds.add(equalsTiles[i].id);
    }

    // 3. Keep operators — by default 1 unique face; if low op ratio, up to keepOpsTarget unique faces
    const opTiles = rack.filter(isOperator);
    const keptOpFaces = new Set();
    for (const op of opTiles) {
      if (keptOpFaces.size >= keepOpsTarget) break;
      if (keptOpFaces.has(op.face)) continue; // skip duplicates of already-kept face
      keepIds.add(op.id);
      keptOpFaces.add(op.face);
    }
    // Fallback for duplicates: if bag has LOW op ratio AND we couldn't reach target unique count,
    // allow 1 duplicate to fill the slot
    const lowOpsBag = bagInfo.opRatio < 0.15;
    if (lowOpsBag && keptOpFaces.size < keepOpsTarget) {
      for (const op of opTiles) {
        if (keepIds.has(op.id)) continue;
        keepIds.add(op.id);
        break; // only add 1 duplicate
      }
    }

    // 4. Keep small numbers — by default unique faces sorted by priority (smallest first)
    const smallTiles = rack.filter(isSmallNumber)
      .sort(function (a, b) {
        return SMALL_NUMBER_PRIORITY[a.face] - SMALL_NUMBER_PRIORITY[b.face];
      });
    const keptSmallFaces = new Set();
    for (const t of smallTiles) {
      if (keptSmallFaces.size >= keepSmallTarget) break;
      if (keptSmallFaces.has(t.face)) continue; // skip duplicate face
      keepIds.add(t.id);
      keptSmallFaces.add(t.face);
    }
    // Fallback for small-number duplicates: if bag has LOW small ratio AND we couldn't reach target,
    // allow 1 duplicate
    const lowSmallBag = bagInfo.smallRatio < 0.20;
    if (lowSmallBag && keptSmallFaces.size < keepSmallTarget) {
      for (const t of smallTiles) {
        if (keepIds.has(t.id)) continue;
        keepIds.add(t.id);
        break; // only add 1 duplicate
      }
    }

    // 5. Mathayom: keep 1 "easy" two-digit tile IF we have × or ÷ to pair with it
    const tileSet = (C.getStateSetting || function () { return 'prathom'; })('tileSet', 'prathom');
    const isMathayom = (function () {
      try { return (window.AMath.settings.get('tileSet') || 'prathom') === 'mathayom'; } catch (e) { return false; }
    })();
    if (isMathayom) {
      const hasMulDiv = rack.some(function (t) {
        return t.face === '×' || t.face === '÷' || t.face === '×/÷' || t.type === 'blank';
      });
      if (hasMulDiv) {
        // Keep 1 easy two-digit tile (prefer lowest swap priority = most useful)
        const easyTwoDigits = rack.filter(function (t) {
          return t.type === 'twodigit' && MATHAYOM_EASY_TWODIGIT.has(t.face) && !keepIds.has(t.id);
        }).sort(function (a, b) {
          return (MATHAYOM_TWODIGIT_SWAP_PRIORITY[a.face] || 50) - (MATHAYOM_TWODIGIT_SWAP_PRIORITY[b.face] || 50);
        });
        if (easyTwoDigits.length > 0) {
          keepIds.add(easyTwoDigits[0].id);
        }
      }
    }

    // Swap = everything NOT in keepIds
    const toSwap = rack.filter(function (t) { return !keepIds.has(t.id); }).map(function (t) { return t.id; });

    // Edge case: if swap list is empty (rack is all keepers), force-swap 1 most expendable tile.
    //
    // Expendability order (most expendable first → pick to swap):
    //   1. Hard tiles (0, 5, 10-20) — always worst
    //   2. Excess = tiles (we already kept 1; extra = is wasteful)
    //   3. Excess operator tiles (we already kept 1, low value)
    //   4. Excess small tiles (duplicates of kept small)
    //   5. Larger small numbers (9 > 8 > ... > 1)
    //   6. Kept operator
    //   7. Kept =
    //   8. BLANK — NEVER swap
    if (toSwap.length === 0) {
      console.warn('[AI Swap] Rare case: all tiles are keepers. Force-swapping least valuable.');
      // Track which "kept" tiles are already in keepIds vs duplicates of those keepers
      // Build a quick lookup of "which face has at least one kept tile"
      const keptFacesByCategory = {
        equals: new Set(),
        op: new Set(),
        small: new Set(),
      };
      for (const t of rack) {
        if (!keepIds.has(t.id)) continue;
        if (isEquals(t)) keptFacesByCategory.equals.add(t.face);
        else if (isOperator(t)) keptFacesByCategory.op.add(t.face);
        else if (isSmallNumber(t)) keptFacesByCategory.small.add(t.face);
      }

      let mostExpendable = null;
      let bestExpendabilityScore = -Infinity; // higher = more expendable

      for (const t of rack) {
        if (isBlank(t)) continue; // never swap BLANK

        let score; // higher = more swap-worthy
        if (isHardTile(t)) {
          // In Mathayom, differentiate two-digit tiles by difficulty
          if (isMathayom && t.type === 'twodigit' && MATHAYOM_TWODIGIT_SWAP_PRIORITY[t.face] !== undefined) {
            score = 900 + MATHAYOM_TWODIGIT_SWAP_PRIORITY[t.face]; // 920-1000 range
          } else {
            score = 1000; // most expendable
          }
        } else if (isEquals(t)) {
          // Duplicate = (face kept elsewhere, but not this id): very expendable
          // Kept = : barely expendable
          score = (keptFacesByCategory.equals.has(t.face) && !keepIds.has(t.id)) ? 800 : 10;
        } else if (isOperator(t)) {
          // Duplicate operator: very expendable; kept operator: low
          score = (keptFacesByCategory.op.has(t.face) && !keepIds.has(t.id)) ? 700 : 50;
        } else if (isSmallNumber(t)) {
          // Duplicate small (face kept elsewhere, but not this id): very expendable
          if (keptFacesByCategory.small.has(t.face) && !keepIds.has(t.id)) {
            score = 600;
          } else {
            // Larger small numbers more expendable than smaller
            // 1 → 101, 2 → 102, ..., 9 → 108
            score = 100 + SMALL_NUMBER_PRIORITY[t.face];
          }
        } else {
          score = 500; // unknown type, medium expendability
        }

        if (score > bestExpendabilityScore) {
          bestExpendabilityScore = score;
          mostExpendable = t;
        }
      }
      if (mostExpendable) toSwap.push(mostExpendable.id);
    }

    const reasoning =
      'scenario=' + (hasEquals ? 'B(has=)' : 'A(no=)') +
      ' keep=[B*' + (rack.filter(isBlank).length) +
      ' =*' + keepEqualsTarget +
      ' op*' + keepOpsTarget +
      ' small*' + keepSmallTarget + ']' +
      ' bag(op=' + bagInfo.opRatio.toFixed(2) +
      ' small=' + bagInfo.smallRatio.toFixed(2) + ')' +
      ' swap=' + toSwap.length;

    return {
      tileIds: toSwap,
      reasoning: reasoning,
    };
  }

  window.AMath = window.AMath || {};
  window.AMath.aiSwap = {
    computeSwapTiles: computeSwapTiles,
    predictBag: predictBag,
  };
})();
