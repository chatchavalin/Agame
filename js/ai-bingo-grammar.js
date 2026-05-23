/**
 * A-Math AI — Grammar-Based Bingo Search (Stage 1)
 *
 * Instead of matching against fixed patterns (like the existing ai-bingo-fast),
 * this module GENERATES all possible equation shapes of size N from A-Math's
 * grammar rules. This provides near-100% coverage of valid Bingo equations.
 *
 * Grammar:
 *   EQUATION → SIDE = SIDE
 *   EQUATION → SIDE = SIDE = SIDE  (chained equations)
 *   SIDE     → TERM | TERM OP TERM | TERM OP TERM OP TERM | ...
 *   TERM     → NUMBER | -NUMBER  (unary minus)
 *   NUMBER   → x | xx | xxx       (1, 2, or 3 digit-cells)
 *   OP       → + | - | × | ÷
 *
 * A "shape" is a sequence of slot specs like:
 *   [NUM(2), +, NUM(1), =, NUM(3)]  → represents `xx + x = xxx`
 *
 * For size-9 Bingos:
 *   We enumerate shapes where total cells == 9 (number cells + op cells + equals cells).
 *
 * Compared to ai-bingo-fast.js (template-based):
 *   ✓ Catches ALL shapes the grammar allows, not just hand-curated patterns
 *   ✓ Handles choice tiles (+/-, ×/÷) by trying both operator alternatives
 *   ✓ Handles unary minus correctly (the '-' consumes a tile)
 *   ✓ Handles multi-equals chained equations
 *   ✓ Predictable: shape generation is bounded, not a function of rack
 *
 * Performance budget:
 *   - Shape generation: ~200 shapes for size 9, computed once at startup (cached)
 *   - Anchor iteration: ~50-200 board anchors
 *   - Per-anchor: shape compatibility filter + slot assignment
 *   - Expected: 1-10 seconds typical, hard-capped by user budget
 */

(function () {
  const C = window.AMath.constants;
  const Board = window.AMath.board;
  const Eval = window.AMath.evaluator;
  const Scoring = window.AMath.scoring;
  const Placement = window.AMath.placement;

  // ========================================================================
  // SHAPE GENERATION
  // A "shape" is an array of slot specs.
  // Slot types:
  //   { kind: 'num', size: 1|2|3, unary: '-'|null }
  //   { kind: 'op', op: '+'|'-'|'×'|'÷' }
  //   { kind: 'eq' }
  // ========================================================================

  // Cache shapes by cell count
  const SHAPE_CACHE = {};

  /**
   * Generate all valid equation shapes of exactly `totalCells` cells.
   * Returns an array of shapes (each a list of slots).
   */
  function generateShapes(totalCells) {
    if (SHAPE_CACHE[totalCells]) return SHAPE_CACHE[totalCells];

    const shapes = [];

    // An equation has 2-3 sides separated by '=' signs.
    // For each possible split into sides, generate side shapes.
    // Total cells = sum of side cell counts + (numSides - 1) for '=' tiles.

    for (let numSides = 2; numSides <= 3; numSides++) {
      const equalsCount = numSides - 1;
      const cellsForSides = totalCells - equalsCount;
      if (cellsForSides < numSides) continue;     // each side needs at least 1 cell

      // Distribute cellsForSides across numSides sides
      // Each side: at least 1 cell, at most cellsForSides - (numSides - 1)
      distributeAcrossSides(cellsForSides, numSides, function (sideCellsList) {
        // For each side, generate possible side shapes
        generateSideShapesCartesian(sideCellsList, 0, [], function (sideShapesList) {
          // Combine sides with '=' separators
          const shape = [];
          for (let i = 0; i < sideShapesList.length; i++) {
            for (const slot of sideShapesList[i]) shape.push(slot);
            if (i < sideShapesList.length - 1) shape.push({ kind: 'eq' });
          }
          shapes.push(shape);
        });
      });
    }

    SHAPE_CACHE[totalCells] = shapes;
    return shapes;
  }

  /**
   * Yield all distributions of `total` cells across `n` sides, each side having ≥1 cell.
   * Calls callback(sideCellsList) for each distribution.
   */
  function distributeAcrossSides(total, n, callback) {
    function recur(remaining, sidesLeft, acc) {
      if (sidesLeft === 1) {
        if (remaining >= 1) callback(acc.concat([remaining]));
        return;
      }
      for (let s = 1; s <= remaining - (sidesLeft - 1); s++) {
        recur(remaining - s, sidesLeft - 1, acc.concat([s]));
      }
    }
    recur(total, n, []);
  }

  /**
   * For each side in sideCellsList, generate all possible side shapes.
   * Combine via Cartesian product. Call callback for each combination.
   */
  function generateSideShapesCartesian(sideCellsList, idx, accumulator, callback) {
    if (idx === sideCellsList.length) {
      callback(accumulator);
      return;
    }
    const cells = sideCellsList[idx];
    const sideShapes = generateSideShapes(cells);
    for (const ss of sideShapes) {
      generateSideShapesCartesian(sideCellsList, idx + 1, accumulator.concat([ss]), callback);
    }
  }

  // Cache side shapes by cell count
  const SIDE_SHAPE_CACHE = {};

  /**
   * Generate all valid SIDE shapes with exactly `cells` cells.
   * SIDE = TERM | TERM OP SIDE
   * Each TERM is 1-3 digit cells, optionally preceded by unary '-'
   * Each OP is exactly 1 cell.
   *
   * For `cells` total: cells = sum(termSizes) + (numTerms - 1 ops) + unaryCount
   * where unaryCount is the number of terms with unary minus.
   *
   * Constraints:
   *   - Each term: 1, 2, or 3 digit cells
   *   - Unary minus allowed only on first term of a side (or after = sign in grammar,
   *     but we're at SIDE level so just on first term)
   *   - Wait: looking at project knowledge, unary minus can appear in MIDDLE too:
   *     e.g., `x = x - x` is binary minus. But `-x + x = x × x` has unary at start.
   *     `x + x = -xx` has unary at start of RHS side.
   *     Within a single side, unary only at start.
   */
  function generateSideShapes(cells) {
    if (SIDE_SHAPE_CACHE[cells]) return SIDE_SHAPE_CACHE[cells];

    const shapes = [];

    // Recursively build: emit TERM, then optionally emit OP+SIDE
    function recur(remaining, isFirstTerm, acc) {
      if (remaining <= 0) {
        if (remaining === 0 && acc.length > 0) shapes.push(acc.slice());
        return;
      }

      // Try unary minus on this term (only on first term of side)
      const unaryOptions = isFirstTerm ? [null, '-'] : [null];

      for (const unary of unaryOptions) {
        const unaryCost = (unary === '-') ? 1 : 0;
        // Try term sizes 1, 2, 3
        for (let size = 1; size <= 3; size++) {
          const termCost = size + unaryCost;
          if (termCost > remaining) break;

          // Add this term
          acc.push({ kind: 'num', size: size, unary: unary });

          const after = remaining - termCost;

          if (after === 0) {
            // Side complete with this term
            shapes.push(acc.slice());
          } else if (after >= 2) {
            // Must have at least: 1 op + 1 num = 2 more cells
            // Try each operator
            for (const op of ['+', '-', '×', '÷']) {
              acc.push({ kind: 'op', op: op });
              recur(after - 1, false, acc);
              acc.pop();
            }
          }

          acc.pop();
        }
      }
    }

    recur(cells, true, []);
    SIDE_SHAPE_CACHE[cells] = shapes;
    return shapes;
  }

  // ========================================================================
  // RACK COMPATIBILITY CHECK
  // ========================================================================

  /**
   * Categorize rack tiles by type + face.
   * Returns: { digits: [tile], twodigits: [tile], opByFace: { '+': [...], '-': [...], ... },
   *            choiceOps: [tile], equals: [tile], blanks: [tile] }
   */
  function categorizeRack(tiles) {
    const result = {
      digits: [],
      twodigits: [],
      opByFace: { '+': [], '-': [], '×': [], '÷': [] },
      choicePM: [],   // +/- tiles
      choiceMD: [],   // ×/÷ tiles
      equals: [],
      blanks: [],
    };
    for (const t of tiles) {
      if (t.type === 'digit') result.digits.push(t);
      else if (t.type === 'twodigit') result.twodigits.push(t);
      else if (t.type === 'op') {
        if (result.opByFace[t.face]) result.opByFace[t.face].push(t);
      } else if (t.type === 'choice') {
        if (t.face === '+/-') result.choicePM.push(t);
        else if (t.face === '×/÷') result.choiceMD.push(t);
      } else if (t.type === 'equals') result.equals.push(t);
      else if (t.type === 'blank') result.blanks.push(t);
    }
    return result;
  }

  /**
   * Quick filter: can this shape POSSIBLY be filled by the rack?
   * Returns true if rack has enough of each tile type (counting BLANK as wildcard).
   */
  function isShapeCompatible(shape, rackCat) {
    let numDigitCells = 0;
    let numUnaryMinus = 0;
    let opNeeded = { '+': 0, '-': 0, '×': 0, '÷': 0 };
    let equalsNeeded = 0;

    for (const slot of shape) {
      if (slot.kind === 'num') {
        numDigitCells += slot.size;
        if (slot.unary === '-') numUnaryMinus++;
      } else if (slot.kind === 'op') {
        opNeeded[slot.op]++;
      } else if (slot.kind === 'eq') {
        equalsNeeded++;
      }
    }

    // Total tiles needed
    const totalTilesNeeded = numDigitCells + numUnaryMinus +
                              opNeeded['+'] + opNeeded['-'] + opNeeded['×'] + opNeeded['÷'] +
                              equalsNeeded;

    // Total tiles available
    const haveDigits = rackCat.digits.length + rackCat.twodigits.length;  // for size-1 slots
    const haveDigitCells = rackCat.digits.length;                          // for multi-digit slots
    const haveBlanks = rackCat.blanks.length;
    const haveOps = rackCat.opByFace['+'].length + rackCat.opByFace['-'].length +
                     rackCat.opByFace['×'].length + rackCat.opByFace['÷'].length;
    const haveChoiceOps = rackCat.choicePM.length + rackCat.choiceMD.length;
    const haveEquals = rackCat.equals.length;
    const totalTilesAvail = haveDigits + haveBlanks + haveOps + haveChoiceOps + haveEquals;

    if (totalTilesAvail < totalTilesNeeded) return false;

    // Multi-digit slots (xx, xxx) need DIGIT tiles (not twodigit). BLANKs can substitute.
    let multiDigitCells = 0;
    for (const slot of shape) {
      if (slot.kind === 'num' && slot.size > 1) multiDigitCells += slot.size;
    }
    if (haveDigitCells + haveBlanks < multiDigitCells) return false;

    // Operators: count how many of each we have (incl. choice tiles + blanks as wildcards)
    // For each op type needed, check we can supply it.
    // +/- choice tiles can fill + or -; ×/÷ choice tiles can fill × or ÷.
    // BLANKs can fill anything.
    //
    // Compute total "+ or -" demand vs "+ or - flex supply"
    const pmDemand = opNeeded['+'] + opNeeded['-'];
    const pmFlexSupply = rackCat.opByFace['+'].length + rackCat.opByFace['-'].length + rackCat.choicePM.length;
    const mdDemand = opNeeded['×'] + opNeeded['÷'];
    const mdFlexSupply = rackCat.opByFace['×'].length + rackCat.opByFace['÷'].length + rackCat.choiceMD.length;

    // Unary minus consumes a '-' tile (or BLANK or +/- choice as '-')
    const dashDemand = numUnaryMinus + opNeeded['-'];
    const dashSupply = rackCat.opByFace['-'].length + rackCat.choicePM.length;
    // (We could be more precise here, but this is an over-approximation)

    // Heuristic check: total op-like demand vs total op-like supply (incl. blanks)
    const opLikeDemand = opNeeded['+'] + opNeeded['-'] + opNeeded['×'] + opNeeded['÷'] + numUnaryMinus;
    const opLikeSupply = haveOps + haveChoiceOps + haveBlanks;
    if (opLikeSupply < opLikeDemand) return false;

    // Equals
    if (haveEquals + haveBlanks < equalsNeeded) return false;

    return true;
  }

  // ========================================================================
  // SLOT ASSIGNMENT
  // Given a shape and rack, try to fill it with tiles to produce a valid equation.
  // ========================================================================

  /**
   * Try to assign rack tiles to shape's slots.
   *
   * KEY OPTIMIZATION: Side-based algebraic search.
   *
   * Instead of left-to-right token-by-token enumeration (which explodes on BLANKs),
   * we:
   *   1. Split shape into sides (separated by '=')
   *   2. For each side, enumerate possible (tile assignment → numeric value) pairs
   *   3. Find combinations of side assignments where ALL sides have the same value
   *
   * This is asymptotically much faster because:
   *   - Each side's enumeration is independent
   *   - We use a hashmap of value → assignment to find matches in O(1)
   *   - BLANKs in number slots only need to enumerate values that COULD work,
   *     not full 0-9 cross-product
   */
  function tryAssignShape(shape, rackCat, deadline) {
    // Split shape into sides by '=' separators
    const sides = [];
    let currentSide = [];
    for (const slot of shape) {
      if (slot.kind === 'eq') {
        sides.push(currentSide);
        currentSide = [];
      } else {
        currentSide.push(slot);
      }
    }
    sides.push(currentSide);
    if (sides.length < 2) return null;

    // Build a mutable pool (cloned once)
    const pool = clonePool(rackCat);

    // Recursively process sides:
    //   - Enumerate first side's possible (value, tokens) using in-place pool mutation
    //   - For each, recurse into next side(s) requiring matching value
    //   - At end of last side: success!

    let result = null;
    let timedOut = false;

    function recur(sideIdx, targetValue, accumulatedTokens) {
      if (timedOut) return;
      if (result) return;     // already found

      if (sideIdx >= sides.length) return;
      const side = sides[sideIdx];
      const isLast = (sideIdx === sides.length - 1);

      // Enumerate this side
      enumerateSideMutating(side, pool, targetValue, deadline, function (value, sideTokens) {
        if (timedOut || result) return true;     // tell enumerator to stop

        if (isLast) {
          // All sides matched
          result = { tokens: accumulatedTokens.concat(sideTokens) };
          return true;
        }

        // Try to consume an equals tile for the separator
        const eqOpt = consumeEqualsInPlace(pool);
        if (!eqOpt) return false;

        // Recurse to next side, requiring this value
        const newAccumulated = accumulatedTokens.concat(sideTokens).concat([eqOpt.eqToken]);
        recur(sideIdx + 1, value, newAccumulated);
        eqOpt.undo();

        return result !== null;
      });
    }

    recur(0, null, []);

    if (timedOut) return { timeout: true };
    return result;
  }

  /**
   * Enumerate this side with in-place pool mutation.
   * Calls callback(value, tokens) for each valid assignment.
   * If callback returns true, stops enumeration.
   */
  function enumerateSideMutating(side, pool, targetValue, deadline, callback) {
    let stopped = false;

    function recur(slotIdx, slotValues, slotTokens) {
      if (stopped) return;
      if (deadline && Date.now() > deadline) return;

      if (slotIdx >= side.length) {
        const value = computeSideValue(side, slotValues);
        if (value === null) return;
        if (!Number.isInteger(value)) return;
        if (Math.abs(value) > 99999) return;
        if (targetValue !== null && value !== targetValue) return;

        const tokens = flattenSideTokens(side, slotTokens);
        if (callback(value, tokens)) {
          stopped = true;
        }
        return;
      }

      const slot = side[slotIdx];

      if (slot.kind === 'op') {
        for (const opt of opOptions(pool, slot.op)) {
          slotTokens[slotIdx] = { kind: 'op', tile: opt.tile, face: slot.op, assigned: opt.assigned };
          slotValues[slotIdx] = slot.op;
          recur(slotIdx + 1, slotValues, slotTokens);
          opt.undo();
          if (stopped) return;
        }
      } else if (slot.kind === 'num') {
        for (const numOpt of numberOptions(slot, pool)) {
          slotTokens[slotIdx] = numOpt.tokens;
          slotValues[slotIdx] = numOpt.value;
          recur(slotIdx + 1, slotValues, slotTokens);
          numOpt.undo();
          if (stopped) return;
        }
      }
    }

    recur(0, [], []);
  }

  /**
   * In-place equals consumption.
   * Returns { eqToken, undo } or null.
   */
  function consumeEqualsInPlace(pool) {
    if (pool.equals.length > 0) {
      const t = pool.equals.pop();
      return {
        eqToken: { tile: t, face: '=', assigned: null },
        undo: function () { pool.equals.push(t); },
      };
    }
    if (pool.blanks.length > 0) {
      const t = pool.blanks.pop();
      return {
        eqToken: { tile: t, face: '=', assigned: '=' },
        undo: function () { pool.blanks.push(t); },
      };
    }
    return null;
  }

  function clonePool(rackCat) {
    return {
      digits: rackCat.digits.slice(),
      twodigits: rackCat.twodigits.slice(),
      blanks: rackCat.blanks.slice(),
      opByFace: {
        '+': rackCat.opByFace['+'].slice(),
        '-': rackCat.opByFace['-'].slice(),
        '×': rackCat.opByFace['×'].slice(),
        '÷': rackCat.opByFace['÷'].slice(),
      },
      choicePM: rackCat.choicePM.slice(),
      choiceMD: rackCat.choiceMD.slice(),
      equals: rackCat.equals.slice(),
    };
  }

  /**
   * Try to consume one '=' tile from pool (either a real = or a BLANK).
   * Returns { pool: newPool, eqToken: {tile, assigned} } or null.
   */
  function consumeEquals(pool) {
    if (pool.equals.length > 0) {
      const t = pool.equals[pool.equals.length - 1];
      const newPool = clonePool(pool);
      newPool.equals.pop();
      return { pool: newPool, eqToken: { tile: t, face: '=', assigned: null } };
    }
    if (pool.blanks.length > 0) {
      const t = pool.blanks[pool.blanks.length - 1];
      const newPool = clonePool(pool);
      newPool.blanks.pop();
      return { pool: newPool, eqToken: { tile: t, face: '=', assigned: '=' } };
    }
    return null;
  }

  /**
   * Enumerate all possible assignments for one SIDE of the equation.
   * Returns array of { value: number, tokens: [...], poolAfter: pool }.
   *
   * If targetValue is non-null, only return assignments matching that value.
   */
  function enumerateSide(side, pool, targetValue, deadline) {
    const results = [];
    let timedOut = false;

    function recur(slotIdx, slotValues, slotTokens) {
      if (deadline && Date.now() > deadline) { timedOut = true; return; }

      if (slotIdx >= side.length) {
        const value = computeSideValue(side, slotValues);
        if (value === null) return;
        if (!Number.isInteger(value)) return;
        if (Math.abs(value) > 99999) return;

        if (targetValue !== null && value !== targetValue) return;

        const tokens = flattenSideTokens(side, slotTokens);
        // Snapshot the pool state — we need to record what's left AFTER this side's tiles are consumed
        // Since we're using in-place mutation, we need to clone here for the result
        results.push({ value: value, tokens: tokens, poolSnapshot: snapshotPool(pool) });
        return;
      }

      const slot = side[slotIdx];

      if (slot.kind === 'op') {
        const op = slot.op;
        for (const opt of opOptions(pool, op)) {
          slotTokens[slotIdx] = { kind: 'op', tile: opt.tile, face: op, assigned: opt.assigned };
          slotValues[slotIdx] = op;
          recur(slotIdx + 1, slotValues, slotTokens);
          opt.undo();
          if (timedOut) return;
        }
      } else if (slot.kind === 'num') {
        for (const numOpt of numberOptions(slot, pool)) {
          slotTokens[slotIdx] = numOpt.tokens;
          slotValues[slotIdx] = numOpt.value;
          recur(slotIdx + 1, slotValues, slotTokens);
          numOpt.undo();
          if (timedOut) return;
        }
      }
    }

    recur(0, [], []);
    return results;
  }

  /**
   * Snapshot the pool state (lightweight — only stores tile id lists).
   * Used to restore pool after a side enumeration completes.
   */
  function snapshotPool(pool) {
    return {
      digitIds: pool.digits.map(t => t.id),
      twodigitIds: pool.twodigits.map(t => t.id),
      blankIds: pool.blanks.map(t => t.id),
      opIdsByFace: {
        '+': pool.opByFace['+'].map(t => t.id),
        '-': pool.opByFace['-'].map(t => t.id),
        '×': pool.opByFace['×'].map(t => t.id),
        '÷': pool.opByFace['÷'].map(t => t.id),
      },
      choicePMIds: pool.choicePM.map(t => t.id),
      choiceMDIds: pool.choiceMD.map(t => t.id),
      equalsIds: pool.equals.map(t => t.id),
    };
  }

  /**
   * Generate operator options from the pool for a specific operator char.
   * Yields { tile, assigned, undo: function }.
   * Uses in-place mutation; caller MUST call undo() before continuing.
   */
  function* opOptions(pool, op) {
    if (pool.opByFace[op] && pool.opByFace[op].length > 0) {
      const t = pool.opByFace[op].pop();
      yield { tile: t, assigned: null, undo: function () { pool.opByFace[op].push(t); } };
    }
    if ((op === '+' || op === '-') && pool.choicePM.length > 0) {
      const t = pool.choicePM.pop();
      yield { tile: t, assigned: op, undo: function () { pool.choicePM.push(t); } };
    }
    if ((op === '×' || op === '÷') && pool.choiceMD.length > 0) {
      const t = pool.choiceMD.pop();
      yield { tile: t, assigned: op, undo: function () { pool.choiceMD.push(t); } };
    }
    if (pool.blanks.length > 0) {
      const t = pool.blanks.pop();
      yield { tile: t, assigned: op, undo: function () { pool.blanks.push(t); } };
    }
  }

  /**
   * Generate all (value, tokens, undo) options for a NUM slot using in-place mutation.
   * Caller MUST call undo() after consuming each yielded option.
   */
  function* numberOptions(slot, pool) {
    const size = slot.size;
    const hasUnary = (slot.unary === '-');

    function* unaryOptions() {
      if (!hasUnary) { yield null; return; }
      if (pool.opByFace['-'].length > 0) {
        const t = pool.opByFace['-'].pop();
        yield { tile: t, assigned: null, undo: function () { pool.opByFace['-'].push(t); } };
      }
      if (pool.choicePM.length > 0) {
        const t = pool.choicePM.pop();
        yield { tile: t, assigned: '-', undo: function () { pool.choicePM.push(t); } };
      }
      if (pool.blanks.length > 0) {
        const t = pool.blanks.pop();
        yield { tile: t, assigned: '-', undo: function () { pool.blanks.push(t); } };
      }
    }

    for (const uOpt of unaryOptions()) {
      if (size === 1) {
        // Single-digit slot: digit, twodigit, or blank
        // Try digits
        for (let i = 0; i < pool.digits.length; i++) {
          const t = pool.digits[i];
          pool.digits.splice(i, 1);
          const tokens = [];
          if (uOpt) tokens.push({ kind: 'op', tile: uOpt.tile, face: '-', assigned: uOpt.assigned });
          tokens.push({ kind: 'digit', tile: t, face: t.face, assigned: null });
          const val = parseInt(t.face) * (hasUnary ? -1 : 1);
          yield {
            value: val,
            tokens: tokens,
            undo: (function (savedI, savedT) {
              return function () { pool.digits.splice(savedI, 0, savedT); };
            })(i, t),
          };
        }
        // Twodigits
        for (let i = 0; i < pool.twodigits.length; i++) {
          const t = pool.twodigits[i];
          pool.twodigits.splice(i, 1);
          const tokens = [];
          if (uOpt) tokens.push({ kind: 'op', tile: uOpt.tile, face: '-', assigned: uOpt.assigned });
          tokens.push({ kind: 'digit', tile: t, face: t.face, assigned: null });
          const val = parseInt(t.face) * (hasUnary ? -1 : 1);
          yield {
            value: val,
            tokens: tokens,
            undo: (function (savedI, savedT) {
              return function () { pool.twodigits.splice(savedI, 0, savedT); };
            })(i, t),
          };
        }
        // Blanks
        for (let i = 0; i < pool.blanks.length; i++) {
          const t = pool.blanks[i];
          pool.blanks.splice(i, 1);
          for (let v = 0; v <= 20; v++) {
            const face = String(v);
            const tokens = [];
            if (uOpt) tokens.push({ kind: 'op', tile: uOpt.tile, face: '-', assigned: uOpt.assigned });
            tokens.push({ kind: 'digit', tile: t, face: face, assigned: face });
            yield {
              value: v * (hasUnary ? -1 : 1),
              tokens: tokens,
              undo: function () {},     // we restore the blank after the loop
            };
          }
          // Restore blank tile after all 21 values tried
          pool.blanks.splice(i, 0, t);
        }
      } else {
        // Multi-digit: recursive picking with mutation
        const picked = [];
        yield* multiDigitOptions(size, pool, picked, uOpt, hasUnary);
      }

      if (uOpt) uOpt.undo();
    }
  }

  function* multiDigitOptions(size, pool, picked, uOpt, hasUnary) {
    if (picked.length === size) {
      const faces = picked.map(p => p.face);
      if (faces[0] === '0') return;
      const value = parseInt(faces.join('')) * (hasUnary ? -1 : 1);
      const tokens = [];
      if (uOpt) tokens.push({ kind: 'op', tile: uOpt.tile, face: '-', assigned: uOpt.assigned });
      for (const p of picked) {
        tokens.push({ kind: 'digit', tile: p.tile, face: p.face, assigned: p.tile.type === 'blank' ? p.face : null });
      }
      yield { value: value, tokens: tokens, undo: function () {} };
      return;
    }

    const isLeading = picked.length === 0;

    // Digit tiles
    for (let i = 0; i < pool.digits.length; i++) {
      const t = pool.digits[i];
      const face = t.face;
      if (isLeading && face === '0') continue;
      pool.digits.splice(i, 1);
      picked.push({ tile: t, face: face });
      yield* multiDigitOptions(size, pool, picked, uOpt, hasUnary);
      picked.pop();
      pool.digits.splice(i, 0, t);
    }
    // Blanks (0-9)
    for (let i = 0; i < pool.blanks.length; i++) {
      const t = pool.blanks[i];
      pool.blanks.splice(i, 1);
      for (let v = 0; v <= 9; v++) {
        const face = String(v);
        if (isLeading && face === '0') continue;
        picked.push({ tile: t, face: face });
        yield* multiDigitOptions(size, pool, picked, uOpt, hasUnary);
        picked.pop();
      }
      pool.blanks.splice(i, 0, t);
    }
  }

  /**
   * Compute the value of one side given its slots and chosen values.
   * slotValues[i] is either a number (for num slot) or an op character (for op slot).
   */
  function computeSideValue(side, slotValues) {
    // First pass: × and ÷
    const vals = [];
    const ops = [];
    for (let i = 0; i < side.length; i++) {
      if (side[i].kind === 'num') vals.push(slotValues[i]);
      else if (side[i].kind === 'op') ops.push(slotValues[i]);
    }

    // Apply × and ÷ first (left to right)
    let i = 0;
    while (i < ops.length) {
      if (ops[i] === '×') {
        vals[i] = vals[i] * vals[i + 1];
        vals.splice(i + 1, 1);
        ops.splice(i, 1);
      } else if (ops[i] === '÷') {
        if (vals[i + 1] === 0) return null;
        if (vals[i] % vals[i + 1] !== 0) return null;
        vals[i] = vals[i] / vals[i + 1];
        vals.splice(i + 1, 1);
        ops.splice(i, 1);
      } else {
        i++;
      }
    }

    // Then + and -
    let total = vals[0];
    for (let j = 0; j < ops.length; j++) {
      if (ops[j] === '+') total += vals[j + 1];
      else if (ops[j] === '-') total -= vals[j + 1];
      else return null;
    }
    return total;
  }

  /**
   * Flatten slot tokens into a linear array of tokens.
   * slotTokens[i] is either:
   *   - { kind: 'op', tile, face, assigned } (single op token)
   *   - [token, token, ...] (array of tokens for a num slot)
   */
  function flattenSideTokens(side, slotTokens) {
    const tokens = [];
    for (let i = 0; i < side.length; i++) {
      const st = slotTokens[i];
      if (Array.isArray(st)) {
        for (const t of st) tokens.push(t);
      } else {
        tokens.push(st);
      }
    }
    return tokens;
  }

  /**
   * Build final result from a list of side results plus equals tokens between them.
   * `sideResults` is an array of side results, each with .tokens.
   */
  function buildResult(sides, sideResults) {
    const tokens = [];
    for (let i = 0; i < sideResults.length; i++) {
      for (const t of sideResults[i].tokens) tokens.push(t);
      // No equals after last side
    }
    return { tokens: tokens };
  }

  /**
   * Prepend a side result + equals token to an existing result.
   */
  function prependSideResult(sideResult, eqToken, existing) {
    const tokens = [];
    for (const t of sideResult.tokens) tokens.push(t);
    tokens.push(eqToken);
    for (const t of existing.tokens) tokens.push(t);
    return { tokens: tokens };
  }

  // ========================================================================
  // MAIN ENTRY POINT
  // ========================================================================

  /**
   * Find a first-move Bingo: 8 rack tiles forming an 8-cell equation
   * placed through the center cell (7,7).
   */
  function findFirstMoveBingo(state, aiTiles, startTime, deadline) {
    const allShapes = generateShapes(8);
    const rackCat = categorizeRack(aiTiles);

    let bestResult = null;
    let bestScore = -1;
    let firstFoundAt = null;
    const BONUS_WINDOW_MS = 1500;

    for (const shape of allShapes) {
      if (Date.now() > deadline) break;
      if (firstFoundAt !== null && Date.now() > firstFoundAt + BONUS_WINDOW_MS) break;

      if (!isShapeCompatible(shape, rackCat)) continue;

      const result = tryAssignShape(shape, rackCat, deadline);
      if (!result || result.timeout) continue;

      // Try placing through center in both orientations, each token position as center
      for (const orientation of ['h', 'v']) {
        const dr = orientation === 'v' ? 1 : 0;
        const dc = orientation === 'h' ? 1 : 0;

        for (let centerIdx = 0; centerIdx < result.tokens.length; centerIdx++) {
          const placements = [];
          let valid = true;

          for (let i = 0; i < result.tokens.length; i++) {
            const offset = i - centerIdx;
            const r = 7 + offset * dr;
            const c = 7 + offset * dc;
            if (r < 0 || r >= C.BOARD_SIZE || c < 0 || c >= C.BOARD_SIZE) {
              valid = false; break;
            }
            placements.push({
              row: r,
              col: c,
              tile: result.tokens[i].tile,
              assigned: result.tokens[i].assigned,
            });
          }

          if (!valid || placements.length !== 8) continue;

          const validation = validateFirstMove(state.board, placements);
          if (!validation.ok) continue;

          const score = scoreBingoOnBoard(state.board, placements, validation.equations);
          if (score > bestScore) {
            bestScore = score;
            bestResult = {
              type: 'play',
              placements: placements,
              score: score,
              equations: validation.equations || [],
            };
            if (firstFoundAt === null) firstFoundAt = Date.now();
            // Don't break inner loops — let same shape try other placements
            // for potentially higher score
          }
        }
      }
    }

    if (bestResult) {
      console.log('[GrammarBingo] First-move Bingo in ' + (Date.now() - startTime) + 'ms, score=' + bestResult.score);
    } else {
      console.log('[GrammarBingo] No first-move Bingo in ' + (Date.now() - startTime) + 'ms');
    }
    return bestResult;
  }

  function validateFirstMove(board, placements) {
    if (!Placement || !Placement.validatePlay) return { valid: true };
    const applied = [];
    try {
      for (const p of placements) {
        if (p.assigned) p.tile.assigned = p.assigned;
        Board.placeTile(board, p.row, p.col, p.tile);
        applied.push(p);
      }
      const res = Placement.validatePlay(board, placements, true);
      return { valid: res.ok !== false, reason: res.reason, equations: res.equations };
    } catch (err) {
      return { valid: false, reason: err.message };
    } finally {
      for (const p of applied) Board.removeTile(board, p.row, p.col);
    }
  }

  function scoreBingoOnBoard(board, placements, equations) {
    if (!Scoring || !Scoring.scorePlay || !equations) return 0;
    const applied = [];
    try {
      for (const p of placements) {
        if (p.assigned) p.tile.assigned = p.assigned;
        Board.placeTile(board, p.row, p.col, p.tile);
        applied.push(p);
      }
      const s = Scoring.scorePlay(equations, board, placements.length);
      return s.total;
    } finally {
      for (const p of applied) Board.removeTile(board, p.row, p.col);
    }
  }

  /**
   * Find a Bingo using grammar-based search.
   * @param state: { board, aiRack, isFirstMove }
   * @param timeBudgetMs: time limit
   * @returns { type:'play', placements, score, equations } or null
   */
  function findGrammarBingo(state, timeBudgetMs) {
    if (!state.aiRack || state.aiRack.tiles.length !== 8) return null;
    timeBudgetMs = timeBudgetMs || 10000;

    const startTime = Date.now();
    const deadline = startTime + timeBudgetMs;
    const aiTiles = state.aiRack.tiles;

    // First move case: no anchor on board, use size-8 shapes through center
    if (state.isFirstMove) {
      return findFirstMoveBingo(state, aiTiles, startTime, deadline);
    }

    // Generate all shapes of size 9 (cached after first call)
    const allShapes = generateShapes(9);

    // Find anchor tiles on board
    const anchors = findAnchorTiles(state.board);
    if (anchors.length === 0) return null;

    let bestResult = null;
    let bestScore = -1;
    let anchorsTried = 0;
    let anchorsSkippedDead = 0;

    // Cross-anchor exploration: after the FIRST anchor finds a Bingo, allow
    // a bonus window of additional anchor scanning so the AI can compare
    // arrangements across anchors and pick the highest-scoring one. Different
    // anchors place the same equation in different lateral/vertical positions,
    // so high-value tiles may land on different premium squares from anchor
    // to anchor.
    //
    // Note: the inner shape-loop also has its own ~1500ms bonus window after
    // each anchor's first hit. To ensure there's TIME LEFT for trying other
    // anchors after the inner exhausts, we set ANCHOR_BONUS_WINDOW_MS to be
    // distinctly LONGER than the per-anchor window.
    let anchorBonusDeadline = null;
    const ANCHOR_BONUS_WINDOW_MS = 3500;

    const aiX9 = window.AMath.aiX9;
    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];

    for (const anchor of anchors) {
      anchorsTried++;
      if (Date.now() > deadline) break;

      // Syntactic pre-filter: if every empty cell adjacent to this anchor is
      // "dead" (no legal token type can fit), no Bingo extension can succeed.
      // Skip the anchor entirely.
      if (aiX9 && aiX9.isCellDead) {
        let hasLiveAdjacent = false;
        for (const [dr, dc] of dirs) {
          const nr = anchor.row + dr, nc = anchor.col + dc;
          if (nr < 0 || nr >= C.BOARD_SIZE || nc < 0 || nc >= C.BOARD_SIZE) continue;
          const ncell = Board.getCell(state.board, nr, nc);
          if (!ncell || ncell.tile) continue; // not empty, not relevant
          if (!aiX9.isCellDead(state.board, nr, nc, null)) {
            hasLiveAdjacent = true;
            break;
          }
        }
        if (!hasLiveAdjacent) {
          anchorsSkippedDead++;
          continue;
        }
      }

      // Build the candidate rack: AI tiles + 1 anchor tile
      const candidateTiles = aiTiles.slice();
      const anchorConcrete = concretizeAnchorTile(anchor.tile);
      candidateTiles.push(anchorConcrete);

      const rackCat = categorizeRack(candidateTiles);

      // Pre-filter: only try shapes that have a slot anchor can occupy
      const anchorType = anchorConcrete.type;
      const anchorFace = anchorConcrete.face;
      const shapesForAnchor = allShapes.filter(function (shape) {
        return shapeHasSlotForFace(shape, anchorType, anchorFace);
      });

      // NOTE: do NOT sort shapesForAnchor — the natural generation order
      // (longer NUM slots earlier) happens to find Bingos faster for hard racks
      // (where standard patterns like `xxx + x = xxx` are most likely).
      // Empirically: sorting by simplicity caused 3-BLANK anchor cases to time out.

      // Top-K: instead of stopping at first found, give a short "bonus window"
      // after first hit per anchor to look for higher-scoring shape variants.
      // We keep this small (1000ms) so there's time left for the OUTER anchor
      // loop to try other anchors entirely (ANCHOR_BONUS_WINDOW_MS = 3500ms).
      let firstFoundAt = null;
      const BONUS_WINDOW_MS = 1000;

      // Try each shape
      for (const shape of shapesForAnchor) {
        if (Date.now() > deadline) break;
        // Top-K: stop only after first-found + bonus window expires
        if (firstFoundAt !== null && Date.now() > firstFoundAt + BONUS_WINDOW_MS) break;

        // Compatibility check
        if (!isShapeCompatible(shape, rackCat)) continue;

        // Try to assign — anchor is included in the rack pool
        const result = tryAssignShape(shape, rackCat, deadline);
        if (!result || result.timeout) continue;

        // Verify anchor is used in result.
        // The anchor's tile.id is what tryAssignShape used to fill ONE slot —
        // but the anchor's FACE may appear at multiple slots in the shape.
        // Try EACH such slot as a lateral position for the equation; each
        // produces a different board layout and possibly a different score.
        const anchorFace = anchorConcrete.face;
        const candidatePositions = findAllAnchorFacePositions(result.tokens, anchorFace);
        if (candidatePositions.length === 0) continue;

        // Find where tryAssignShape originally placed the anchor tile —
        // we'll need to SWAP, not just overwrite, when trying other positions.
        const originalAnchorIdx = findAnchorInTokens(result.tokens, anchor.tile.id);
        if (originalAnchorIdx === -1) continue;

        for (const anchorTokenIdx of candidatePositions) {
          if (Date.now() > deadline) break;

          // Shallow-clone tokens so each candidate has independent slot refs.
          const tokensCopy = result.tokens.map(t => Object.assign({}, t));

          if (anchorTokenIdx !== originalAnchorIdx) {
            // Swap tile + assigned together. The "assigned" field belongs to
            // the tile (it says "this BLANK/choice tile is acting as <face>
            // in this position"), so it must travel WITH the tile when we
            // move it between slots.
            const tileAtNew = result.tokens[anchorTokenIdx].tile;
            const assignedAtNew = result.tokens[anchorTokenIdx].assigned;
            const tileAtOrig = result.tokens[originalAnchorIdx].tile; // = anchor.tile
            const assignedAtOrig = result.tokens[originalAnchorIdx].assigned;

            tokensCopy[originalAnchorIdx] = Object.assign({},
              tokensCopy[originalAnchorIdx], {
                tile: tileAtNew,
                assigned: assignedAtNew,
                isAnchor: false,
              });
            tokensCopy[anchorTokenIdx] = Object.assign({},
              tokensCopy[anchorTokenIdx], {
                tile: tileAtOrig,
                assigned: assignedAtOrig,
                isAnchor: true,
              });
          }

          // Build board placements (anchor stays put, other tiles get placed around)
          const placements = buildBoardPlacements(state.board, tokensCopy, anchor, anchorTokenIdx);
          if (!placements) continue;

          // Validate on board
          const validation = validatePlacementsOnBoard(state.board, placements);
          if (!validation.ok) continue;

          // Score
          const score = scoreBingo(state.board, placements, validation.equations);
          if (score > bestScore) {
            bestScore = score;
            bestResult = {
              type: 'play',
              placements: placements,
              score: score,
              equations: validation.equations || [],
            };
            if (firstFoundAt === null) firstFoundAt = Date.now();
          }
        }
      }
      // Done with this anchor. UNLIKE the previous version, we do NOT break
      // immediately after finding a result — instead we let the OUTER anchor
      // loop continue for a bonus window (anchorBonusDeadline). This allows
      // the AI to compare arrangements across multiple anchors and pick the
      // highest-scoring one. Other anchors often DO yield better scores when
      // the high-value tiles can hit premium squares from a different angle.
      if (bestResult && !anchorBonusDeadline) {
        anchorBonusDeadline = Date.now() + ANCHOR_BONUS_WINDOW_MS;
      }
      if (anchorBonusDeadline && Date.now() > anchorBonusDeadline) break;
    }

    // === T-SHAPE / CROSS-ANCHOR PASS ===
    // If no Bingo found yet (or we have time left), try shapes that span TWO
    // existing tiles. This catches the "T-shape" Bingo pattern where 8 new tiles
    // are placed along a line that crosses 2+ existing tiles (called "bridges").
    if (!bestResult && Date.now() < deadline - 500) {
      const tShapeResult = findTShapeBingo(state, aiTiles, deadline);
      if (tShapeResult && (!bestResult || tShapeResult.score > bestScore)) {
        bestResult = tShapeResult;
        bestScore = tShapeResult.score;
      }
    }

    if (bestResult) {
      console.log('[GrammarBingo] Found Bingo in ' + (Date.now() - startTime) +
                  'ms, score=' + bestResult.score + ', tried ' + anchorsTried + ' anchors' +
                  (anchorsSkippedDead > 0 ? ' (' + anchorsSkippedDead + ' skipped as syntactically dead)' : ''));
    } else {
      console.log('[GrammarBingo] No Bingo found in ' + (Date.now() - startTime) +
                  'ms, tried ' + anchorsTried + ' anchors' +
                  (anchorsSkippedDead > 0 ? ' (' + anchorsSkippedDead + ' skipped as syntactically dead)' : ''));
    }
    return bestResult;
  }

  /**
   * Find T-shape (cross-anchor) Bingo: 8 new tiles placed along a line that
   * spans 2+ existing tiles. The "bridges" are the existing tiles within the
   * placement run.
   *
   * Strategy:
   *   For each anchor tile A, look along its line (horizontal and vertical) for
   *   another existing tile B within distance 2-9. The gap between A and B
   *   must be empty cells. We attempt to place new tiles such that the resulting
   *   equation spans A, the gap, and B.
   *
   *   Shape size = 8 (new) + 2 (A and B) + any other bridges on the line = 10+.
   *
   * Returns: { type:'play', placements, score, equations } or null.
   */
  function findTShapeBingo(state, aiTiles, deadline) {
    const rackCat = categorizeRack(aiTiles);
    let bestResult = null;
    let bestScore = -1;

    // For each existing tile A, look along row and column for nearby tiles B
    const board = state.board;
    const tilesOnBoard = [];
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = Board.getCell(board, r, c);
        if (cell && cell.tile) tilesOnBoard.push({ row: r, col: c, tile: cell.tile });
      }
    }

    // Find candidate spans: pairs of tiles on the same line, with empty cells
    // between them, total span length 10-15.
    const spans = [];
    for (let i = 0; i < tilesOnBoard.length && Date.now() < deadline; i++) {
      for (let j = i + 1; j < tilesOnBoard.length; j++) {
        const a = tilesOnBoard[i], b = tilesOnBoard[j];

        if (a.row === b.row) {
          // Same row
          const c1 = Math.min(a.col, b.col);
          const c2 = Math.max(a.col, b.col);
          const totalLen = c2 - c1 + 1;
          if (totalLen < 10 || totalLen > 15) continue;

          // Reject spans where there's an adjacent tile BEYOND either anchor.
          // E.g., if tile X is at (row, c1-1), then the "real" anchor is X, not the
          // tile at c1. Our T-shape model wouldn't account for the extended equation.
          if (c1 > 0 && board.cells[a.row][c1 - 1].tile) continue;
          if (c2 < C.BOARD_SIZE - 1 && board.cells[a.row][c2 + 1].tile) continue;

          // Check the cells between are empty (or have bridge tiles)
          const bridges = [];
          for (let cc = c1 + 1; cc < c2; cc++) {
            const cell = Board.getCell(board, a.row, cc);
            if (cell && cell.tile) bridges.push({ row: a.row, col: cc, tile: cell.tile });
          }
          // We need EMPTY positions for new tiles. The span has 'totalLen' cells.
          // 2 are A and B, 'bridges.length' are other existing tiles.
          // 'totalLen - 2 - bridges.length' are empty (to be filled).
          const emptyCount = totalLen - 2 - bridges.length;
          if (emptyCount !== 8) continue;     // Bingo = 8 new tiles
          spans.push({
            orientation: 'h',
            startRow: a.row, startCol: c1,
            length: totalLen,
            anchors: [
              { row: a.row, col: c1, tile: a.col < b.col ? a.tile : b.tile },
              { row: a.row, col: c2, tile: a.col < b.col ? b.tile : a.tile },
            ],
            bridges: bridges,
          });
        } else if (a.col === b.col) {
          // Same column
          const r1 = Math.min(a.row, b.row);
          const r2 = Math.max(a.row, b.row);
          const totalLen = r2 - r1 + 1;
          if (totalLen < 10 || totalLen > 15) continue;

          // Reject spans with adjacent tile beyond either anchor (see horizontal case)
          if (r1 > 0 && board.cells[r1 - 1][a.col].tile) continue;
          if (r2 < C.BOARD_SIZE - 1 && board.cells[r2 + 1][a.col].tile) continue;

          const bridges = [];
          for (let rr = r1 + 1; rr < r2; rr++) {
            const cell = Board.getCell(board, rr, a.col);
            if (cell && cell.tile) bridges.push({ row: rr, col: a.col, tile: cell.tile });
          }
          const emptyCount = totalLen - 2 - bridges.length;
          if (emptyCount !== 8) continue;
          spans.push({
            orientation: 'v',
            startRow: r1, startCol: a.col,
            length: totalLen,
            anchors: [
              { row: r1, col: a.col, tile: a.row < b.row ? a.tile : b.tile },
              { row: r2, col: a.col, tile: a.row < b.row ? b.tile : a.tile },
            ],
            bridges: bridges,
          });
        }
      }
    }

    if (spans.length === 0) return null;

    // For each candidate span, try to fit a grammar shape of that size
    const effectiveFace = Placement && Placement.effectiveFace
      ? Placement.effectiveFace
      : function (t) { return t.assigned || t.face; };

    for (const span of spans) {
      if (Date.now() >= deadline - 200) break;
      if (bestResult) break;     // first-found

      // Required token sequence: known faces at fixed positions
      // We need a shape of total token count = span.length where:
      //   - position 0: face matches anchor[0]
      //   - position (length-1): face matches anchor[1]
      //   - each bridge position: face matches bridge tile
      //   - all other positions: free (to be filled by rack)

      const totalLen = span.length;
      const fixedFaces = new Array(totalLen).fill(null);
      // Anchors
      fixedFaces[0] = effectiveFace(span.anchors[0].tile);
      fixedFaces[totalLen - 1] = effectiveFace(span.anchors[1].tile);
      // Bridges
      for (const br of span.bridges) {
        let idx;
        if (span.orientation === 'h') idx = br.col - span.startCol;
        else idx = br.row - span.startRow;
        fixedFaces[idx] = effectiveFace(br.tile);
      }

      // Generate shapes of this length
      const shapes = generateShapes(totalLen);

      for (const shape of shapes) {
        if (Date.now() >= deadline - 200) break;
        if (bestResult) break;

        // Check shape compatibility with fixed faces
        if (!shapeMatchesFixedFaces(shape, fixedFaces)) continue;

        // Need rack to fill non-fixed positions.
        // Build a pool: original rack + concretized anchor + bridge tiles
        // (anchors/bridges are "pre-filled" — not in pool; they need to be USED at fixed positions)
        // The pool for assignment should JUST be the rack — fixed positions are pre-assigned.

        // Try to assign rack tiles to the non-fixed positions
        const result = tryAssignWithFixedFaces(shape, rackCat, fixedFaces, deadline);
        if (!result) continue;

        // Build placements
        const placements = buildTShapePlacements(span, shape, result.tokens, fixedFaces);
        if (!placements || placements.length !== 8) continue;

        const validation = validatePlacementsOnBoard(state.board, placements);
        if (!validation.ok) continue;

        const score = scoreBingo(state.board, placements, validation.equations);
        if (score > bestScore) {
          bestScore = score;
          bestResult = {
            type: 'play',
            placements: placements,
            score: score,
            equations: validation.equations || [],
          };
        }
      }
    }

    if (bestResult) {
      console.log('[GrammarBingo] T-shape Bingo found, score=' + bestResult.score);
    }
    return bestResult;
  }

  /**
   * Check if shape's tokens at fixed-face positions match the given faces.
   * For non-null entries in fixedFaces, the corresponding shape token must
   * produce that face.
   */
  function shapeMatchesFixedFaces(shape, fixedFaces) {
    // Build expected token sequence
    const tokens = [];
    for (const slot of shape) {
      if (slot.kind === 'num') {
        if (slot.unary === '-') tokens.push({ kind: 'op', face: '-' });
        for (let p = 0; p < slot.size; p++) {
          tokens.push({ kind: 'digit', slotSize: slot.size, isLeading: p === 0 });
        }
      } else if (slot.kind === 'op') {
        tokens.push({ kind: 'op', face: slot.op });
      } else if (slot.kind === 'eq') {
        tokens.push({ kind: 'eq', face: '=' });
      }
    }

    if (tokens.length !== fixedFaces.length) return false;

    for (let i = 0; i < tokens.length; i++) {
      const expected = fixedFaces[i];
      if (expected === null) continue;
      const tk = tokens[i];

      if (tk.kind === 'op') {
        // Op slot — expected face must match the slot's op
        if (tk.face !== expected) return false;
      } else if (tk.kind === 'eq') {
        if (expected !== '=') return false;
      } else if (tk.kind === 'digit') {
        // Digit slot — expected must be a digit/twodigit value
        if (!/^\d+$/.test(expected)) return false;
        // For multi-digit slots: can't have face length > 1 unless single-digit position 0 (handled by leading rule)
        // For size-1 slots: any 0-20 face works
        // For multi-digit (size > 1): only 0-9 single digits
        if (tk.slotSize > 1 && expected.length > 1) return false;
        if (tk.slotSize > 1 && tk.isLeading && expected === '0') return false;
      }
    }
    return true;
  }

  /**
   * Try to assign rack tiles to NON-FIXED positions in a shape.
   * Fixed positions are pre-determined by fixedFaces — they're "filled" by
   * existing board tiles (anchors/bridges) which we don't place but must be
   * counted in the equation.
   *
   * Returns: { tokens: [...] } where tokens at fixed positions have a synthetic
   * marker indicating "use existing board tile here", and other tokens have
   * real rack tile assignments. Or null on failure.
   */
  function tryAssignWithFixedFaces(shape, rackCat, fixedFaces, deadline) {
    // Convert shape to per-token template
    const tokenSlots = [];
    let tokIdx = 0;
    for (const slot of shape) {
      if (slot.kind === 'num') {
        if (slot.unary === '-') {
          tokenSlots.push({ kind: 'op-unary', slotRef: slot, fixedFace: fixedFaces[tokIdx] });
          tokIdx++;
        }
        for (let p = 0; p < slot.size; p++) {
          tokenSlots.push({ kind: 'digit', slotRef: slot, pos: p, isLeading: p === 0, fixedFace: fixedFaces[tokIdx] });
          tokIdx++;
        }
      } else if (slot.kind === 'op') {
        tokenSlots.push({ kind: 'op', op: slot.op, fixedFace: fixedFaces[tokIdx] });
        tokIdx++;
      } else if (slot.kind === 'eq') {
        tokenSlots.push({ kind: 'eq', fixedFace: fixedFaces[tokIdx] });
        tokIdx++;
      }
    }

    // We need to assign rack tiles to all NON-FIXED tokens, AND compute the
    // numeric value of the equation (using fixed faces for fixed positions).
    // This is more complex than tryAssignShape — we'll do a simpler version
    // that walks token by token.

    // Pool (in-place mutable)
    const pool = clonePool(rackCat);
    const placed = new Array(tokenSlots.length).fill(null);
    let timedOut = false;

    function recur(i) {
      if (timedOut) return false;
      if (deadline && Date.now() > deadline) { timedOut = true; return false; }

      if (i >= tokenSlots.length) {
        // Build faces array and validate
        const faces = placed.map(p => p.face);
        if (Eval && Eval.validateEquation) {
          const res = Eval.validateEquation(faces);
          return res.valid;
        }
        return true;
      }

      const tk = tokenSlots[i];

      if (tk.fixedFace !== null) {
        // This is a fixed position (anchor or bridge) — face is already known
        placed[i] = { tile: null, face: tk.fixedFace, assigned: null, isBridge: true };
        if (recur(i + 1)) return true;
        if (timedOut) return false;
        placed[i] = null;
        return false;
      }

      // Free position — assign from pool
      if (tk.kind === 'op-unary') {
        // Unary minus — needs a '-' from pool
        if (pool.opByFace['-'].length > 0) {
          const t = pool.opByFace['-'].pop();
          placed[i] = { tile: t, face: '-', assigned: null };
          if (recur(i + 1)) return true;
          if (timedOut) return false;
          pool.opByFace['-'].push(t);
          placed[i] = null;
        }
        if (pool.choicePM.length > 0) {
          const t = pool.choicePM.pop();
          placed[i] = { tile: t, face: '-', assigned: '-' };
          if (recur(i + 1)) return true;
          if (timedOut) return false;
          pool.choicePM.push(t);
          placed[i] = null;
        }
        if (pool.blanks.length > 0) {
          const t = pool.blanks.pop();
          placed[i] = { tile: t, face: '-', assigned: '-' };
          if (recur(i + 1)) return true;
          if (timedOut) return false;
          pool.blanks.push(t);
          placed[i] = null;
        }
        return false;
      }

      if (tk.kind === 'eq') {
        if (pool.equals.length > 0) {
          const t = pool.equals.pop();
          placed[i] = { tile: t, face: '=', assigned: null };
          if (recur(i + 1)) return true;
          if (timedOut) return false;
          pool.equals.push(t);
          placed[i] = null;
        }
        if (pool.blanks.length > 0) {
          const t = pool.blanks.pop();
          placed[i] = { tile: t, face: '=', assigned: '=' };
          if (recur(i + 1)) return true;
          if (timedOut) return false;
          pool.blanks.push(t);
          placed[i] = null;
        }
        return false;
      }

      if (tk.kind === 'op') {
        const op = tk.op;
        if (pool.opByFace[op] && pool.opByFace[op].length > 0) {
          const t = pool.opByFace[op].pop();
          placed[i] = { tile: t, face: op, assigned: null };
          if (recur(i + 1)) return true;
          if (timedOut) return false;
          pool.opByFace[op].push(t);
          placed[i] = null;
        }
        if ((op === '+' || op === '-') && pool.choicePM.length > 0) {
          const t = pool.choicePM.pop();
          placed[i] = { tile: t, face: op, assigned: op };
          if (recur(i + 1)) return true;
          if (timedOut) return false;
          pool.choicePM.push(t);
          placed[i] = null;
        }
        if ((op === '×' || op === '÷') && pool.choiceMD.length > 0) {
          const t = pool.choiceMD.pop();
          placed[i] = { tile: t, face: op, assigned: op };
          if (recur(i + 1)) return true;
          if (timedOut) return false;
          pool.choiceMD.push(t);
          placed[i] = null;
        }
        if (pool.blanks.length > 0) {
          const t = pool.blanks.pop();
          placed[i] = { tile: t, face: op, assigned: op };
          if (recur(i + 1)) return true;
          if (timedOut) return false;
          pool.blanks.push(t);
          placed[i] = null;
        }
        return false;
      }

      if (tk.kind === 'digit') {
        const isLeading = tk.isLeading;
        const slotSize = tk.slotRef.size;

        // Try digits
        for (let j = 0; j < pool.digits.length; j++) {
          const t = pool.digits[j];
          const face = t.face;
          if (slotSize > 1 && isLeading && face === '0') continue;
          pool.digits.splice(j, 1);
          placed[i] = { tile: t, face: face, assigned: null };
          if (recur(i + 1)) return true;
          if (timedOut) return false;
          pool.digits.splice(j, 0, t);
          placed[i] = null;
        }
        // Twodigit (size-1 only)
        if (slotSize === 1) {
          for (let j = 0; j < pool.twodigits.length; j++) {
            const t = pool.twodigits[j];
            pool.twodigits.splice(j, 1);
            placed[i] = { tile: t, face: t.face, assigned: null };
            if (recur(i + 1)) return true;
            if (timedOut) return false;
            pool.twodigits.splice(j, 0, t);
            placed[i] = null;
          }
        }
        // Blanks
        for (let j = 0; j < pool.blanks.length; j++) {
          const t = pool.blanks[j];
          pool.blanks.splice(j, 1);
          const maxV = (slotSize === 1) ? 20 : 9;
          for (let v = 0; v <= maxV; v++) {
            const face = String(v);
            if (slotSize > 1 && isLeading && face === '0') continue;
            placed[i] = { tile: t, face: face, assigned: face };
            if (recur(i + 1)) return true;
            if (timedOut) return false;
          }
          pool.blanks.splice(j, 0, t);
          placed[i] = null;
        }
        return false;
      }

      return false;
    }

    const ok = recur(0);
    if (timedOut || !ok) return null;
    return { tokens: placed.slice() };
  }

  /**
   * Build the 8 placements for a T-shape Bingo from span + tokens.
   * Skips positions that are "bridge" (existing tile) — those don't need
   * placement.
   */
  function buildTShapePlacements(span, shape, tokens, fixedFaces) {
    const placements = [];
    const dr = span.orientation === 'v' ? 1 : 0;
    const dc = span.orientation === 'h' ? 1 : 0;

    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.isBridge) continue;     // Skip — existing tile is here
      const r = span.startRow + i * dr;
      const c = span.startCol + i * dc;
      placements.push({
        row: r,
        col: c,
        tile: tk.tile,
        assigned: tk.assigned,
      });
    }
    return placements;
  }

  /**
   * Find the token index that contains the tile with the given id.
   * Returns -1 if not found.
   */
  function findAnchorInTokens(tokens, anchorId) {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].tile && tokens[i].tile.id === anchorId) return i;
    }
    return -1;
  }

  /**
   * Find ALL token indices whose token-face matches the anchor's face.
   * Used to try multiple lateral positions of the same equation: if a shape
   * like "X + Y = Z + W" has the anchor face `+` at two slot positions, we
   * can place the equation in two different lateral offsets relative to the
   * fixed anchor cell — possibly hitting different premium squares.
   *
   * Returns array of indices (may be empty).
   */
  function findAllAnchorFacePositions(tokens, anchorFace) {
    const positions = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const tokenFace = t.assigned || t.face;
      if (tokenFace === anchorFace) positions.push(i);
    }
    return positions;
  }

  /**
   * Check whether the shape has at least one slot the given anchor can fill.
   * Used as a quick pre-filter to skip shapes that can't accept this anchor.
   */
  function shapeHasSlotForFace(shape, anchorType, anchorFace) {
    for (const slot of shape) {
      if (anchorType === 'equals' && slot.kind === 'eq') return true;
      if (anchorType === 'op') {
        if (slot.kind === 'op' && slot.op === anchorFace) return true;
        if (slot.kind === 'num' && slot.unary === '-' && anchorFace === '-') return true;
      }
      if (anchorType === 'digit') {
        if (slot.kind === 'num') return true;
      }
      if (anchorType === 'twodigit') {
        if (slot.kind === 'num' && slot.size === 1) return true;
      }
      if (anchorType === 'choice') {
        if (slot.kind === 'op') return true;
        if (slot.kind === 'num' && slot.unary === '-') return true;
      }
      if (anchorType === 'blank') {
        return true;  // blanks can be anything
      }
    }
    return false;
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  function findAnchorTiles(board) {
    const anchors = [];
    const effectiveFace = Placement && Placement.effectiveFace
      ? Placement.effectiveFace
      : function (t) { return t.assigned || t.face; };
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = Board.getCell(board, r, c);
        if (!cell || !cell.tile) continue;
        const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
        for (const [dr, dc] of dirs) {
          const nc = Board.getCell(board, r + dr, c + dc);
          if (nc && !nc.tile) {
            anchors.push({ row: r, col: c, tile: cell.tile, face: effectiveFace(cell.tile) });
            break;
          }
        }
      }
    }
    return anchors;
  }

  function concretizeAnchorTile(tile) {
    if (!tile.assigned) return tile;
    const face = tile.assigned;
    if (face === '=') return Object.assign({}, tile, { type: 'equals', face: '=', _origType: tile.type });
    if (face === '+' || face === '-' || face === '×' || face === '÷') {
      return Object.assign({}, tile, { type: 'op', face: face, _origType: tile.type });
    }
    if (face.length === 1) return Object.assign({}, tile, { type: 'digit', face: face, _origType: tile.type });
    return Object.assign({}, tile, { type: 'twodigit', face: face, _origType: tile.type });
  }

  /**
   * Quick filter: can the anchor tile fit at this position in the shape?
   */
  function anchorMatchesSlot(originalAnchor, anchorConcrete, shape, anchorPos) {
    const slot = shape[anchorPos];
    const anchorType = anchorConcrete.type;

    if (slot.kind === 'eq') return anchorType === 'equals' || anchorType === 'blank';
    if (slot.kind === 'op') return anchorType === 'op' || anchorType === 'choice' || anchorType === 'blank';
    if (slot.kind === 'num') {
      // Number slot — anchor must be digit, twodigit, or blank
      if (slot.size === 1) {
        return anchorType === 'digit' || anchorType === 'twodigit' || anchorType === 'blank';
      } else {
        // Multi-digit slot can't contain twodigit
        return anchorType === 'digit' || anchorType === 'blank';
      }
    }
    return false;
  }

  /**
   * Assign tiles to shape, forcing the anchor at position `anchorPos`.
   * This is a wrapper around tryAssignShape with the anchor pre-allocated.
   */
  function tryAssignWithAnchor(shape, rackCat, originalAnchor, anchorConcrete, anchorPos, deadline) {
    // Remove anchor from the available pool before trying assignment
    // (since it'll be placed at anchorPos by definition)
    const modifiedCat = {
      digits: rackCat.digits.slice(),
      twodigits: rackCat.twodigits.slice(),
      blanks: rackCat.blanks.slice(),
      opByFace: {
        '+': rackCat.opByFace['+'].slice(),
        '-': rackCat.opByFace['-'].slice(),
        '×': rackCat.opByFace['×'].slice(),
        '÷': rackCat.opByFace['÷'].slice(),
      },
      choicePM: rackCat.choicePM.slice(),
      choiceMD: rackCat.choiceMD.slice(),
      equals: rackCat.equals.slice(),
    };

    // Remove anchor tile from its pool
    const t = anchorConcrete;
    let removed = false;
    if (t.type === 'digit') {
      removed = removeById(modifiedCat.digits, t.id);
    } else if (t.type === 'twodigit') {
      removed = removeById(modifiedCat.twodigits, t.id);
    } else if (t.type === 'op') {
      removed = removeById(modifiedCat.opByFace[t.face], t.id);
    } else if (t.type === 'equals') {
      removed = removeById(modifiedCat.equals, t.id);
    } else if (t.type === 'choice') {
      if (t.face === '+/-') removed = removeById(modifiedCat.choicePM, t.id);
      else if (t.face === '×/÷') removed = removeById(modifiedCat.choiceMD, t.id);
    } else if (t.type === 'blank') {
      removed = removeById(modifiedCat.blanks, t.id);
    }

    // Now try assignment — but we need to "lock" the anchor slot to use the anchor tile.
    // Simpler: call tryAssignShape and check that the result uses the anchor.
    const result = tryAssignShape(shape, modifiedCat, deadline);
    if (!result || result.timeout) return result;

    // Insert the anchor into the result at anchorPos
    // result.tokens is a flat list, but each NUM slot may contribute multiple tokens.
    // We need to map shape slots to token ranges.
    return insertAnchorIntoResult(result, originalAnchor, anchorConcrete, shape, anchorPos);
  }

  function removeById(arr, id) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === id) {
        arr.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * Insert the anchor tile into the result.
   * `anchorTokenIdx` is the token-position the anchor should occupy.
   * We swap the result's token at that position with the anchor.
   * Returns updated result, or null if face mismatch.
   */
  function insertAnchorIntoResult(result, originalAnchor, anchorConcrete, shape, anchorTokenIdx) {
    if (anchorTokenIdx >= result.tokens.length) return null;

    const targetToken = result.tokens[anchorTokenIdx];
    if (!targetToken) return null;

    const anchorFace = anchorConcrete.face;
    if (targetToken.face !== anchorFace) return null;

    // Swap the tile reference (the assigned face stays the same)
    targetToken.tile = originalAnchor;
    targetToken.isAnchor = true;
    return result;
  }

  /**
   * Place the tokens on the board with the anchor at its existing position.
   * Returns array of placements (NEW tiles only, not the anchor).
   */
  function buildBoardPlacements(board, tokens, anchor, anchorTokenIdx) {
    if (anchorTokenIdx < 0 || anchorTokenIdx >= tokens.length) return null;

    const anchorToken = tokens[anchorTokenIdx];
    if (!anchorToken || !anchorToken.tile) return null;

    // Try horizontal and vertical placement.
    // NOTE: bridge placements (T-shape Bingos that span over existing tiles)
    // are NOT supported in size-9 search because the token count must match
    // tile count exactly for a true Bingo (8 placed tiles + 1 anchor).
    // T-shape support would require generating LARGER shapes (size 10+) and
    // marking which tokens are bridges. Deferred — see Priority 4 notes.

    for (const orientation of ['h', 'v']) {
      const dr = orientation === 'v' ? 1 : 0;
      const dc = orientation === 'h' ? 1 : 0;

      let valid = true;
      const placements = [];

      for (let i = 0; i < tokens.length; i++) {
        const offset = i - anchorTokenIdx;
        const r = anchor.row + offset * dr;
        const c = anchor.col + offset * dc;

        if (r < 0 || r >= C.BOARD_SIZE || c < 0 || c >= C.BOARD_SIZE) {
          valid = false;
          break;
        }

        const cell = Board.getCell(board, r, c);
        if (!cell) { valid = false; break; }

        if (i === anchorTokenIdx) {
          // Anchor cell — must have the anchor tile already
          if (!cell.tile || cell.tile.id !== tokens[i].tile.id) {
            valid = false;
            break;
          }
        } else {
          // New placement cell — must be empty
          if (cell.tile) { valid = false; break; }
          placements.push({
            row: r,
            col: c,
            tile: tokens[i].tile,
            assigned: tokens[i].assigned,
          });
        }
      }

      if (valid && placements.length === 8) return placements;
    }

    return null;
  }

  function validatePlacementsOnBoard(board, placements) {
    if (!Placement || !Placement.validatePlay) return { valid: true };

    // Fast pre-filter: catch obviously illegal placements (e.g., digit next to
    // a twodigit tile) without running full equation parsing. Saves time on
    // doomed candidates that would have failed validation anyway.
    if (window.AMath.aiX9 && window.AMath.aiX9.isPlaySyntacticallyLegal) {
      if (!window.AMath.aiX9.isPlaySyntacticallyLegal(board, placements)) {
        return { valid: false, reason: 'syntactic pre-check failed' };
      }
    }

    const applied = [];
    try {
      for (const p of placements) {
        if (p.assigned) p.tile.assigned = p.assigned;
        Board.placeTile(board, p.row, p.col, p.tile);
        applied.push(p);
      }
      const res = Placement.validatePlay(board, placements);
      return {
        valid: res.ok !== false,
        reason: res.reason,
        equations: res.equations,
      };
    } catch (err) {
      return { valid: false, reason: err.message };
    } finally {
      for (const p of applied) Board.removeTile(board, p.row, p.col);
    }
  }

  function scoreBingo(board, placements, equations) {
    if (!Scoring || !Scoring.scorePlay || !equations) return 0;
    const applied = [];
    try {
      for (const p of placements) {
        if (p.assigned) p.tile.assigned = p.assigned;
        Board.placeTile(board, p.row, p.col, p.tile);
        applied.push(p);
      }
      const s = Scoring.scorePlay(equations, board, placements.length);
      return s.total;
    } finally {
      for (const p of applied) Board.removeTile(board, p.row, p.col);
    }
  }

  // ========================================================================
  // EXPORTS
  // ========================================================================

  window.AMath = window.AMath || {};
  window.AMath.aiBingoGrammar = {
    findGrammarBingo: findGrammarBingo,
    // For testing/debugging:
    generateShapes: generateShapes,
    generateSideShapes: generateSideShapes,
  };
})();
