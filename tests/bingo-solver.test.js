/**
 * tests/bingo-solver.test.js — the Bingo Calculator solver.
 * Covers the v93 solution-object API (faces/blankVals/blankIdx), blank handling,
 * unary-minus bingos, choicesFor, and the 9-tile hook search.
 */
'use strict';
const { load, T, summary } = require('./harness');
const AMath = load();
const BS = AMath.bingoSolver;
const ok = (faces) => { const v = AMath.evaluator.validateEquation(faces); return !!(v && v.valid); };

console.log('bingo-solver.test.js');

// --- solve returns solution objects (not raw arrays) ---
(() => {
  const s = BS.solve(['1', '2', '+', '3', '4', '=', '4', '6'], ok, { maxSolutions: 2 });
  T('solve finds 12+34=46', s.length >= 1);
  T('solution has .faces array', !!(s[0] && Array.isArray(s[0].faces)));
  T('solution has .blankVals and .blankIdx', !!(s[0] && Array.isArray(s[0].blankVals) && Array.isArray(s[0].blankIdx)));
  T('no-blank solution has empty blankVals', s[0] && s[0].blankVals.length === 0);
})();

// --- blank tracking ---
(() => {
  const s = BS.solve(['2', '+', 'BLANK', '=', '5'], ok, { maxSolutions: 5 });
  T('solves equation using a blank', s.length >= 1);
  const three = s.find(x => x.faces.join('') === '2+3=5');
  T('blank reported as 3 in 2+3=5', !!three && three.blankVals.length === 1 && three.blankVals[0] === '3');
  T('blankIdx marks the blank position', !!three && three.blankIdx.length === 1 && three.faces[three.blankIdx[0]] === '3');
})();

// --- unary-minus bingos are found (not pruned away) ---
(() => {
  const s = BS.solve(['-', '3', '+', '5', '=', '2'], ok, { maxSolutions: 5 });
  T('finds a unary-minus equation', s.length >= 1);
})();

// --- choicesFor exposes choice/blank expansion ---
(() => {
  T('choicesFor exported', typeof BS.choicesFor === 'function');
  T('+/- expands to + and -', JSON.stringify(BS.choicesFor('+/-')) === JSON.stringify(['+', '-']));
  T('×/÷ expands to × and ÷', JSON.stringify(BS.choicesFor('×/÷')) === JSON.stringify(['×', '÷']));
  T('BLANK expands to 15 options', BS.choicesFor('BLANK').length === 15);
  T('plain face is itself', JSON.stringify(BS.choicesFor('7')) === JSON.stringify(['7']));
})();

// --- 9-tile hook search ---
(() => {
  const inv = AMath.constants.PRATHOM_INVENTORY;
  const report = BS.bingos(['1', '2', '+', '3', '4', '=', '6'], ok, inv, { examples: 1 });
  T('bingos() returns a nine array', !!(report && Array.isArray(report.nine)));
  T('at least one hook makes a bingo', report.nine.length >= 1);
  T('hook example has .faces', !!(report.nine[0] && report.nine[0].examples[0] && Array.isArray(report.nine[0].examples[0].faces)));
})();

// --- every returned solution is actually valid ---
(() => {
  const s = BS.solve(['1', '2', '+', '3', '4', '=', '4', '6'], ok, { maxSolutions: 6 });
  T('all returned solutions validate', s.every(x => ok(x.faces)));
})();

process.exit(summary());
