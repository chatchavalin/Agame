/**
 * A-Math Game — Board
 *
 * The 15×15 grid that holds placed tiles. Per Master Spec §17.2-17.3:
 *   Cell: { row, col, tile, premium, premiumUsed }
 *   Board: { cells: [[Cell, ...], ...] }
 *
 * "Adjacent" means orthogonally adjacent (up/down/left/right) per Spec §5.1.
 * Diagonal cells are NOT adjacent.
 */

(function () {
  const C = window.AMath.constants;

  /**
   * Creates an empty 15×15 board with premium squares from the constants.
   */
  function createBoard() {
    const cells = [];
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      const row = [];
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const premiumValue = C.PREMIUM_SQUARES[r][c];
        row.push({
          row: r,
          col: c,
          tile: null,
          premium: premiumValue === '' ? null : premiumValue,
          premiumUsed: false,
        });
      }
      cells.push(row);
    }
    return { cells: cells };
  }

  /**
   * Returns the cell object at (row, col). Returns null if out of bounds.
   */
  function getCell(board, row, col) {
    if (row < 0 || row >= C.BOARD_SIZE) return null;
    if (col < 0 || col >= C.BOARD_SIZE) return null;
    return board.cells[row][col];
  }

  /**
   * True if the cell is empty (no tile placed).
   */
  function isCellEmpty(board, row, col) {
    const cell = getCell(board, row, col);
    if (cell === null) return false; // out of bounds = not empty
    return cell.tile === null;
  }

  /**
   * True if the cell is in bounds.
   */
  function inBounds(row, col) {
    return row >= 0 && row < C.BOARD_SIZE && col >= 0 && col < C.BOARD_SIZE;
  }

  /**
   * Places a tile on a cell. Does NOT validate; caller is responsible.
   */
  function placeTile(board, row, col, tile) {
    const cell = getCell(board, row, col);
    if (cell === null) {
      throw new Error('placeTile: out of bounds (' + row + ',' + col + ')');
    }
    if (cell.tile !== null) {
      throw new Error('placeTile: cell already has a tile at (' + row + ',' + col + ')');
    }
    cell.tile = tile;
  }

  /**
   * Removes the tile from a cell. Returns the removed tile or null.
   * (Used when reverting an unsubmitted move.)
   */
  function removeTile(board, row, col) {
    const cell = getCell(board, row, col);
    if (cell === null || cell.tile === null) return null;
    const t = cell.tile;
    cell.tile = null;
    return t;
  }

  /**
   * Marks a cell's premium as "used" (consumed by a prior play).
   * Per Master Spec §1.5b: "Premium squares from prior turns are already 'consumed'".
   */
  function markPremiumUsed(board, row, col) {
    const cell = getCell(board, row, col);
    if (cell) cell.premiumUsed = true;
  }

  /**
   * Returns an array of the 4 orthogonally adjacent tiles to (row, col).
   * Each entry: { row, col, tile, direction: 'N'|'S'|'E'|'W' }
   * Out-of-bounds and empty cells are skipped.
   */
  function getAdjacentTiles(board, row, col) {
    const deltas = [
      { dr: -1, dc: 0, dir: 'N' },
      { dr: 1, dc: 0, dir: 'S' },
      { dr: 0, dc: -1, dir: 'W' },
      { dr: 0, dc: 1, dir: 'E' },
    ];
    const result = [];
    for (const { dr, dc, dir } of deltas) {
      const nr = row + dr;
      const nc = col + dc;
      const cell = getCell(board, nr, nc);
      if (cell && cell.tile !== null) {
        result.push({ row: nr, col: nc, tile: cell.tile, direction: dir });
      }
    }
    return result;
  }

  /**
   * Returns true if the board is empty (no tiles placed anywhere).
   */
  function isBoardEmpty(board) {
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        if (board.cells[r][c].tile !== null) return false;
      }
    }
    return true;
  }

  /**
   * Counts how many tiles are currently placed on the board.
   */
  function tileCount(board) {
    let count = 0;
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        if (board.cells[r][c].tile !== null) count++;
      }
    }
    return count;
  }

  // Expose
  window.AMath = window.AMath || {};
  window.AMath.board = {
    createBoard: createBoard,
    getCell: getCell,
    isCellEmpty: isCellEmpty,
    inBounds: inBounds,
    placeTile: placeTile,
    removeTile: removeTile,
    markPremiumUsed: markPremiumUsed,
    getAdjacentTiles: getAdjacentTiles,
    isBoardEmpty: isBoardEmpty,
    tileCount: tileCount,
  };
})();
