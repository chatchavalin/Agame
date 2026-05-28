/**
 * bingo-solver.js — find A-Math "bingo" plays from a rack.
 *
 * A bingo uses every tile on the rack in one straight equation line.
 *   - 8-tile bingo: the 8 rack tiles alone form a valid equation.
 *   - 9-tile bingo: the 8 rack tiles + 1 existing board tile (the "hook")
 *     form a valid 9-token equation. We report every hook face that works.
 *
 * The solver permutes the tiles (de-duping identical tiles), resolves choice
 * tiles (±, ×/÷) and BLANK to concrete faces, prunes structurally, and checks
 * each full sequence with the game's real equation validator (injected).
 *
 * Pure logic — no DOM. validate(facesArray) -> bool is supplied by the caller
 * (wraps window.AMath.evaluator.validateEquation).
 *
 * Exposes window.AMath.bingoSolver = { solve, bingos, candidateHooks }.
 */
(function () {
  'use strict';

  var BIN_OPS = { '+': 1, '-': 1, '×': 1, '÷': 1 };
  function isBinOp(f) { return BIN_OPS[f] === 1; }

  // Concrete faces a rack tile can become.
  function choicesFor(face) {
    if (face === '+/-' || face === '±') return ['+', '-'];
    if (face === '×/÷') return ['×', '÷'];
    if (face === 'BLANK') return ['0','1','2','3','4','5','6','7','8','9','+','-','×','÷','='];
    return [face];
  }

  // Structural prune on the partial face sequence (more tiles may follow).
  function partialOk(seq) {
    var L = seq.length;
    if (L === 0) return true;
    var last = seq[L - 1], prev = L >= 2 ? seq[L - 2] : null;
    if (L === 1 && (isBinOp(last) || last === '=')) return false;     // can't start with op or '='
    if (last === '=' && (prev === '=' || isBinOp(prev))) return false; // '= =' or 'op ='
    if (isBinOp(last) && (prev === '=' || isBinOp(prev))) return false; // '= op' or 'op op'
    return true;
  }

  /**
   * Find equations that use ALL of `tiles` (array of face strings).
   * @param {string[]} tiles
   * @param {(faces:string[])=>boolean} validate
   * @param {{maxSolutions?:number, nodeCap?:number}} [opts]
   * @returns {string[][]} list of solution face-arrays (deduped)
   */
  function solve(tiles, validate, opts) {
    opts = opts || {};
    var maxSol = opts.maxSolutions || 1;
    var nodeCap = opts.nodeCap || 1500000;
    var descs = tiles.slice().sort();          // sort so identical tiles are adjacent (dup-skip)
    var n = descs.length;
    var choices = descs.map(choicesFor);
    var used = new Array(n).fill(false);
    var seq = [];
    var out = [];
    var seen = {};
    var nodes = 0;
    var capped = false;

    function dfs() {
      if (out.length >= maxSol || capped) return;
      if (++nodes > nodeCap) { capped = true; return; }
      if (seq.length === n) {
        if (seq.indexOf('=') < 0) return;        // must be an equation
        var key = seq.join(' ');
        if (seen[key]) return;
        if (validate(seq)) { seen[key] = true; out.push(seq.slice()); }
        return;
      }
      for (var i = 0; i < n; i++) {
        if (used[i]) continue;
        if (i > 0 && descs[i] === descs[i - 1] && !used[i - 1]) continue; // skip duplicate tiles
        var cs = choices[i];
        for (var ci = 0; ci < cs.length; ci++) {
          seq.push(cs[ci]);
          if (partialOk(seq)) { used[i] = true; dfs(); used[i] = false; }
          seq.pop();
          if (out.length >= maxSol || capped) return;
        }
      }
    }
    dfs();
    out.capped = capped;
    return out;
  }

  // Faces that could be an existing board tile to hook onto: numbers + the four
  // operators + '='. (A board choice/blank tile shows a resolved value.)
  function candidateHooks(inventory) {
    var faces = [];
    (inventory || []).forEach(function (d) {
      if (d.type === 'digit' || d.type === 'twodigit') faces.push(d.face);
    });
    faces = faces.concat(['+', '-', '×', '÷', '=']);
    // de-dupe, keep numbers-then-operators order
    var seen = {}, out = [];
    faces.forEach(function (f) { if (!seen[f]) { seen[f] = 1; out.push(f); } });
    return out;
  }

  /**
   * Full bingo report for a rack.
   * @param {string[]} rack  up to 8 face strings (±, ×/÷, BLANK allowed)
   * @param {(faces:string[])=>boolean} validate
   * @param {object[]} inventory  active tile inventory (for hook candidates)
   * @param {{examples?:number}} [opts]
   * @returns {{eight:string[][], nine:{hook:string, examples:string[][]}[], capped:boolean}}
   */
  function bingos(rack, validate, inventory, opts) {
    opts = opts || {};
    var ex = opts.examples || 3;
    var capped = false;

    var eight = solve(rack, validate, { maxSolutions: ex });
    if (eight.capped) capped = true;

    var nine = [];
    candidateHooks(inventory).forEach(function (hook) {
      var sols = solve(rack.concat([hook]), validate, { maxSolutions: ex });
      if (sols.capped) capped = true;
      if (sols.length) nine.push({ hook: hook, examples: sols });
    });

    return { eight: eight, nine: nine, capped: capped };
  }

  var api = { solve: solve, bingos: bingos, candidateHooks: candidateHooks };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.AMath = window.AMath || {};
    window.AMath.bingoSolver = api;
  }
})();
