/**
 * A-Math AI — ×4 Threat Detection
 *
 * ×4 occurs when an equation passes through TWO empty 2E squares in the same
 * row/col, giving a 2×2 = 4 multiplier on the equation.
 *
 * Less severe than ×9, but if opponent can do it with a SHORT equation (just
 * 1-3 new tiles), the risk/reward becomes terrible:
 *   - AI scores 20-30 pts on the play that opens the threat
 *   - Opponent scores 30-60 pts with a short equation × 4
 *   - Net loss for AI
 *
 * ×4 lines on the standard A-Math board:
 *   Rows: 1 (cols 1,13), 2 (cols 2,12), 3 (cols 3,11),
 *        11 (cols 3,11), 12 (cols 2,12), 13 (cols 1,13)
 *   Cols: same pattern, swapped
 *
 * AI's policy: don't CREATE a new ×4 threat with a short feasible equation
 *   ("short feasible" = opponent can complete a valid equation using ≤4 new tiles
 *    that lands on both 2E squares).
 *
 * Detection logic mirrors ×9 but simpler:
 *   1. Both 2E squares on the line are empty
 *   2. The line between them is mostly empty (≤5 between)
 *   3. There's an adjacent tile so opponent can hook onto the line
 *      (either ON the line itself, or on adjacent subrim row/col)
 */

(function () {
  const C = window.AMath.constants;
  const Board = window.AMath.board;

  // Lines that have two 2E squares (extracted from PREMIUM_SQUARES at module init)
  // Each line: { type: 'row'|'col', index: N, a: idxA, b: idxB }
  const X4_LINES = computeX4Lines();

  function computeX4Lines() {
    const lines = [];
    const squares = C.PREMIUM_SQUARES;
    // Rows
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      const positions = [];
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        if (squares[r][c] === '2E') positions.push(c);
      }
      // Take all pairs
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          lines.push({ type: 'row', index: r, a: positions[i], b: positions[j] });
        }
      }
    }
    // Cols
    for (let c = 0; c < C.BOARD_SIZE; c++) {
      const positions = [];
      for (let r = 0; r < C.BOARD_SIZE; r++) {
        if (squares[r][c] === '2E') positions.push(r);
      }
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          lines.push({ type: 'col', index: c, a: positions[i], b: positions[j] });
        }
      }
    }
    return lines;
  }

  /**
   * Detect all ×4 threats currently on the board.
   * Threat exists when both 2E squares are empty, line between is short,
   * and there's an adjacent tile for opponent to hook onto.
   */
  function detectAllThreats(board) {
    const threats = [];
    for (const line of X4_LINES) {
      const threat = detectThreatOnLine(board, line);
      if (threat) threats.push(threat);
    }
    return threats;
  }

  function detectThreatOnLine(board, line) {
    // Both 2E endpoints must be empty (otherwise premium already consumed)
    const cellA = getCellAt(board, line, line.a);
    const cellB = getCellAt(board, line, line.b);
    if (!cellA || !cellB) return null;
    if (cellA.tile || cellB.tile) return null;

    // To exploit this threat, opponent's play must form a valid equation
    // that lands on BOTH 2E squares (line.a and line.b).
    //
    // The equation can be exactly the line from a to b (span+1 cells), or longer
    // (extending beyond), but it must INCLUDE both 2Es.
    //
    // Minimum tiles opponent needs to PLACE = empty cells on [line.a ... line.b]
    // (including both endpoints; existing tiles serve as "free" anchors).
    //
    // Hook requirement: opponent needs at least 1 tile somewhere they can connect to.
    // Either:
    //   - A tile already on the line (between a and b) — opponent extends through it
    //   - A tile on adjacent row/col within [a..b] — opponent plays perpendicular T-shape
    //   - A tile beyond the 2Es on the line (opponent extends existing equation outward)
    //
    // We accept threat if newTilesNeeded ≤ 7.

    let newTilesNeeded = 2; // both 2E squares are empty
    let hasOnLineHook = false;
    for (let i = line.a + 1; i < line.b; i++) {
      const cell = getCellAt(board, line, i);
      if (cell && cell.tile) {
        hasOnLineHook = true;
      } else {
        newTilesNeeded++;
      }
    }

    if (newTilesNeeded > 7) return null;

    // Also need a hook (existing tile to connect to)
    // We accept: on-line hook (tile between 2Es) OR adjacent subrim hook
    let hasHook = hasOnLineHook;
    if (!hasHook) {
      hasHook = hasAdjacentHook(board, line);
    }
    // Also: tile JUST beyond either 2E (one cell beyond a or b) can serve as hook
    // (opponent's equation extends one cell further to that tile)
    if (!hasHook) {
      hasHook = hasBeyondHook(board, line);
    }
    if (!hasHook) return null;

    return {
      line: line,
      positionA: cellPosition(line, line.a),
      positionB: cellPosition(line, line.b),
      newTilesNeeded: newTilesNeeded,
      hasOnLineHook: hasOnLineHook,
    };
  }

  /**
   * Check if a tile sits just BEYOND the 2E squares (line.a - 1 or line.b + 1).
   * Such a tile lets opponent's equation extend past the 2E.
   */
  function hasBeyondHook(board, line) {
    if (line.a > 0) {
      const cellBefore = getCellAt(board, line, line.a - 1);
      if (cellBefore && cellBefore.tile) return true;
    }
    if (line.b < C.BOARD_SIZE - 1) {
      const cellAfter = getCellAt(board, line, line.b + 1);
      if (cellAfter && cellAfter.tile) return true;
    }
    return false;
  }

  function getCellAt(board, line, idx) {
    if (line.type === 'row') return Board.getCell(board, line.index, idx);
    return Board.getCell(board, idx, line.index);
  }

  function cellPosition(line, idx) {
    return line.type === 'row'
      ? { row: line.index, col: idx }
      : { row: idx, col: line.index };
  }

  /**
   * Check if there's a tile on a line adjacent (1 away) to the threat line,
   * giving opponent a T-hook to play a perpendicular equation through the 2Es.
   */
  function hasAdjacentHook(board, line) {
    // Check the two rows/cols adjacent to this line
    const offsets = [-1, +1];
    for (const off of offsets) {
      const adjIdx = line.index + off;
      if (adjIdx < 0 || adjIdx >= C.BOARD_SIZE) continue;
      // Look for tiles on the adjacent row/col within the span [a, b]
      for (let i = line.a; i <= line.b; i++) {
        const r = line.type === 'row' ? adjIdx : i;
        const c = line.type === 'row' ? i : adjIdx;
        const cell = Board.getCell(board, r, c);
        if (cell && cell.tile) return true;
      }
    }
    return false;
  }

  /**
   * Check if a given play would CREATE a new ×4 threat that wasn't there before.
   *
   * Approach: detect threats before AND after the play, return true if new threats appeared.
   *
   * @param board: current board (without play applied)
   * @param placements: array of {row, col, tile} for the play
   * @returns true if play creates a new short-equation ×4 opportunity for opponent
   */
  function wouldCreateX4Threat(board, placements) {
    const before = detectAllThreats(board);
    const beforeKeys = new Set(before.map(threatKey));

    // Apply placements temporarily
    const applied = [];
    try {
      for (const p of placements) {
        if (Board.isCellEmpty(board, p.row, p.col)) {
          Board.placeTile(board, p.row, p.col, p.tile);
          applied.push(p);
        }
      }

      const after = detectAllThreats(board);
      for (const t of after) {
        if (!beforeKeys.has(threatKey(t))) {
          // NEW threat created!
          // Filter: only flag if the threat is SHORT (opponent can use small equation)
          // and the play doesn't ALREADY use one of the 2E squares
          if (isShortFeasibleThreat(t, placements)) {
            return true;
          }
        }
      }
      return false;
    } finally {
      // Restore board
      for (const p of applied) {
        Board.removeTile(board, p.row, p.col);
      }
    }
  }

  function isShortFeasibleThreat(threat, placements) {
    return threat.newTilesNeeded <= 7;
  }

  function threatKey(t) {
    return t.line.type + ':' + t.line.index + ':' + t.line.a + ':' + t.line.b;
  }

  window.AMath = window.AMath || {};
  window.AMath.aiX4 = {
    detectAllThreats: detectAllThreats,
    wouldCreateX4Threat: wouldCreateX4Threat,
    X4_LINES: X4_LINES,
  };
})();
