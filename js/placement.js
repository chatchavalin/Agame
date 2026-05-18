/**
 * A-Math Game — Placement Validation
 *
 * Given a set of placements (new tiles being placed this turn), this module:
 *   1. Checks structural validity (in a line, no gaps, connected, etc.)
 *   2. Finds all equations formed (primary + cross-equations) per Master Spec §1.5b
 *   3. Validates each equation via the evaluator
 *
 * Returns one of:
 *   { ok: true, equations: [...], direction: 'horizontal'|'vertical' }
 *   { ok: false, reason: 'human-readable error' }
 *
 * Each equation = array of { row, col, tile, isNew } cells in left-to-right or top-to-bottom order.
 */

(function () {
  const C = window.AMath.constants;
  const Board = window.AMath.board;
  const Evaluator = window.AMath.evaluator;

  /**
   * Validates a set of new placements and returns the equations formed.
   *
   * @param board: Board with the new placements ALREADY placed
   * @param newPlacements: array of {row, col, tile} — the tiles placed THIS turn
   * @param isFirstMove: true if this is the very first move of the game
   * @returns { ok: true, equations, direction, newTilesCount } | { ok: false, reason }
   */
  function validatePlay(board, newPlacements, isFirstMove) {
    if (newPlacements.length === 0) {
      return { ok: false, reason: 'No tiles placed' };
    }

    // === Step 1: All new tiles must be in a single line (all same row OR all same column) ===
    const rows = new Set(newPlacements.map((p) => p.row));
    const cols = new Set(newPlacements.map((p) => p.col));

    let direction;
    if (rows.size === 1) {
      direction = 'horizontal';
    } else if (cols.size === 1) {
      direction = 'vertical';
    } else {
      return { ok: false, reason: 'Tiles must be in a single row or column' };
    }

    // === Step 2: Sort placements in order along the direction ===
    const sorted = [...newPlacements].sort((a, b) =>
      direction === 'horizontal' ? a.col - b.col : a.row - b.row
    );

    // === Step 3: First move must include center (7,7) ===
    if (isFirstMove) {
      const includesCenter = sorted.some(
        (p) => p.row === C.CENTER_CELL.row && p.col === C.CENTER_CELL.col
      );
      if (!includesCenter) {
        return { ok: false, reason: 'First move must pass through the center (★)' };
      }
    }

    // === Step 4: Find the primary equation (full line including any existing tiles) ===
    const primaryEq = extendLineFully(board, sorted, direction);

    // Sanity: primary must have at least 1 tile (always true since we just placed some)
    if (primaryEq.length < 1) {
      return { ok: false, reason: 'Internal error: primary equation empty' };
    }

    // === Step 5: After the first move, must connect to at least one existing tile ===
    if (!isFirstMove) {
      // Either the primary equation contains an existing tile,
      // OR a cross-equation does. We'll check both.
      let connected = primaryEq.some((c) => !c.isNew);
      if (!connected) {
        // Check cross-direction for any new tile
        for (const p of sorted) {
          const cross = extendLineFully(board, [p], direction === 'horizontal' ? 'vertical' : 'horizontal');
          if (cross.some((c) => !c.isNew)) {
            connected = true;
            break;
          }
        }
        if (!connected) {
          return { ok: false, reason: 'Tiles must connect to existing tiles on the board' };
        }
      }
    }

    // === Step 6: Primary equation must form a complete equation (contain at least one =) ===
    // (per Master Spec §1.5c: cross-sequences of 2+ tiles must be complete equations)
    // For the primary, same rule applies.
    const primaryFaces = primaryEq.map((c) => effectiveFace(c.tile));
    const primaryHasEquals = primaryFaces.some((f) => f === '=');

    const equations = [];

    if (primaryEq.length >= 2) {
      if (!primaryHasEquals) {
        return {
          ok: false,
          reason: 'Primary line "' + primaryFaces.join(' ') + '" is not a complete equation (missing =)',
        };
      }
      // Validate via evaluator
      const valRes = Evaluator.validateEquation(primaryFaces);
      if (!valRes.valid) {
        return {
          ok: false,
          reason: 'Primary equation invalid: ' + valRes.reason,
        };
      }
      equations.push(primaryEq);
    } else {
      // primaryEq has only 1 tile = the single new tile. It must form a cross-equation instead.
      // We require that AT LEAST ONE equation is formed in total.
    }

    // === Step 7: Find cross-equations for each new placement ===
    const crossDir = direction === 'horizontal' ? 'vertical' : 'horizontal';
    for (const p of sorted) {
      const crossLine = extendLineFully(board, [p], crossDir);
      if (crossLine.length >= 2) {
        // This is a cross-sequence; per §1.5c it must be a complete valid equation
        const crossFaces = crossLine.map((c) => effectiveFace(c.tile));
        const hasEq = crossFaces.some((f) => f === '=');
        if (!hasEq) {
          return {
            ok: false,
            reason:
              'Cross-sequence "' + crossFaces.join(' ') + '" must be a complete equation (missing =)',
          };
        }
        const crossVal = Evaluator.validateEquation(crossFaces);
        if (!crossVal.valid) {
          return {
            ok: false,
            reason: 'Cross-equation "' + crossFaces.join(' ') + '" invalid: ' + crossVal.reason,
          };
        }
        equations.push(crossLine);
      }
      // length 1 cross = just a single tile in cross-direction, that's fine (no cross-equation formed)
    }

    // === Step 8: At least one equation must have been formed ===
    if (equations.length === 0) {
      return {
        ok: false,
        reason: 'Play must form at least one equation',
      };
    }

    return {
      ok: true,
      equations: equations,
      direction: direction,
      newTilesCount: newPlacements.length,
    };
  }

  /**
   * Given a starting set of cells (in order) along a direction,
   * extends both ends to include all contiguous tiles on the board.
   * Returns the full line as array of {row, col, tile, isNew}.
   * "isNew" flag is true if the tile was just placed this turn (i.e., it's in the input).
   */
  function extendLineFully(board, startCells, direction) {
    const newSet = new Set(startCells.map((c) => c.row + ',' + c.col));

    // Pick any starting cell to anchor
    const anchor = startCells[0];
    const r0 = anchor.row;
    const c0 = anchor.col;

    let minRow = r0,
      maxRow = r0,
      minCol = c0,
      maxCol = c0;
    for (const c of startCells) {
      if (c.row < minRow) minRow = c.row;
      if (c.row > maxRow) maxRow = c.row;
      if (c.col < minCol) minCol = c.col;
      if (c.col > maxCol) maxCol = c.col;
    }

    if (direction === 'horizontal') {
      // Extend left
      while (Board.inBounds(r0, minCol - 1) && !Board.isCellEmpty(board, r0, minCol - 1)) {
        minCol--;
      }
      // Extend right
      while (Board.inBounds(r0, maxCol + 1) && !Board.isCellEmpty(board, r0, maxCol + 1)) {
        maxCol++;
      }

      // Check no gaps between minCol..maxCol — every cell must be occupied
      const result = [];
      for (let col = minCol; col <= maxCol; col++) {
        const cell = board.cells[r0][col];
        if (cell.tile === null) {
          // Gap detected. Return only contiguous from the anchor.
          // For our caller this means the placements have gaps — we'll return partial line.
          // We rebuild: find contiguous range around r0,c0
          return rebuildContiguous(board, r0, c0, direction, newSet);
        }
        result.push({
          row: r0,
          col: col,
          tile: cell.tile,
          isNew: newSet.has(r0 + ',' + col),
        });
      }
      return result;
    } else {
      // vertical
      while (Board.inBounds(minRow - 1, c0) && !Board.isCellEmpty(board, minRow - 1, c0)) {
        minRow--;
      }
      while (Board.inBounds(maxRow + 1, c0) && !Board.isCellEmpty(board, maxRow + 1, c0)) {
        maxRow++;
      }

      const result = [];
      for (let row = minRow; row <= maxRow; row++) {
        const cell = board.cells[row][c0];
        if (cell.tile === null) {
          return rebuildContiguous(board, r0, c0, direction, newSet);
        }
        result.push({
          row: row,
          col: c0,
          tile: cell.tile,
          isNew: newSet.has(row + ',' + c0),
        });
      }
      return result;
    }
  }

  /**
   * When a gap is detected, return just the contiguous run including the anchor.
   * (This happens for cross-direction extension where there's no full line.)
   */
  function rebuildContiguous(board, r0, c0, direction, newSet) {
    const result = [];
    if (direction === 'horizontal') {
      let minCol = c0,
        maxCol = c0;
      while (Board.inBounds(r0, minCol - 1) && !Board.isCellEmpty(board, r0, minCol - 1)) {
        minCol--;
      }
      while (Board.inBounds(r0, maxCol + 1) && !Board.isCellEmpty(board, r0, maxCol + 1)) {
        maxCol++;
      }
      for (let col = minCol; col <= maxCol; col++) {
        const cell = board.cells[r0][col];
        result.push({
          row: r0,
          col: col,
          tile: cell.tile,
          isNew: newSet.has(r0 + ',' + col),
        });
      }
    } else {
      let minRow = r0,
        maxRow = r0;
      while (Board.inBounds(minRow - 1, c0) && !Board.isCellEmpty(board, minRow - 1, c0)) {
        minRow--;
      }
      while (Board.inBounds(maxRow + 1, c0) && !Board.isCellEmpty(board, maxRow + 1, c0)) {
        maxRow++;
      }
      for (let row = minRow; row <= maxRow; row++) {
        const cell = board.cells[row][c0];
        result.push({
          row: row,
          col: c0,
          tile: cell.tile,
          isNew: newSet.has(row + ',' + c0),
        });
      }
    }
    return result;
  }

  /**
   * Returns the effective face of a tile — uses 'assigned' value if present (BLANK / +/- / ×/÷).
   */
  function effectiveFace(tile) {
    return tile.assigned || tile.face;
  }

  window.AMath = window.AMath || {};
  window.AMath.placement = {
    validatePlay: validatePlay,
    effectiveFace: effectiveFace,
  };
})();
