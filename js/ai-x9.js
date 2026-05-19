/**
 * A-Math AI — ×9 Threat Detection, Defense, and Offense
 *
 * ×9 occurs when an equation passes through TWO empty 3E squares in the same
 * row/col, giving a 3×3 = 9 multiplier on the equation.
 *
 * Detection happens on 6 lines: row 0, 7, 14 and col 0, 7, 14.
 *
 * Per line, 3 patterns:
 *   - Between positions 0 and 7 (corner-to-middle)
 *   - Between positions 7 and 14 (middle-to-corner)
 *   - Between positions 0 and 14 (entire line)
 *
 * Per PDF (full implementation):
 *   Threat exists when:
 *     1. Both 3E squares empty
 *     2. ≤5 empty cells between (or ≤6 for entire-line)
 *     3. Adjacent tile usable by opponent (Case 3.1: on line between 3Es,
 *        OR Case 3.2: on subrim, one row/col away, forming T-shape)
 *   Exceptions: certain two-digit tiles at corner-adjacent positions block ×9.
 *
 * Defense priority (when threat detected):
 *   1. Play ×9 yourself (best — block + score)
 *   2. Place equation on one of the 3E squares
 *   3. Subrim equation (longer = better)
 */

(function () {
  const C = window.AMath.constants;
  const Board = window.AMath.board;

  /**
   * Detect ALL ×9 threats currently on the board.
   * @returns array of threat objects, each: { line, threeE_a, threeE_b, adjacentInfo, severity }
   */
  function detectAllThreats(board) {
    const threats = [];

    for (const line of C.X9_LINES) {
      const lineThreats = detectThreatsOnLine(board, line);
      for (const t of lineThreats) threats.push(t);
    }

    return threats;
  }

  /**
   * Detect ×9 threats on a specific line.
   */
  function detectThreatsOnLine(board, line) {
    const threats = [];
    const cells = getLineCells(board, line);

    // 3 patterns: (0,7), (7,14), (0,14)
    const patterns = [
      { a: 0, b: 7, maxEmpty: 5 },
      { a: 7, b: 14, maxEmpty: 5 },
      { a: 0, b: 14, maxEmpty: 6 }, // entire line allows ≤6
    ];

    for (const p of patterns) {
      // Both endpoints must be empty
      if (cells[p.a].tile || cells[p.b].tile) continue;

      // Count empty cells between
      let emptyBetween = 0;
      for (let i = p.a + 1; i < p.b; i++) {
        if (!cells[i].tile) emptyBetween++;
      }
      const totalBetween = p.b - p.a - 1;
      const nonEmptyBetween = totalBetween - emptyBetween;

      // Skip if too few empty cells between (whole span filled = no threat)
      // Or all empty (no adjacent tile to hook onto)
      if (nonEmptyBetween < 1 && p.a !== 0 && p.b !== 14) {
        // Need subrim check (Case 3.2)
        if (!hasSubrimAdjacent(board, line, p.a, p.b)) continue;
      }

      // Apply max empty constraint
      if (emptyBetween > p.maxEmpty) continue;

      // Exception checks (PDF):
      // (0,13) two-digit blocks (0,14); (14,13) blocks (14,14); etc.
      if (isBlockedByTwoDigit(board, line, p.a, p.b)) continue;

      threats.push({
        line: line,
        positionA: cellPositionOnLine(line, p.a),
        positionB: cellPositionOnLine(line, p.b),
        emptyBetween: emptyBetween,
        nonEmptyBetween: nonEmptyBetween,
        severity: estimateThreatSeverity(emptyBetween, nonEmptyBetween),
      });
    }

    return threats;
  }

  /**
   * Get cells on a line.
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
   * Get the (row, col) of cell at index i on a line.
   */
  function cellPositionOnLine(line, idx) {
    return line.type === 'row'
      ? { row: line.index, col: idx }
      : { row: idx, col: line.index };
  }

  /**
   * Check if there's an adjacent tile on subrim that opponent can hook for T-form.
   */
  function hasSubrimAdjacent(board, line, idxA, idxB) {
    // Subrim is one row/col away from the line
    const subrimIndex = line.type === 'row'
      ? (line.index === 0 ? 1 : (line.index === 14 ? 13 : line.index === 7 ? 8 : -1))
      : (line.index === 0 ? 1 : (line.index === 14 ? 13 : line.index === 7 ? 8 : -1));

    if (subrimIndex < 0 || subrimIndex >= C.BOARD_SIZE) return false;

    for (let i = idxA + 1; i < idxB; i++) {
      const r = line.type === 'row' ? subrimIndex : i;
      const c = line.type === 'row' ? i : subrimIndex;
      const cell = Board.getCell(board, r, c);
      if (cell && cell.tile) return true;
    }
    return false;
  }

  /**
   * Check if a corner 3E is blocked by an adjacent two-digit tile.
   * Per PDF exceptions:
   *   - Two-digit at (0,13) blocks (0,14)
   *   - Two-digit at (13,0) blocks (14,0)
   *   - etc.
   */
  function isBlockedByTwoDigit(board, line, idxA, idxB) {
    const checkCorners = [];

    if (line.type === 'row') {
      if (idxA === 0) checkCorners.push({ checkAt: [line.index, 1], blocks: [line.index, 0] });
      if (idxB === 14) checkCorners.push({ checkAt: [line.index, 13], blocks: [line.index, 14] });
    } else {
      if (idxA === 0) checkCorners.push({ checkAt: [1, line.index], blocks: [0, line.index] });
      if (idxB === 14) checkCorners.push({ checkAt: [13, line.index], blocks: [14, line.index] });
    }

    for (const cc of checkCorners) {
      const cell = Board.getCell(board, cc.checkAt[0], cc.checkAt[1]);
      if (cell && cell.tile && cell.tile.type === 'twodigit') {
        return true; // This corner 3E is blocked
      }
    }
    return false;
  }

  /**
   * Estimate threat severity (higher = more urgent).
   */
  function estimateThreatSeverity(emptyBetween, nonEmptyBetween) {
    // Fewer empty between = easier for opponent to fill = higher severity
    return 100 - emptyBetween * 10 + nonEmptyBetween * 5;
  }

  /**
   * Pick the highest-severity threat to defend against.
   */
  function pickWorstThreat(threats) {
    if (threats.length === 0) return null;
    return threats.slice().sort((a, b) => b.severity - a.severity)[0];
  }

  /**
   * Find a defensive play that blocks a threat.
   * Strategy (per PDF):
   *   1. Play ×9 yourself (best — both block + high score)
   *   2. Place equation that uses one of the 3E squares
   *   3. Subrim equation
   *
   * Returns the best defensive play found, or null.
   */
  function findDefensivePlay(state, threat) {
    const AI = window.AMath.aiPlayer;
    if (!AI) return null;

    // For now, defense is implicit: AI's normal search will find plays that
    // happen to land on the threat's 3E squares. We score those higher.
    // This is delegated to ai-player.js's evaluator with a defense bonus.

    // Phase 1 implementation: just signal that defense is needed
    return null;
  }

  /**
   * Check if a play attempts to use one of the 3E squares involved in a threat.
   */
  function playBlocksThreat(placements, threat) {
    for (const p of placements) {
      if (p.row === threat.positionA.row && p.col === threat.positionA.col) return true;
      if (p.row === threat.positionB.row && p.col === threat.positionB.col) return true;
    }
    // Also check subrim
    return false;
  }

  /**
   * Try to find an offensive ×9 play (AI plays ×9 itself).
   * Returns the best ×9 play found, or null.
   *
   * NOTE: This searches via YoYo only (7-tile + hook). 8-tile Bingo ×9 plays
   * are handled by findBestPlay's natural score-based ranking, since ×9 gives
   * a 9x multiplier and naturally bubbles to the top.
   */
  function findOffensiveX9(state) {
    // This requires forming an equation that hits BOTH 3Es in a line.
    // For practical purposes, this is similar to YoYo but with stricter constraint.
    // We rely on the YoYo search + filter for plays that hit 2× 3Es.

    if (!window.AMath.aiYoyo) return null;

    const yoyos = window.AMath.aiYoyo.findAllYoYos(state);
    const x9Plays = yoyos.filter(y => {
      // Count how many placements land on 3E
      let threeECount = 0;
      for (const p of y.placements) {
        if (isThreeE(p.row, p.col)) threeECount++;
      }
      return threeECount >= 2;
    });

    if (x9Plays.length === 0) return null;

    // Pick highest scoring
    x9Plays.sort((a, b) => b.score - a.score);
    return x9Plays[0];
  }

  function isThreeE(row, col) {
    for (const sq of C.THREE_E_SQUARES) {
      if (sq[0] === row && sq[1] === col) return true;
    }
    return false;
  }

  /**
   * Detects "easy hook" threats: empty 3E squares that the opponent can reach
   * with a small number of tiles by using an existing nearby tile as a hook.
   *
   * This is a lighter-weight threat than ×9 — it covers the case where the
   * opponent can hit a SINGLE 3E (×3 multiplier) cheaply, not just the double-3E ×9 case.
   *
   * @param board   The board to analyze
   * @param maxGap  How few empty cells between the nearest tile and the 3E to flag (default 4)
   * @returns array of threats: { row, col, hookRow, hookCol, gap }
   */
  function detectEasy3EHookThreats(board, maxGap) {
    if (typeof maxGap !== 'number') maxGap = 4;
    const threats = [];

    for (const [tr, tc] of C.THREE_E_SQUARES) {
      // Skip if the 3E square is already occupied
      const cell = Board.getCell(board, tr, tc);
      if (!cell || cell.tile) continue;

      // Skip the center (7,7) — it's not really a "corner hook" risk in the same way
      if (tr === 7 && tc === 7) continue;

      // Check along the row: any tile within maxGap cells to left or right?
      for (let dc = 1; dc <= maxGap; dc++) {
        for (const sign of [-1, 1]) {
          const r = tr;
          const c = tc + sign * dc;
          if (c < 0 || c >= C.BOARD_SIZE) continue;
          const adj = Board.getCell(board, r, c);
          if (adj && adj.tile) {
            // Found a hook tile. Check that ALL cells between (tr,tc) and (r,c) are empty
            // (so opponent can place a contiguous line of tiles to extend the equation)
            let allEmpty = true;
            const lo = Math.min(tc, c) + 1;
            const hi = Math.max(tc, c) - 1;
            for (let i = lo; i <= hi; i++) {
              const m = Board.getCell(board, r, i);
              if (m && m.tile) { allEmpty = false; break; }
            }
            if (allEmpty) {
              threats.push({ row: tr, col: tc, hookRow: r, hookCol: c, gap: dc, direction: 'row' });
            }
          }
        }
      }

      // Check along the column: any tile within maxGap cells up or down?
      for (let dr = 1; dr <= maxGap; dr++) {
        for (const sign of [-1, 1]) {
          const r = tr + sign * dr;
          const c = tc;
          if (r < 0 || r >= C.BOARD_SIZE) continue;
          const adj = Board.getCell(board, r, c);
          if (adj && adj.tile) {
            let allEmpty = true;
            const lo = Math.min(tr, r) + 1;
            const hi = Math.max(tr, r) - 1;
            for (let i = lo; i <= hi; i++) {
              const m = Board.getCell(board, i, c);
              if (m && m.tile) { allEmpty = false; break; }
            }
            if (allEmpty) {
              threats.push({ row: tr, col: tc, hookRow: r, hookCol: c, gap: dr, direction: 'col' });
            }
          }
        }
      }
    }

    return threats;
  }

  window.AMath = window.AMath || {};
  window.AMath.aiX9 = {
    detectAllThreats: detectAllThreats,
    pickWorstThreat: pickWorstThreat,
    playBlocksThreat: playBlocksThreat,
    findOffensiveX9: findOffensiveX9,
    findDefensivePlay: findDefensivePlay,
    detectEasy3EHookThreats: detectEasy3EHookThreats,
  };
})();
