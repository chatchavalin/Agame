/**
 * A-Math — ตอน 4 Target Equation Solver
 *
 * Given a rack of 8 tiles, find an equation that uses some subset of the
 * rack tiles and evaluates to a specific target value.
 *
 * Strategy: enumerate all equation structures (3-token, 5-token, 7-token),
 * for each one try all valid tile assignments, evaluate, and return matches.
 *
 * Targets can be:
 *   - A number 0..20 (the equation's evaluated result)
 *   - An operator '+', '-', '×', '÷', '=' (the rack must contain that operator;
 *     "answer" then = ANY equation that uses that tile)
 *
 * Note: '?' (BLANK) can stand for any digit 0-20 OR any operator. ×/÷ can be
 * either. +/- can be either.
 */
(function () {
  'use strict';

  // Validate equation using the SAME rules as Player-vs-AI mode.
  // Delegates to window.AMath.evaluator.validateEquation — which is the
  // canonical A-Math validator: rejects unary +, allows unary -, enforces
  // integer division, single =, no adjacent ops, both sides non-empty, etc.
  //
  // Returns the (integer) value of the equation if valid, otherwise NaN.
  function evaluate(tokens) {
    if (!tokens || tokens.length < 3) return NaN;
    var E = window.AMath && window.AMath.evaluator;
    if (!E || !E.validateEquation) {
      // Fallback: be conservative — fail rather than use stale rules.
      return NaN;
    }
    var r = E.validateEquation(tokens);
    if (!r.valid) return NaN;
    // r.value is a fraction {num, den}. Only integer results are valid in A-Math
    // (validateEquation already enforces this in the multi-side equality check,
    // but defend against future changes).
    if (r.value && r.value.den === 1) return r.value.num;
    if (typeof r.value === 'number') return r.value;
    return NaN;
  }


  // Parse a side: numbers may be multi-digit (adjacent digit tokens combine)
  // Tokens are: digits as strings ('0'..'20'), operators ('+','-','×','÷'), '='
  // Multi-digit forms when consecutive digit tokens — e.g. ['1','2'] → 12
  function parseSide(toks) {
    if (toks.length === 0) return null;
    var out = [];
    var curDigits = '';
    // FIX bug 2: allow a leading '-' or '+' as a unary sign on the first number.
    // (e.g. -28+50=22 has LHS starting with '-'.)
    var leadingSign = 0;  // 0 = none, +1 = '+', -1 = '-'
    var start = 0;
    if (toks.length >= 2 && (toks[0] === '+' || toks[0] === '-') && /^\d+$/.test(toks[1])) {
      leadingSign = (toks[0] === '-') ? -1 : 1;
      start = 1;
    }
    for (var i = start; i < toks.length; i++) {
      var t = toks[i];
      if (/^\d+$/.test(t)) {
        if (t.length === 1 && curDigits.length < 3) {
          curDigits += t;
        } else {
          if (curDigits.length) {
            out.push(parseInt(curDigits, 10));
            curDigits = '';
          }
          out.push(parseInt(t, 10));
        }
      } else {
        if (curDigits.length) {
          out.push(parseInt(curDigits, 10));
          curDigits = '';
        }
        out.push(t);
      }
    }
    if (curDigits.length) out.push(parseInt(curDigits, 10));
    if (out.length === 0) return null;
    if (typeof out[0] !== 'number') return null;
    if (typeof out[out.length - 1] !== 'number') return null;
    for (var k = 1; k < out.length; k++) {
      var expectNumber = (k % 2 === 0);
      if (expectNumber && typeof out[k] !== 'number') return null;
      if (!expectNumber && typeof out[k] === 'number') return null;
    }
    // Apply the leading sign to the first number
    if (leadingSign !== 0) out[0] = out[0] * leadingSign;
    return out;
  }

  // Tile "face options" — what concrete tokens a tile can become
  function tileOptions(face) {
    if (face === '+/-') return ['+', '-'];
    if (face === '×/÷') return ['×', '÷'];
    if (face === 'BLANK') {
      // FIX bug 3: BLANK as operator is very rare in target drills and explodes
      // cartesian product (26 options × multiple BLANKs ≫ search budget).
      // Restrict to digits 0-20 for ตอน-4 purposes. If the user actually needs
      // BLANK-as-operator, we can expand later.
      var opts = [];
      for (var i = 0; i <= 20; i++) opts.push(String(i));
      return opts;
    }
    return [face];
  }

  /**
   * Search for an equation from the rack that evaluates to `target`.
   * target is either a number-string '0'..'20' or operator '+' '-' '×' '÷' '='.
   *
   * Returns an array of up to `maxResults` matches:
   *   { tokens: [...], faceAssignment: { tileIndex: face }, length: N }
   *
   * Algorithm: try all subset sizes from 3 to 8, all orderings, all face-option
   * combinations for choice/blank tiles. Bail early once enough matches found.
   */
  function findEquations(rack, target, maxResults) {
    maxResults = maxResults || 3;
    var results = [];

    // If target is an operator, look for ANY valid equation that uses that operator
    // tile (via direct or choice/blank).
    var isOperatorTarget = (target === '+' || target === '-' || target === '×' || target === '÷' || target === '=');

    // Try subset sizes 3,5,7 first (most common), then 8 if needed
    var sizes = [3, 4, 5, 6, 7, 8];  // FIX: was [3,5,7] — missed all even-length equations (huge category)
    // Permutation budget — small enough to be fast
    var MAX_PERMS = 50000;

    for (var s = 0; s < sizes.length && results.length < maxResults; s++) {
      var size = sizes[s];
      if (size > rack.length) continue;

      var perms = 0;
      var indices = rack.map(function(_, i) { return i; });
      // Generate all subsets of `size` from `indices`
      var combos = subsets(indices, size);
      for (var c = 0; c < combos.length && results.length < maxResults && perms < MAX_PERMS; c++) {
        var combo = combos[c];
        // For each permutation of the chosen subset
        var permutations = permute(combo);
        for (var p = 0; p < permutations.length && results.length < maxResults && perms < MAX_PERMS; p++) {
          perms++;
          var perm = permutations[p];
          // For each face-option combination of the perm tiles
          var optionsList = perm.map(function(idx) { return tileOptions(rack[idx]); });
          // Skip if optionsList has empty option somewhere
          if (optionsList.some(function(o){ return o.length === 0; })) continue;
          // Cartesian product
          var found = cartesianSearch(optionsList, function(combo) {
            var tokens = combo;
            // Must contain '='
            if (tokens.indexOf('=') === -1) return false;
            var result = evaluate(tokens);
            if (isNaN(result)) return false;
            // Check target match
            if (isOperatorTarget) {
              // Target is operator: just check the tokens INCLUDE that operator
              return tokens.indexOf(target) !== -1;
            } else {
              return result === parseInt(target, 10);
            }
          }, 30000);  // bumped from 5000 to handle BLANK + multi-choice racks
          if (found) {
            results.push({
              tokens: found,
              tilesUsed: perm,
              size: size,
            });
            break;  // one match per permutation is enough
          }
        }
      }
    }
    return results;
  }

  function subsets(arr, k) {
    var out = [];
    function helper(start, current) {
      if (current.length === k) {
        out.push(current.slice());
        return;
      }
      for (var i = start; i < arr.length; i++) {
        current.push(arr[i]);
        helper(i + 1, current);
        current.pop();
      }
    }
    helper(0, []);
    return out;
  }

  function permute(arr) {
    if (arr.length <= 1) return [arr.slice()];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var rest = arr.slice(0, i).concat(arr.slice(i + 1));
      var perms = permute(rest);
      for (var p = 0; p < perms.length; p++) {
        out.push([arr[i]].concat(perms[p]));
      }
    }
    return out;
  }

  // Iterate cartesian product, call check on each; return first match.
  function cartesianSearch(optionsList, check, maxIter) {
    maxIter = maxIter || 10000;
    var counters = optionsList.map(function() { return 0; });
    var iter = 0;
    while (iter < maxIter) {
      iter++;
      var combo = counters.map(function(c, i) { return optionsList[i][c]; });
      if (check(combo)) return combo;
      // Increment counters
      var done = true;
      for (var i = optionsList.length - 1; i >= 0; i--) {
        if (counters[i] < optionsList[i].length - 1) {
          counters[i]++;
          for (var j = i + 1; j < optionsList.length; j++) counters[j] = 0;
          done = false;
          break;
        }
      }
      if (done) break;
    }
    return null;
  }

  /**
   * Find a valid equation using ALL 8 rack tiles + 1 target tile = 9 tokens.
   * The target is treated as an extra digit/operator tile added to the rack.
   *
   * Returns array of up to maxResults matches, each:
   *   { tokens: [...], size: 9 }
   */
  // Thin wrapper — historically the only entry point. Now delegates to the
  // unified implementation that also handles the no-target case.
  function findFullEquation(rack, target, maxResults) {
    return findFullEquationFromRack(rack, target, maxResults);
  }

  /**
   * Solve all 26 targets for a given rack. Returns map: target → result or null.
   */
  async function solveAllTargets(rack, onProgress) {
    var targets = ["0","1","2","3","4","5","6","7","8","9","10",
                   "11","12","13","14","15","16","17","18","19","20",
                   "+","-","×","÷","="];
    var results = {};
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (onProgress) onProgress(i, targets.length, t);
      await new Promise(function(r){ setTimeout(r, 0); });
      // FULL EQUATION mode: use all 8 rack tiles + 1 target tile = 9 tokens.
      var matches = findFullEquation(rack, t, 1);
      results[t] = matches.length > 0 ? matches[0] : null;
    }
    if (onProgress) onProgress(targets.length, targets.length, null);
    return results;
  }

  window.AMath = window.AMath || {};
  /**
   * N-token equation finder. Given a list of tile faces, find an equation that
   * uses ALL of them. Same engine as findFullEquation but without a target tile.
   */
  function findEquationFromTokens(tokens, maxResults) {
    return findFullEquationFromRack(tokens, null, maxResults);
  }

  /**
   * Internal: unified solver. rack = list of N faces. target = optional 9th face
   * to append, or null if rack alone has all tokens.
   */
  function findFullEquationFromRack(rack, target, maxResults) {
    maxResults = maxResults || 1;
    var results = [];
    var fullRack = rack.slice();
    if (target !== null && target !== undefined) fullRack.push(String(target));

    var indices = fullRack.map(function (_, i) { return i; });
    var MAX_PERMS = 200000;
    var perms = 0;

    function tryPerm(perm) {
      if (perms >= MAX_PERMS) return false;
      if (results.length >= maxResults) return false;
      perms++;
      var optionsList = perm.map(function (idx) { return tileOptions(fullRack[idx]); });
      if (optionsList.some(function (o) { return o.length === 0; })) return false;
      var found = cartesianSearch(optionsList, function (tokens) {
        if (tokens.indexOf('=') === -1) return false;
        var result = evaluate(tokens);
        return !isNaN(result);
      }, 30000);
      if (found) {
        results.push({ tokens: found, size: fullRack.length });
        return true;
      }
      return false;
    }

    function heapPermute(k, arr) {
      if (perms >= MAX_PERMS || results.length >= maxResults) return;
      if (k === 1) { tryPerm(arr); return; }
      for (var i = 0; i < k; i++) {
        heapPermute(k - 1, arr);
        if (perms >= MAX_PERMS || results.length >= maxResults) return;
        var swapIdx = (k % 2 === 0) ? i : 0;
        var tmp = arr[swapIdx]; arr[swapIdx] = arr[k-1]; arr[k-1] = tmp;
      }
    }

    heapPermute(indices.length, indices.slice());
    return results;
  }

  window.AMath.ton4Solver = {
    findEquations: findEquations,
    findFullEquation: findFullEquation,
    findEquationFromTokens: findEquationFromTokens,
    solveAllTargets: solveAllTargets,
    evaluate: evaluate,
  };
})();
