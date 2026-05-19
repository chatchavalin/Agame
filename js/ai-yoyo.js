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
    const TIME_BUDGET_MS = 25000; // 25 sec budget for YoYo search

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
   * Try all permutations of rack tiles on the given positions.
   * For each, validate the play as a normal play, score it, and record valid ones.
   */
  function searchTileAssignments(state, line, existing, positions, startTime, timeBudget) {
    const results = [];
    const rackTiles = state.aiRack.tiles.slice();

    // Pick permutations of rack tiles of size = positions.length
    // To limit search, generate up to N permutations
    const MAX_PERMUTATIONS = 5000;
    const numPositions = positions.length;
    let permCount = 0;

    function tryPermutation(remaining, chosen) {
      if (Date.now() - startTime > timeBudget) return;
      if (permCount >= MAX_PERMUTATIONS) return;

      if (chosen.length === numPositions) {
        permCount++;
        // Construct the placements
        const placements = chosen.map((tile, i) => ({
          row: positions[i].row,
          col: positions[i].col,
          tile: tile,
        }));

        // For BLANK/choice tiles, try common assignments
        const tryAssignments = (idx) => {
          if (Date.now() - startTime > timeBudget) return;
          if (idx === placements.length) {
            validateAndScore(state, placements, results);
            return;
          }
          const p = placements[idx];
          if (p.tile.type === 'blank') {
            // Try all valid assignments for blank (respects active inventory)
            const choices = (C.getBlankChoices ? C.getBlankChoices() : C.BLANK_CHOICES);
            for (const ch of choices) {
              p.tile.assigned = ch;
              tryAssignments(idx + 1);
            }
            p.tile.assigned = null;
          } else if (p.tile.type === 'choice') {
            const choices = p.tile.face === '+/-' ? ['+', '-'] : ['×', '÷'];
            for (const ch of choices) {
              p.tile.assigned = ch;
              tryAssignments(idx + 1);
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
        if (permCount >= MAX_PERMUTATIONS) return;
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
    let valid = validation.valid;

    if (valid) {
      try {
        const scoreResult = Scoring.computeScore(tempBoard, placements);
        score = scoreResult.total;
        equations = scoreResult.equations || [];
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
