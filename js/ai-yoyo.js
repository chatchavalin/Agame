/**
 * A-Math AI — YoYo Strategy
 *
 * Finds YoYo plays: extending an existing 8-14 tile equation on a valid line
 * to exactly 15 tiles, with at least 1 newly-placed tile on a 3E square.
 *
 * Valid lines: row 0, 7, 14 and col 0, 7, 14
 *
 * Search approach (hybrid):
 *   1. Try "easy extension" patterns first (0+, +0, 1×, etc.)
 *   2. Fall back to brute-force on valid lines
 *
 * Search finds ALL valid YoYos, then picks the highest-scoring one.
 * Prefer non-BLANK YoYos when both exist.
 */
(function () {
  const C = window.AMath.constants;
  const Board = window.AMath.board;
  const Evaluator = window.AMath.evaluator;
  const Scoring = window.AMath.scoring;
  const Placement = window.AMath.placement;
  const Utils = window.AMath.utils;
  /**
   * Find the best YoYo play (highest score, prefer non-BLANK).
   * @param state: { board, aiRack, isFirstMove }
   * @returns { placements, score, equations } or null
   */
  function findBestYoYo(state) {
    const candidates = findAllYoYos(state);
    if (candidates.length === 0) return null;
    // Separate BLANK-using and non-BLANK candidates
    const nonBlank = candidates.filter(c => !c.usesBlank);
    const pool = nonBlank.length > 0 ? nonBlank : candidates;
    // Pick highest score
    pool.sort((a, b) => b.score - a.score);
    return pool[0];
  }
  /**
   * Find ALL valid YoYos on the board.
   */
  function findAllYoYos(state) {
    const results = [];
    const startTime = Date.now();
    // Adaptive global budget based on BLANK count.
    // Hard racks need more total time across all lines/sets.
    // Per-position-set deadline is computed inside searchTileAssignments() and
    // also adapts to BLANK count (1.5s-4s).
    //
    // If the caller passed _maxTimeMs (e.g., from ai-player.js telling us how
    // much of the AI's total budget remains), respect that as an upper bound.
    const blanks = state.aiRack.tiles.filter(t => t.type === 'blank').length;
    const adaptive = blanks >= 4 ? 30000
                   : blanks === 3 ? 25000
                                  : 20000;
    const TIME_BUDGET_MS = (typeof state._maxTimeMs === 'number')
                         ? Math.min(adaptive, state._maxTimeMs)
                         : adaptive;
    for (const line of C.YOYO_LINES) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break;
      // Find existing equation on this line
      const existing = findExistingEquationOnLine(state.board, line);
      if (!existing) continue;
      // Check length is 8-14
      if (existing.length < C.YOYO_EXISTING_MIN || existing.length > C.YOYO_EXISTING_MAX) continue;
      // Find empty positions on this line that need to be filled to reach 15 tiles
      const numToPlace = C.YOYO_TOTAL_LENGTH - existing.length;
      if (numToPlace < C.YOYO_PLACE_MIN || numToPlace > C.YOYO_PLACE_MAX) continue;
      if (numToPlace > state.aiRack.tiles.length) continue;
      // Find candidate placement positions (3 strategies: forward, backward, both-ends)
      const positionSets = enumeratePlacementPositions(state.board, line, existing, numToPlace);
      for (const positions of positionSets) {
        if (Date.now() - startTime > TIME_BUDGET_MS) break;
        // Check at least one position is 3E
        const hits3E = positions.some(p => isThreeE(p.row, p.col));
        if (!hits3E) continue;
        // Try tile permutations on these positions
        const yoyoResults = searchTileAssignments(state, line, existing, positions, startTime, TIME_BUDGET_MS);
        for (const yr of yoyoResults) results.push(yr);
      }
    }
    return results;
  }
  /**
   * Find an existing equation on a given line.
   * Returns { tiles: [{row, col, tile}], startIdx, endIdx, length, direction }
   * or null if no valid equation.
   */
  function findExistingEquationOnLine(board, line) {
    const cells = getLineCells(board, line);
    // Find the longest contiguous sequence of tiles
    let bestStart = -1, bestEnd = -1, bestLen = 0;
    let curStart = -1, curLen = 0;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].tile) {
        if (curStart === -1) curStart = i;
        curLen++;
        if (curLen > bestLen) {
          bestLen = curLen;
          bestStart = curStart;
          bestEnd = i;
        }
      } else {
        curStart = -1;
        curLen = 0;
      }
    }
    if (bestLen < C.YOYO_EXISTING_MIN) return null;
    const tiles = [];
    for (let i = bestStart; i <= bestEnd; i++) {
      tiles.push({ row: cells[i].row, col: cells[i].col, tile: cells[i].tile });
    }
    return {
      tiles: tiles,
      startIdx: bestStart,
      endIdx: bestEnd,
      length: bestLen,
      direction: line.type === 'row' ? 'horizontal' : 'vertical',
    };
  }
  /**
   * Get cells in a line as an array of { row, col, tile (or null) }.
   */
  function getLineCells(board, line) {
    const cells = [];
    if (line.type === 'row') {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = Board.getCell(board, line.index, c);
        cells.push({ row: line.index, col: c, tile: cell ? cell.tile : null });
      }
    } else {
      for (let r = 0; r < C.BOARD_SIZE; r++) {
        const cell = Board.getCell(board, r, line.index);
        cells.push({ row: r, col: line.index, tile: cell ? cell.tile : null });
      }
    }
    return cells;
  }
  /**
   * Enumerate possible placement position sets.
   * Returns array of arrays of {row, col} positions.
   *
   * Three strategies:
   *   - Forward: extend AFTER the existing equation (positions startEnd+1 .. startEnd+numToPlace)
   *   - Backward: extend BEFORE the existing equation
   *   - Both: split tiles between before and after
   */
  function enumeratePlacementPositions(board, line, existing, numToPlace) {
    const cells = getLineCells(board, line);
    const sets = [];
    // Forward: positions after existing
    const forwardPositions = [];
    for (let i = existing.endIdx + 1; i <= existing.endIdx + numToPlace && i < cells.length; i++) {
      if (cells[i].tile) break; // can't place if occupied
      forwardPositions.push({ row: cells[i].row, col: cells[i].col });
    }
    if (forwardPositions.length === numToPlace) sets.push(forwardPositions);
    // Backward: positions before existing
    const backwardPositions = [];
    for (let i = existing.startIdx - 1; i >= existing.startIdx - numToPlace && i >= 0; i--) {
      if (cells[i].tile) break;
      backwardPositions.unshift({ row: cells[i].row, col: cells[i].col });
    }
    if (backwardPositions.length === numToPlace) sets.push(backwardPositions);
    // Both ends: try various splits
    for (let frontCount = 1; frontCount < numToPlace; frontCount++) {
      const backCount = numToPlace - frontCount;
      const front = [];
      const back = [];
      // Place 'frontCount' before existing
      for (let i = existing.startIdx - 1; i >= existing.startIdx - frontCount && i >= 0; i--) {
        if (cells[i].tile) { front.length = 0; break; }
        front.unshift({ row: cells[i].row, col: cells[i].col });
      }
      if (front.length !== frontCount) continue;
      // Place 'backCount' after existing
      for (let i = existing.endIdx + 1; i <= existing.endIdx + backCount && i < cells.length; i++) {
        if (cells[i].tile) { back.length = 0; break; }
        back.push({ row: cells[i].row, col: cells[i].col });
      }
      if (back.length !== backCount) continue;
      sets.push(front.concat(back));
    }
    return sets;
  }
  /**
   * Check if (row, col) is a 3E square.
   */
  function isThreeE(row, col) {
    for (const sq of C.THREE_E_SQUARES) {
      if (sq[0] === row && sq[1] === col) return true;
    }
    return false;
  }
  /**
   * Cheap pre-filter for YoYo placements: examines the FACE SEQUENCE on the line
   * (after virtually placing the new tiles) and rejects sequences with obvious
   * structural problems.
   *
   * This is purely an optimization — it doesn't replace the real validator.
   * It rejects ~30-50% of impossible permutations BEFORE the expensive
   * board-mutate / parse / scoring cycle.
   *
   * Returns false if obvious problem, true if maybe-valid (run full validator).
   */
  function quickSanityCheck(board, line, positions, placements) {
    // Build face sequence along the line: each cell's face, or null if empty
    // (won't be empty after placement since we add the new tiles).
    const isRow = line.type === 'row';
    const lineIndex = line.index;
    // Build a quick lookup: position → face from placements
    const newFaceAt = {};
    for (const p of placements) {
      const key = isRow ? p.col : p.row;
      newFaceAt[key] = p.tile.assigned || p.tile.face;
    }
    // Walk the line and build the face sequence (existing tiles + new tiles)
    const faces = [];
    const start = isRow ? 0 : 0;
    const end = C.BOARD_SIZE - 1;
    for (let i = start; i <= end; i++) {
      const r = isRow ? lineIndex : i;
      const c = isRow ? i : lineIndex;
      const newF = newFaceAt[i];
      if (newF !== undefined) {
        faces.push(newF);
      } else {
        const cell = Board.getCell(board, r, c);
        if (cell && cell.tile) {
          faces.push(cell.tile.assigned || cell.tile.face);
        } else {
          faces.push(null);   // empty cell
        }
      }
    }
    // Find the contiguous run that includes the placements
    // (need to find min/max index of NON-NULL faces)
    let minIdx = -1, maxIdx = -1;
    for (let i = 0; i < faces.length; i++) {
      if (faces[i] !== null) {
        if (minIdx === -1) minIdx = i;
        maxIdx = i;
      }
    }
    if (minIdx === -1) return false;
    // Check no gaps in [minIdx..maxIdx]
    for (let i = minIdx; i <= maxIdx; i++) {
      if (faces[i] === null) return false;  // gap in equation
    }
    // Extract the relevant sequence
    const seq = faces.slice(minIdx, maxIdx + 1);
    // Rule 1: must have at least one '='
    let hasEq = false;
    for (const f of seq) {
      if (f === '=') { hasEq = true; break; }
    }
    if (!hasEq) return false;
    // Rule 2: no two adjacent operators. EXCEPT: unary '-' is allowed after '='
    // (or at the start of the equation, which is handled by Rule 3).
    // E.g., "5=-3" is valid: '=' then '-'. But "5+-3" is invalid: '+' then '-' both binary.
    function isOp(f) { return f === '+' || f === '-' || f === '×' || f === '÷'; }
    function isEq(f) { return f === '='; }
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i];
      const b = seq[i + 1];
      // Two operators adjacent (both +-×÷): never allowed
      if (isOp(a) && isOp(b)) return false;
      // '=' followed by op: only '-' (unary) is allowed
      if (isEq(a) && isOp(b) && b !== '-') return false;
      // op followed by '=': never allowed (op at end of segment)
      if (isOp(a) && isEq(b)) return false;
      // '=' followed by '=': never allowed
      if (isEq(a) && isEq(b)) return false;
    }
    // Rule 3: equation can't start or end with binary operator
    // (start can be unary '-' though)
    const first = seq[0];
    const last = seq[seq.length - 1];
    if (first === '+' || first === '×' || first === '÷' || first === '=') return false;
    if (last === '+' || last === '-' || last === '×' || last === '÷' || last === '=') return false;
    // Rule 4: leading zero on multi-digit numbers
    // A "number group" is a contiguous run of digit faces. If it starts with '0'
    // and has length > 1, that's invalid leading zero.
    // (Single '0' is fine.)
    function isSingleDigit(f) {
      return f && f.length === 1 && f >= '0' && f <= '9';
    }
    function isTwoDigit(f) {
      // Two-digit tile face: '10'..'20'
      return f && f.length === 2 && /^([1][0-9]|20)$/.test(f);
    }
    function isAnyNumber(f) { return isSingleDigit(f) || isTwoDigit(f); }
    let inNumber = false;
    let numberStart = -1;
    for (let i = 0; i < seq.length; i++) {
      if (isSingleDigit(seq[i])) {
        if (!inNumber) {
          inNumber = true;
          numberStart = i;
        }
      } else {
        if (inNumber) {
          // Number ended at i-1; length = i - numberStart
          const numLen = i - numberStart;
          if (numLen > 1 && seq[numberStart] === '0') return false;  // leading zero
          if (numLen > 3) return false;  // max 3 digits per A-Math
          inNumber = false;
        }
      }
    }
    // Check final number
    if (inNumber) {
      const numLen = seq.length - numberStart;
      if (numLen > 1 && seq[numberStart] === '0') return false;
      if (numLen > 3) return false;
    }
    // Rule 5: a two-digit tile can't be adjacent to any other number tile.
    // (Two adjacent number tokens with no operator between them is invalid.)
    // Note: single digits CAN concatenate into multi-digit numbers (tokenizer handles this),
    // but a two-digit tile is already a "complete" number.
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i];
      const b = seq[i + 1];
      if (isTwoDigit(a) && isAnyNumber(b)) return false;
      if (isAnyNumber(a) && isTwoDigit(b)) return false;
    }
    return true;
  }
  /**
   * Compute "expected type" for each placement position based on adjacent cells
   * in the line. Returns array of 'digit' | 'op' | 'mixed' per position.
   *
   * Heuristic:
   *   - If both adjacent cells in the line are digits → this position is likely an op
   *   - If both adjacent cells are ops/equals → this position is likely a digit
   *   - Mixed or edge: 'mixed' (try both)
   */
  function computeContextHints(board, line, positions) {
    const isLineDirRow = line.type === 'row';
    const hints = [];
    for (const p of positions) {
      let prev = null, next = null;
      if (isLineDirRow) {
        const prevCell = Board.getCell(board, p.row, p.col - 1);
        const nextCell = Board.getCell(board, p.row, p.col + 1);
        prev = prevCell && prevCell.tile;
        next = nextCell && nextCell.tile;
      } else {
        const prevCell = Board.getCell(board, p.row - 1, p.col);
        const nextCell = Board.getCell(board, p.row + 1, p.col);
        prev = prevCell && prevCell.tile;
        next = nextCell && nextCell.tile;
      }
      const prevType = prev ? prev.type : null;
      const nextType = next ? next.type : null;
      const prevIsDigit = prevType === 'digit' || prevType === 'twodigit';
      const nextIsDigit = nextType === 'digit' || nextType === 'twodigit';
      const prevIsOp = prevType === 'op' || prevType === 'equals' || prevType === 'choice';
      const nextIsOp = nextType === 'op' || nextType === 'equals' || nextType === 'choice';
      if (prevIsDigit && nextIsDigit) {
        // Between two digits — most likely an operator (or could be part of multi-digit)
        hints.push('op-or-digit');
      } else if (prevIsOp && nextIsOp) {
        // Between two operators — must be a digit (you can't have two ops adjacent without a number)
        hints.push('digit');
      } else if (prevIsDigit || nextIsDigit) {
        // Adjacent to at least one digit
        hints.push('mixed');
      } else if (prevIsOp || nextIsOp) {
        // Adjacent to at least one op
        hints.push('digit-likely');
      } else {
        hints.push('mixed');
      }
    }
    return hints;
  }
  /**
   * Get a prioritized list of BLANK faces based on context hint.
   */
  function blankFacesForHint(hint, allChoices) {
    const ops = ['+', '-', '×', '÷', '='];
    const smallDigits = ['1', '2', '0', '3', '4', '5'];
    const largeDigits = ['6', '7', '8', '9'];
    const twodigits = ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'];
    const priority = [];
    const seen = new Set();
    function push(arr) {
      for (const f of arr) {
        if (allChoices.indexOf(f) !== -1 && !seen.has(f)) {
          priority.push(f);
          seen.add(f);
        }
      }
    }
    if (hint === 'digit') {
      push(smallDigits);
      push(largeDigits);
      push(twodigits);
      push(ops);     // fallback
    } else if (hint === 'op-or-digit') {
      push(ops);
      push(smallDigits);
      push(largeDigits);
      push(twodigits);
    } else if (hint === 'digit-likely') {
      push(smallDigits);
      push(largeDigits);
      push(ops);
      push(twodigits);
    } else {
      // mixed: balanced
      push(ops);
      push(smallDigits);
      push(largeDigits);
      push(twodigits);
    }
    // Append anything missing
    for (const ch of allChoices) {
      if (!seen.has(ch)) priority.push(ch);
    }
    return priority;
  }
  /**
   * Try all permutations of rack tiles on the given positions.
   *
   * OPTIMIZED:
   *  - Removed hard MAX_PERMUTATIONS cap; relies on time budget
   *  - Pre-compute compatibility: skip permutations where tile face can't fit position
   *    (e.g., =' tile placed where a digit is expected can be detected via existing-equation context)
   *  - Smart BLANK pruning: try only digits + ops, not all 21 faces (cuts 21x → ~14x)
   *  - First-found per position-set: stop after first valid YoYo per set
   *  - Validates EVERY candidate, but the validator is fast
   *
   * Notes:
   *  - We need to find at least ONE valid YoYo per position set, ideally high-scoring
   *  - The validator (validateAndScore) catches invalid equations, so we can be liberal here
   */
  function searchTileAssignments(state, line, existing, positions, startTime, timeBudget) {
    const results = [];
    const rackTiles = state.aiRack.tiles.slice();
    const numPositions = positions.length;
    let foundForThisSet = false;
    // Adaptive per-set deadline based on BLANK count.
    // With many BLANKs, each set needs more time to find valid permutations.
    //   0-1 BLANKs: 3s
    //   2 BLANKs:   5s
    //   3 BLANKs:   8s
    //   4+ BLANKs:  10s
    const blankCount = rackTiles.filter(t => t.type === 'blank').length;
    const perSetMs = blankCount >= 4 ? 10000
                   : blankCount === 3 ? 8000
                   : blankCount === 2 ? 5000
                                      : 3000;
    const setDeadline = Math.min(startTime + timeBudget, Date.now() + perSetMs);
    // Pre-compute context hints for each position (cuts BLANK enumeration drastically)
    const contextHints = computeContextHints(state.board, line, positions);
    const allBlankChoices = (C.getBlankChoices ? C.getBlankChoices() : C.BLANK_CHOICES);
    function tryPermutation(remaining, chosen) {
      if (Date.now() > setDeadline) return;
      if (chosen.length === numPositions) {
        const placements = chosen.map((tile, i) => ({
          row: positions[i].row,
          col: positions[i].col,
          tile: tile,
        }));
        const tryAssignments = (idx) => {
          if (Date.now() > setDeadline) return;
          if (idx === placements.length) {
            // CHEAP PRE-FILTER: examine the line's face sequence after placement
            // and reject obvious problems before the expensive validator.
            // This is purely an optimization — validateAndScore is correct either way.
            if (!quickSanityCheck(state.board, line, positions, placements)) return;
            const before = results.length;
            validateAndScore(state, placements, results);
            if (results.length > before) foundForThisSet = true;
            return;
          }
          const p = placements[idx];
          if (p.tile.type === 'blank') {
            // CONTEXT-AWARE: order BLANK assignments by what's likely to fit
            const hint = contextHints[idx];
            const priorityFaces = blankFacesForHint(hint, allBlankChoices);
            for (const ch of priorityFaces) {
              p.tile.assigned = ch;
              tryAssignments(idx + 1);
              if (Date.now() > setDeadline) { p.tile.assigned = null; return; }
            }
            p.tile.assigned = null;
          } else if (p.tile.type === 'choice') {
            const choices = p.tile.face === '+/-' ? ['+', '-'] : ['×', '÷'];
            for (const ch of choices) {
              p.tile.assigned = ch;
              tryAssignments(idx + 1);
              if (Date.now() > setDeadline) { p.tile.assigned = null; return; }
            }
            p.tile.assigned = null;
          } else {
            tryAssignments(idx + 1);
          }
        };
        tryAssignments(0);
        return;
      }
      for (let i = 0; i < remaining.length; i++) {
        const tile = remaining[i];
        const next = remaining.slice(0, i).concat(remaining.slice(i + 1));
        chosen.push(tile);
        tryPermutation(next, chosen);
        chosen.pop();
        if (Date.now() > setDeadline) return;
      }
    }
    tryPermutation(rackTiles, []);
    return results;
  }
  /**
   * Validate a YoYo placement and compute score.
   * If valid, push to results array.
   */
  function validateAndScore(state, placements, results) {
    // Temporarily place tiles on board for validation
    const tempBoard = state.board;
    const placedAt = [];
    for (const p of placements) {
      const cell = Board.getCell(tempBoard, p.row, p.col);
      if (!cell || cell.tile) {
        // Cleanup any tiles already placed
        for (const pa of placedAt) {
          Board.removeTile(tempBoard, pa.row, pa.col);
        }
        return;
      }
      Board.placeTile(tempBoard, p.row, p.col, p.tile);
      placedAt.push({ row: p.row, col: p.col });
    }
    // Validate
    const validation = Placement.validatePlay(tempBoard, placements, state.isFirstMove);
    let score = 0;
    let equations = [];
    let valid = validation.ok;
    if (valid && validation.equations) {
      try {
        const scoreResult = Scoring.scorePlay(validation.equations, tempBoard, placements.length);
        score = scoreResult.total;
        equations = validation.equations;
      } catch (e) {
        valid = false;
      }
    }
    // Cleanup: remove placed tiles
    for (const pa of placedAt) {
      Board.removeTile(tempBoard, pa.row, pa.col);
    }
    if (valid && score > 0) {
      const usesBlank = placements.some(p => p.tile.type === 'blank');
      results.push({
        placements: placements.map(p => ({
          row: p.row, col: p.col,
          tile: p.tile,
          assigned: p.tile.assigned || null,
        })),
        score: score,
        equations: equations,
        usesBlank: usesBlank,
        type: 'yoyo',
      });
    }
  }
  window.AMath = window.AMath || {};
  window.AMath.aiYoyo = {
    findBestYoYo: findBestYoYo,
    findAllYoYos: findAllYoYos,
  };
})();
