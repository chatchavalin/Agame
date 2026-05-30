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
  // Mirrors the evaluator's A-Math rules so we never skip a legal equation:
  //  - a segment (equation start, or right after '=') may begin with a number
  //    or a unary '-'; never with '+', '×', '÷', or '='.
  //  - two operators may never be adjacent (so a unary '-' must be followed by
  //    a number, and 'op =' / '= =' are invalid).
  function partialOk(seq) {
    var L = seq.length;
    if (L === 0) return true;
    var last = seq[L - 1], prev = L >= 2 ? seq[L - 2] : null;
    if (L === 1) {
      return !(last === '=' || last === '+' || last === '×' || last === '÷'); // '-' (unary) and numbers ok
    }
    if (isBinOp(last) && isBinOp(prev)) return false;          // no two adjacent operators
    if (prev === '=') {                                        // start of a new segment
      return !(last === '+' || last === '×' || last === '÷' || last === '='); // '-' (unary) ok
    }
    if (last === '=' && isBinOp(prev)) return false;           // a segment can't end with an operator
    // A valid A-Math equation has EXACTLY ONE '='. As soon as a partial places a
    // second '=', the whole branch is dead — prune it. This is the single biggest
    // win for heavy-BLANK racks, where blanks would otherwise explore '=' in many
    // doomed positions (a blank can become '='). Only check when last is '=' so
    // the scan cost is paid rarely.
    if (last === '=') {
      var eq = 0;
      for (var k = 0; k < L; k++) { if (seq[k] === '=') { eq++; if (eq > 1) return false; } }
    }
    return true;
  }

  /**
   * Find equations that use ALL of `tiles` (array of face strings).
   * @param {string[]} tiles
   * @param {(faces:string[])=>boolean} validate
   * @param {{maxSolutions?:number, nodeCap?:number}} [opts]
   * @returns {string[][]} list of solution face-arrays (deduped)
   */
  // Evaluate a completed segment's faces to an exact fraction, or null if it
  // isn't a well-formed expression. Wraps the real evaluator so the math matches
  // exactly (concatenation, unary minus, ×÷ precedence, fractions).
  function segmentValue(faces) {
    var ev = (typeof window !== 'undefined' && window.AMath && window.AMath.evaluator) || null;
    if (!ev) return null;
    var tr = ev.tokenize(faces);
    if (tr.error || !tr.tokens) return null;
    var r = ev.evaluateSegment(tr.tokens);
    return r.ok ? r.value : null;
  }
  function fracEq(a, b) { return a && b && a.num * b.den === b.num * a.den; }

  // The concrete roles a rack tile can fill. Returns a list of options, each
  // {kind, face}. kind ∈ 'digit' (single 0-9), 'fixed' (standalone 10-20),
  // 'op' (+ - × ÷), 'eq' (=). BLANK and the choice tiles expand to many options.
  function tileOptions(face) {
    if (face === '+/-' || face === '±') return [{ kind: 'op', face: '+' }, { kind: 'op', face: '-' }];
    if (face === '×/÷') return [{ kind: 'op', face: '×' }, { kind: 'op', face: '÷' }];
    if (face === '+' || face === '-' || face === '×' || face === '÷') return [{ kind: 'op', face: face }];
    if (face === '=') return [{ kind: 'eq' }];
    if (/^[0-9]$/.test(face)) return [{ kind: 'digit', face: face }];
    if (/^([1][0-9]|20)$/.test(face)) return [{ kind: 'fixed', face: face }];
    if (face === 'BLANK') {
      var o = [{ kind: 'op', face: '+' }, { kind: 'op', face: '-' },
               { kind: 'op', face: '×' }, { kind: 'op', face: '÷' }, { kind: 'eq' }];
      for (var d = 0; d <= 9; d++) o.push({ kind: 'digit', face: String(d) });
      return o;
    }
    return [{ kind: 'fixed', face: face }];
  }

  // Grammar-guided search. Instead of permuting all tile POSITIONS and only
  // checking validity at the leaf (which made heavy-BLANK racks explode), we
  // build the face sequence under the A-Math grammar and REJECT a tile/role
  // before recursing if it can't legally appear next. This prunes the malformed
  // branches up front and lets even 2- and 3-BLANK racks finish (the old
  // permutation search could not). Output format (faces/blankVals/blankIdx) and
  // the deduped solution set are identical to before.
  function solve(tiles, validate, opts) {
    opts = opts || {};
    var maxSol = opts.maxSolutions || 1;
    var nodeCap = opts.nodeCap || 1500000;
    // Sort so identical tiles are adjacent (enables the dup-skip below).
    var descs = tiles.slice().sort();
    var n = descs.length;
    var options = descs.map(tileOptions);
    var used = new Array(n).fill(false);
    var seq = [];   // resolved faces
    var blk = [];   // parallel: was this position a BLANK tile?
    var out = [];
    var seen = {};
    var nodes = 0;
    var capped = false;
    var lhsVal = null;   // value of the left side once '=' is placed
    var eqAt = -1;       // sequence index of the '='

    // Grammar state carried down the recursion:
    //   runLen  — length of the current trailing single-digit run (for 3-digit
    //             cap + leading-zero checks)
    //   segStart— are we at the start of a segment (equation start or just after '=')
    //   hasNum  — has the current segment got a complete number since its start /
    //             last operator? (an operator/'=' may only follow a number)
    //   lastOp  — was the previous token a binary operator? (no two adjacent ops)
    function dfs(runLen, segStart, hasNum, lastOp) {
      if (out.length >= maxSol || capped) return;
      if (++nodes > nodeCap) { capped = true; return; }
      if (seq.length === n) {
        if (eqAt < 0) return;
        var rhs = segmentValue(seq.slice(eqAt + 1));
        if (rhs === null || !fracEq(rhs, lhsVal)) return;
        var key = seq.join(' ');
        if (seen[key]) return;
        if (validate(seq)) {
          seen[key] = true;
          var blankVals = [], blankIdx = [];
          for (var k = 0; k < n; k++) if (blk[k]) { blankVals.push(seq[k]); blankIdx.push(k); }
          out.push({ faces: seq.slice(), blankVals: blankVals, blankIdx: blankIdx });
        }
        return;
      }
      for (var i = 0; i < n; i++) {
        if (used[i]) continue;
        if (i > 0 && descs[i] === descs[i - 1] && !used[i - 1]) continue; // skip duplicate tiles
        var isBlank = descs[i] === 'BLANK';
        var opts2 = options[i];
        for (var oi = 0; oi < opts2.length; oi++) {
          var o = opts2[oi];
          var f, nRun = runLen, nSeg = false, nHas = hasNum, nLast = false, ok = true;

          if (o.kind === 'digit') {
            if (runLen >= 3) continue;                        // max 3-digit numbers
            if (runLen >= 1) {                                // continuing a number
              if (seq[seq.length - runLen] === '0') continue; // would be a leading zero
            }
            f = o.face; nRun = runLen + 1; nHas = true; nLast = false; nSeg = false;
          } else if (o.kind === 'fixed') {
            if (runLen >= 1) continue;                        // 10-20 can't attach to a digit run
            f = o.face; nRun = 0; nHas = true; nLast = false; nSeg = false;
          } else if (o.kind === 'op') {
            // A binary op needs a preceding number; a unary '-' may start a segment.
            if (!hasNum && !(o.face === '-' && segStart)) continue;
            if (lastOp) continue;                             // no two adjacent operators
            f = o.face; nRun = 0; nHas = false; nLast = true; nSeg = false;
          } else { // eq
            if (eqAt >= 0) continue;                          // exactly one '='
            if (!hasNum || lastOp) continue;                  // a segment must end on a number
            f = '='; nRun = 0; nSeg = true; nHas = false; nLast = false;
          }

          seq.push(f); blk.push(isBlank);
          var savedEqAt = eqAt, savedLhs = lhsVal;
          if (o.kind === 'eq') {
            lhsVal = segmentValue(seq.slice(0, seq.length - 1));
            eqAt = seq.length - 1;
            if (lhsVal === null) ok = false;
          }
          if (ok) { used[i] = true; dfs(nRun, nSeg, nHas, nLast); used[i] = false; }
          eqAt = savedEqAt; lhsVal = savedLhs;
          seq.pop(); blk.pop();
          if (out.length >= maxSol || capped) return;
        }
      }
    }
    dfs(0, true, false, false);
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
    // Per-solve node cap. The DFS now prunes hard with incremental segment-value
    // checks (left side computed once at '=', right side must match before the
    // full validate), which roughly doubles efficiency and lets it find many
    // bingos the old 1.5M search missed. Even so, the worst case — TWO blanks
    // searched across all ~24 candidate hooks — cannot be fully exhausted in
    // interactive time by this permutation search (it would need a number-
    // partition rewrite). We keep the cap modest so normal/one-blank racks stay
    // instant; when a two-blank search hits the cap we report "couldn't finish"
    // honestly (calculator.js) rather than a false "no bingo". No time cap.
    var nodeCap = opts.nodeCap || 2500000;
    var capped = false;

    var eight = solve(rack, validate, { maxSolutions: ex, nodeCap: nodeCap });
    if (eight.capped) capped = true;

    var nine = [];
    candidateHooks(inventory).forEach(function (hook) {
      var sols = solve(rack.concat([hook]), validate, { maxSolutions: ex, nodeCap: nodeCap });
      if (sols.capped) capped = true;
      if (sols.length) nine.push({ hook: hook, examples: sols });
    });

    return { eight: eight, nine: nine, capped: capped };
  }

  var api = { solve: solve, bingos: bingos, candidateHooks: candidateHooks, choicesFor: choicesFor };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.AMath = window.AMath || {};
    window.AMath.bingoSolver = api;
  }
})();
