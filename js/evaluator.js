/**
 * A-Math Game — Equation Evaluator
 *
 * The math judge. Takes a list of tile faces and decides:
 *   - Is this a valid equation per Master Spec §1.5 and §1.5d?
 *   - If yes, what's its exact value (as a fraction)?
 *
 * Uses exact fraction arithmetic (no floating-point) so that
 * 2 ÷ 3 = 4 ÷ 6 validates correctly.
 *
 * Public functions exposed on window.AMath.evaluator:
 *   - validateEquation(tokens) → { valid, reason, value? }
 *   - evaluateExpression(tokens) → { ok, value, reason? }
 *   - tokenize(faces) → array of token objects
 */

(function () {
  const U = window.AMath.utils;

  // =============================================================================
  // TOKENIZER
  // Converts a list of tile face strings into a list of tokens.
  // Concatenates consecutive digit tiles into multi-digit numbers.
  //
  // Example input:  ['1', '2', '+', '5', '=', '17']
  // Example output: [{type: 'num', value: 12}, {type: 'op', value: '+'}, ...]
  // =============================================================================

  function tokenize(faces) {
    const tokens = [];
    let i = 0;

    while (i < faces.length) {
      const face = faces[i];

      // Two-digit standalone tile (10-20)
      if (/^([1][0-9]|20)$/.test(face)) {
        tokens.push({ type: 'num', value: parseInt(face, 10), isMultiDigit: false });
        i++;
        continue;
      }

      // Single digit — may concatenate with following digits to form multi-digit number
      if (/^[0-9]$/.test(face)) {
        let numStr = face;
        let j = i + 1;
        while (j < faces.length && /^[0-9]$/.test(faces[j])) {
          numStr += faces[j];
          j++;
        }
        // Check max 3 digits (Master Spec §1.5: "2 or 3 digits max")
        if (numStr.length > 3) {
          return { error: 'Number exceeds 3 digits: ' + numStr };
        }
        // Check leading zero (Master Spec §1.5: "Leading zeros forbidden")
        if (numStr.length > 1 && numStr[0] === '0') {
          return { error: 'Leading zero in number: ' + numStr };
        }
        tokens.push({
          type: 'num',
          value: parseInt(numStr, 10),
          isMultiDigit: numStr.length > 1,
        });
        i = j;
        continue;
      }

      // Operators and equals
      if (face === '+' || face === '-' || face === '×' || face === '÷') {
        tokens.push({ type: 'op', value: face });
        i++;
        continue;
      }

      if (face === '=') {
        tokens.push({ type: 'eq' });
        i++;
        continue;
      }

      // Unknown face
      return { error: 'Unknown tile face: ' + face };
    }

    return { tokens: tokens };
  }

  // =============================================================================
  // PRE-VALIDATION CHECKS
  // Catches structural errors before parsing.
  // =============================================================================

  function preValidate(tokens) {
    if (tokens.length === 0) {
      return 'Empty equation';
    }

    // Must contain at least one '='
    const hasEquals = tokens.some((t) => t.type === 'eq');
    if (!hasEquals) {
      return 'Equation must contain =';
    }

    // No two adjacent operators (Master Spec §1.5)
    // Adjacency rule: operators are '+', '-', '×', '÷'.
    // Exception: unary '-' may appear after = or at start (handled in parser).
    // But '+' cannot ever be unary, and consecutive operators are always invalid.
    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];
      if (a.type === 'op' && b.type === 'op') {
        return 'Adjacent operators not allowed: ' + a.value + ' ' + b.value;
      }
    }

    // '+' cannot be unary (Master Spec §1.5)
    // Check: '+' must have a number/multi-digit-number ending immediately before it
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'op' && t.value === '+') {
        const prev = i === 0 ? null : tokens[i - 1];
        if (!prev || prev.type === 'eq') {
          return 'Unary + not allowed';
        }
      }
    }

    // Cannot start or end with operator (except unary '-' at start of segment)
    const last = tokens[tokens.length - 1];
    if (last.type === 'op' || last.type === 'eq') {
      return 'Equation cannot end with operator or =';
    }

    return null; // No error
  }

  // =============================================================================
  // SEGMENT SPLITTER
  // Splits tokens at '=' signs into segments.
  // Each segment must evaluate to the same value (chained equality).
  // =============================================================================

  function splitAtEquals(tokens) {
    const segments = [];
    let current = [];
    for (const t of tokens) {
      if (t.type === 'eq') {
        if (current.length === 0) {
          return { error: 'Empty side of =' };
        }
        segments.push(current);
        current = [];
      } else {
        current.push(t);
      }
    }
    if (current.length === 0) {
      return { error: 'Empty side of =' };
    }
    segments.push(current);
    return { segments: segments };
  }

  // =============================================================================
  // SEGMENT EVALUATOR
  // Evaluates a single segment (no '=' signs).
  // Returns { ok: true, value: fraction } or { ok: false, reason: string }.
  //
  // Algorithm: Shunting-yard-like, but simplified for our limited grammar.
  // We support unary '-' at segment start.
  // Operator precedence: ×÷ > +-, left-to-right within same precedence.
  // =============================================================================

  function evaluateSegment(tokens) {
    if (tokens.length === 0) {
      return { ok: false, reason: 'Empty segment' };
    }

    // Phase A: Resolve unary '-' at start of segment
    // Master Spec §1.5: '-' at start is unary negation
    let working = tokens.slice();
    let negateFirst = false;

    if (working[0].type === 'op' && working[0].value === '-') {
      negateFirst = true;
      working = working.slice(1);
      if (working.length === 0 || working[0].type !== 'num') {
        return { ok: false, reason: 'Unary - must be followed by a number' };
      }
    }

    // Now working must alternate: num, op, num, op, num, ...
    // i.e., odd-indexed = op, even-indexed = num
    if (working.length === 0 || working[0].type !== 'num') {
      return { ok: false, reason: 'Segment must start with number' };
    }
    for (let i = 0; i < working.length; i++) {
      if (i % 2 === 0 && working[i].type !== 'num') {
        return { ok: false, reason: 'Expected number at position ' + i };
      }
      if (i % 2 === 1 && working[i].type !== 'op') {
        return { ok: false, reason: 'Expected operator at position ' + i };
      }
    }
    if (working.length % 2 === 0) {
      return { ok: false, reason: 'Segment must end with number' };
    }

    // Extract numbers and operators
    const nums = []; // Array of fraction objects
    const ops = []; // Array of operator strings

    // Master Spec §1.5: +0 and -0 as standalone numbers are invalid
    // A "standalone number" means a number at the start of a segment with no preceding number,
    // OR a number where the prefix sign was applied to it directly (unary).
    // For binary ops like '5 + 0', the '0' is NOT standalone — it's a binary operand.

    for (let i = 0; i < working.length; i++) {
      if (i % 2 === 0) {
        // Number
        let v = working[i].value;
        if (i === 0 && negateFirst) {
          // Check for -0 as standalone
          if (v === 0) {
            return { ok: false, reason: '-0 as standalone number is not allowed' };
          }
          v = -v;
        }
        nums.push(U.frac(v));
      } else {
        ops.push(working[i].value);
      }
    }

    // Phase B: Resolve × and ÷ first (left to right)
    let i = 0;
    while (i < ops.length) {
      if (ops[i] === '×' || ops[i] === '÷') {
        let result;
        try {
          if (ops[i] === '×') {
            result = U.fracMul(nums[i], nums[i + 1]);
          } else {
            result = U.fracDiv(nums[i], nums[i + 1]);
          }
        } catch (e) {
          return { ok: false, reason: e.message };
        }
        nums.splice(i, 2, result);
        ops.splice(i, 1);
      } else {
        i++;
      }
    }

    // Phase C: Resolve + and - (left to right)
    i = 0;
    while (i < ops.length) {
      let result;
      if (ops[i] === '+') {
        result = U.fracAdd(nums[i], nums[i + 1]);
      } else {
        result = U.fracSub(nums[i], nums[i + 1]);
      }
      nums.splice(i, 2, result);
      ops.splice(i, 1);
    }

    if (nums.length !== 1) {
      return { ok: false, reason: 'Failed to fully evaluate segment' };
    }

    return { ok: true, value: nums[0] };
  }

  // =============================================================================
  // MAIN VALIDATOR
  // Takes an array of tile faces. Returns { valid, reason, value? }.
  // =============================================================================

  function validateEquation(faces) {
    // Step 1: Tokenize
    const tokRes = tokenize(faces);
    if (tokRes.error) {
      return { valid: false, reason: tokRes.error };
    }
    const tokens = tokRes.tokens;

    // Step 2: Pre-validate structure
    const preErr = preValidate(tokens);
    if (preErr) {
      return { valid: false, reason: preErr };
    }

    // Step 3: Split at = signs into segments
    const splitRes = splitAtEquals(tokens);
    if (splitRes.error) {
      return { valid: false, reason: splitRes.error };
    }
    const segments = splitRes.segments;

    if (segments.length < 2) {
      return { valid: false, reason: 'Equation must have at least two sides' };
    }

    // Step 4: Evaluate each segment
    const values = [];
    for (let i = 0; i < segments.length; i++) {
      const res = evaluateSegment(segments[i]);
      if (!res.ok) {
        return { valid: false, reason: 'Segment ' + (i + 1) + ': ' + res.reason };
      }
      values.push(res.value);
    }

    // Step 5: All segments must evaluate to the same exact value
    const first = values[0];
    for (let i = 1; i < values.length; i++) {
      if (!U.fracEquals(first, values[i])) {
        return {
          valid: false,
          reason:
            'Side ' +
            (i + 1) +
            ' (' +
            fracToString(values[i]) +
            ') does not equal side 1 (' +
            fracToString(first) +
            ')',
        };
      }
    }

    return { valid: true, value: first, reason: 'Valid equation' };
  }

  // Helper: format a fraction for display in error messages
  function fracToString(f) {
    if (f.den === 1) return String(f.num);
    return f.num + '/' + f.den;
  }

  // =============================================================================
  // EXPOSE TO GLOBAL SCOPE
  // =============================================================================

  window.AMath = window.AMath || {};
  window.AMath.evaluator = {
    validateEquation: validateEquation,
    tokenize: tokenize,
    evaluateSegment: evaluateSegment,
  };
})();
