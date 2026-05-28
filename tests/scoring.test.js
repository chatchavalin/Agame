/**
 * tests/scoring.test.js — A-Math scoring rules.
 * Uses the real window.AMath.scoring with a minimal board stub matching the
 * board.cells[row][col] = { premium, premiumUsed } shape.
 */
'use strict';
const { load, T, summary } = require('./harness');
const AMath = load();
const C = AMath.constants;
const S = AMath.scoring;

console.log('scoring.test.js');

// Build a fake 15x15 board with optional premiums at given coords.
function makeBoard(premiums) {
  const cells = [];
  for (let r = 0; r < 15; r++) {
    cells[r] = [];
    for (let c = 0; c < 15; c++) cells[r][c] = { premium: '', premiumUsed: false };
  }
  (premiums || []).forEach(p => { cells[p.row][p.col] = { premium: p.premium, premiumUsed: !!p.used }; });
  return { cells };
}
// Build an equation-cell array on row 0 from faces+points, all new unless fixedCols says otherwise.
function eqCells(faces, points, opts) {
  opts = opts || {};
  const startCol = opts.startCol || 0;
  const fixed = opts.fixedCols || [];
  return faces.map((f, i) => ({
    row: 0, col: startCol + i,
    tile: { face: f, points: points[i] },
    isNew: fixed.indexOf(startCol + i) < 0,
  }));
}

// --- scoreEquation: plain line, no premiums ---
(() => {
  const board = makeBoard();
  const cells = eqCells(['2', '+', '3', '=', '5'], [1, 2, 1, 1, 2]);
  const sc = S.scoreEquation(cells, board);
  T('plain equation sums tile points (1+2+1+1+2=7)', sc === 7);
})();

// --- 2T tile multiplier on a NEW tile ---
(() => {
  const board = makeBoard([{ row: 0, col: 0, premium: '2T' }]);
  const cells = eqCells(['2', '+', '3', '=', '5'], [1, 2, 1, 1, 2]);
  // col0 '2'(1pt) doubled -> 2; rest 2+1+1+2=6; total 8
  T('2T doubles the new tile on it (=8)', S.scoreEquation(cells, board) === 8);
})();

// --- 3E equation multiplier ---
(() => {
  const board = makeBoard([{ row: 0, col: 0, premium: '3E' }]);
  const cells = eqCells(['2', '+', '3', '=', '5'], [1, 2, 1, 1, 2]);
  T('3E triples the whole equation (7*3=21)', S.scoreEquation(cells, board) === 21);
})();

// --- premium does NOT apply to an existing (not new) tile ---
(() => {
  const board = makeBoard([{ row: 0, col: 0, premium: '3T' }]);
  const cells = eqCells(['2', '+', '3', '=', '5'], [1, 2, 1, 1, 2], { fixedCols: [0] });
  T('premium ignored on existing tile (=7)', S.scoreEquation(cells, board) === 7);
})();

// --- premiumUsed does not re-trigger ---
(() => {
  const board = makeBoard([{ row: 0, col: 0, premium: '3T', used: true }]);
  const cells = eqCells(['2', '+', '3', '=', '5'], [1, 2, 1, 1, 2]);
  T('used premium does not re-trigger (=7)', S.scoreEquation(cells, board) === 7);
})();

// --- scorePlay: bingo bonus only when RACK_SIZE tiles placed ---
(() => {
  const board = makeBoard();
  const eq = eqCells(['2', '+', '3', '=', '5'], [1, 2, 1, 1, 2]);
  const noBonus = S.scorePlay([eq], board, 5);            // 5 new tiles, no bonus
  const withBonus = S.scorePlay([eq], board, C.RACK_SIZE); // 8 new tiles, bonus
  T('no bingo bonus below RACK_SIZE', noBonus.bingoBonus === 0 && noBonus.total === 7);
  T('bingo bonus at RACK_SIZE', withBonus.bingoBonus === C.BINGO_BONUS && withBonus.total === 7 + C.BINGO_BONUS);
})();

// --- constants sanity ---
T('BINGO_BONUS is 40', C.BINGO_BONUS === 40);
T('RACK_SIZE is 8', C.RACK_SIZE === 8);

process.exit(summary());
