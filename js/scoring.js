/**
 * A-Math Game — Scoring
 *
 * Computes the score for a play. Implements Master Spec §1.5b multi-equation scoring:
 *   - Each new equation scores independently
 *   - Tile multipliers (2T/3T) apply only to newly placed tiles
 *   - Equation multipliers (2E/3E) apply only when a new tile sits on the premium
 *   - Existing tiles contribute base point value only (no multipliers)
 *   - Used premium squares (premiumUsed=true) don't re-trigger
 *   - +40 Bingo bonus applies once if 8 tiles placed
 *
 * The input "placements" is an array of: { row, col, tile }
 * where tile.face represents the effective face (BLANK already assigned).
 */

(function () {
  /**
   * Calculate the score for a single equation.
   *
   * @param equationCells: array of {row, col, tile, isNew} - all cells in this equation in order
   * @param board: the Board object (to read premium info)
   * @returns total score for this equation
   */
  function scoreEquation(equationCells, board) {
    let baseSum = 0;
    let equationMultiplier = 1;

    for (const cell of equationCells) {
      let tilePoints = cell.tile.points;

      if (cell.isNew) {
        // Apply tile multiplier if applicable
        const boardCell = board.cells[cell.row][cell.col];
        if (boardCell.premium && !boardCell.premiumUsed) {
          if (boardCell.premium === '3T') {
            tilePoints *= 3;
          } else if (boardCell.premium === '2T') {
            tilePoints *= 2;
          } else if (boardCell.premium === '3E') {
            equationMultiplier *= 3;
          } else if (boardCell.premium === '2E') {
            equationMultiplier *= 2;
          }
        }
      }

      baseSum += tilePoints;
    }

    return baseSum * equationMultiplier;
  }

  /**
   * Calculate total score for a play.
   *
   * @param equations: array of equation cell-arrays (each one is array of {row,col,tile,isNew})
   * @param board: Board object
   * @param newTilesCount: number of newly placed tiles (for Bingo bonus check)
   * @returns { total, perEquation, bingoBonus }
   */
  function scorePlay(equations, board, newTilesCount) {
    let total = 0;
    const perEquation = [];

    for (const eq of equations) {
      const score = scoreEquation(eq, board);
      perEquation.push(score);
      total += score;
    }

    const C = window.AMath.constants;
    let bingoBonus = 0;
    if (newTilesCount === C.RACK_SIZE) {
      bingoBonus = C.BINGO_BONUS;
      total += bingoBonus;
    }

    return {
      total: total,
      perEquation: perEquation,
      bingoBonus: bingoBonus,
    };
  }

  window.AMath = window.AMath || {};
  window.AMath.scoring = {
    scoreEquation: scoreEquation,
    scorePlay: scorePlay,
  };
})();
