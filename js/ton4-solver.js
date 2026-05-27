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

  // Evaluate a list of tokens with A-Math operator precedence (×÷ before +−).
  // Returns NaN on syntax error or invalid eq (multi-=, division by zero, non-integer).
  function evaluate(tokens) {
    if (!tokens || tokens.length < 3) return NaN;
    // Must contain exactly one '='
    var eqIdx = -1;
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i] === '=') {
        if (eqIdx !== -1) return NaN;  // two '=' → fail
        eqIdx = i;
      }
    }
    if (eqIdx === -1 || eqIdx === 0 || eqIdx === tokens.length - 1) return NaN;

    function evalSide(side) {
      if (side.length === 0) return NaN;
      // Each side: numbers and operators only
      // Apply ×÷ first, left to right
      var arr = side.slice();
      for (var i = 1; i < arr.length - 1; i += 2) {
        var op = arr[i];
        if (op === '×' || op === '÷') {
          var a = arr[i-1], b = arr[i+1];
          if (typeof a !== 'number' || typeof b !== 'number') return NaN;
          var r;
          if (op === '×') r = a * b;
          else {
            if (b === 0) return NaN;
            r = a / b;
            if (r !== Math.floor(r)) return NaN;  // non-integer → invalid
          }
          arr.splice(i-1, 3, r);
          i -= 2;
        }
      }
      // Then +-
      var acc = arr[0];
      if (typeof acc !== 'number') return NaN;
      for (var j = 1; j < arr.length - 1; j += 2) {
        var oj = arr[j], v = arr[j+1];
        if (typeof v !== 'number') return NaN;
        if (oj === '+') acc += v;
        else if (oj === '-') acc -= v;
        else return NaN;
      }
      return acc;
    }

    var lhsTokens = parseSide(tokens.slice(0, eqIdx));
    var rhsTokens = parseSide(tokens.slice(eqIdx + 1));
    if (!lhsTokens || !rhsTokens) return NaN;
    var lhs = evalSide(lhsTokens);
    var rhs = evalSide(rhsTokens);
    if (isNaN(lhs) || isNaN(rhs)) return NaN;
    if (lhs !== rhs) return NaN;
    return lhs;
  }

  // Parse a side: numbers may be multi-digit (adjacent digit tokens combine)
  // Tokens are: digits as strings ('0'..'20'), operators ('+','-','×','÷'), '='
  // Multi-digit forms when consecutive digit tokens — e.g. ['1','2'] → 12
  function parseSide(toks) {
    if (toks.length === 0) return null;
    var out = [];
    var curDigits = '';
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (/^\d+$/.test(t)) {
        // Single-digit (0-9) can combine. Two-digit tiles (10-20) cannot combine.
        if (t.length === 1 && curDigits.length < 3) {  // cap multi-digit at 3 digits
          curDigits += t;
        } else {
          // Two-digit tile, or curDigits too long. Flush curDigits if any.
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
    // Validate alternation: must start and end with number, op between
    if (out.length === 0) return null;
    if (typeof out[0] !== 'number') return null;
    if (typeof out[out.length - 1] !== 'number') return null;
    for (var k = 1; k < out.length; k++) {
      var expectNumber = (k % 2 === 0);
      if (expectNumber && typeof out[k] !== 'number') return null;
      if (!expectNumber && typeof out[k] === 'number') return null;
    }
    return out;
  }

  // Tile "face options" — what concrete tokens a tile can become
  function tileOptions(face) {
    if (face === '+/-') return ['+', '-'];
    if (face === '×/÷') return ['×', '÷'];
    if (face === 'BLANK') {
      // BLANK can be any digit 0-9, two-digit 10-20, or any operator
      var opts = [];
      for (var i = 0; i <= 20; i++) opts.push(String(i));
      opts.push('+', '-', '×', '÷', '=');
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
    var sizes = [3, 5, 7];
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
          }, 5000);
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
      // Yield to UI
      await new Promise(function(r){ setTimeout(r, 0); });
      var matches = findEquations(rack, t, 1);
      results[t] = matches.length > 0 ? matches[0] : null;
    }
    if (onProgress) onProgress(targets.length, targets.length, null);
    return results;
  }

  window.AMath = window.AMath || {};
  window.AMath.ton4Solver = {
    findEquations: findEquations,
    solveAllTargets: solveAllTargets,
    evaluate: evaluate,
  };
})();
