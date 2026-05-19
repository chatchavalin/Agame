/**
 * A-Math AI — Pattern Engine
 *
 * Translates symbolic patterns (e.g., "xxx + x = xxx") into actual A-Math
 * equations by assigning specific number tiles from the rack.
 *
 * Template syntax (parsed):
 *   x          → single-digit slot (one tile, value 0-9 or 10-20 if twodigit)
 *   xx         → 2-character number slot (TWO single-digit tiles concatenated)
 *   xxx        → 3-character number slot (THREE single-digit tiles concatenated)
 *   x_highest  → x slot that MUST be assigned the rack's highest number
 *   x_twodigit → x slot that MUST be a 10-20 tile
 *   +, -, ×, ÷ → operator slot (literal)
 *   =          → equals slot (literal)
 *
 * A leading '-' on a number term denotes unary minus.
 *
 * The engine:
 *   1. Parses template into a list of TERMS and OPERATORS
 *   2. Categorizes rack tiles into: digits (0-9), twodigits (10-20), ops, equals
 *   3. Tries assignments using smart enumeration
 *   4. Evaluates each candidate equation using the game's evaluator
 *   5. Returns first valid assignment
 */

(function () {
  const Eval = window.AMath.evaluator;

  // --------- Template Parsing ---------

  /**
   * Parse a template string like "x + xx = xxx" into structured form.
   * Returns: { lhs: [terms], rhs: [terms], lhsOps: [ops] }
   *
   * Each term:
   *   { type: 'number', size: 1|2|3, unary: '-' or null, constraint: 'highest'|'twodigit'|null }
   *
   * Example: "-xx + x = x_highest"
   *   → lhs: [{number, size:2, unary:'-'}, {number, size:1}]
   *     lhsOps: ['+']
   *     rhs: [{number, size:1, constraint: 'highest'}]
   *     rhsOps: []
   */
  function parseTemplate(template) {
    // Tokenize: split by spaces but preserve structure
    const tokens = template.replace(/\s+/g, ' ').trim().split(' ');
    if (tokens.indexOf('=') === -1) return null;

    const eqIdx = tokens.indexOf('=');
    const lhsTokens = tokens.slice(0, eqIdx);
    const rhsTokens = tokens.slice(eqIdx + 1);

    return {
      lhs: parseSide(lhsTokens),
      rhs: parseSide(rhsTokens),
    };
  }

  function parseSide(tokens) {
    const terms = [];
    const ops = [];
    let pendingUnary = null;

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '+' || t === '-' || t === '×' || t === '÷') {
        if (terms.length === 0) {
          // Leading sign → unary on next term
          if (t === '-') pendingUnary = '-';
          // We don't handle leading '+' as it's invalid in A-Math
          continue;
        }
        ops.push(t);
      } else if (t.startsWith('x') || t.startsWith('-x')) {
        // Number term
        let unary = pendingUnary;
        let body = t;
        if (t.startsWith('-x')) {
          unary = '-';
          body = t.substring(1);
        }
        pendingUnary = null;

        // Parse size + constraint
        let size = 0;
        let constraint = null;
        if (body.startsWith('xxx')) {
          size = 3;
          if (body === 'xxx_highest') constraint = 'highest';
        } else if (body.startsWith('xx')) {
          size = 2;
          if (body === 'xx_highest') constraint = 'highest';
        } else if (body.startsWith('x')) {
          size = 1;
          if (body === 'x_highest') constraint = 'highest';
          else if (body === 'x_twodigit') constraint = 'twodigit';
        }
        terms.push({ type: 'number', size: size, unary: unary, constraint: constraint });
      }
      // Skip = sign (handled by caller via slicing)
    }

    return { terms: terms, ops: ops };
  }

  // --------- Rack Categorization ---------

  /**
   * Split a rack into typed buckets.
   * Returns: { digits: [tile,...], twodigits: [tile,...], ops: [{op:'+',tile}], equals: [tile,...], blanks: [tile,...] }
   */
  function categorizeRack(tiles) {
    const result = { digits: [], twodigits: [], ops: [], equals: [], blanks: [] };
    for (const tile of tiles) {
      if (tile.type === 'digit') result.digits.push(tile);
      else if (tile.type === 'twodigit') result.twodigits.push(tile);
      else if (tile.type === 'op') result.ops.push({ op: tile.face, tile: tile });
      else if (tile.type === 'choice') {
        // +/- or ×/÷ → can be either
        result.ops.push({ op: '?', choice: tile.face, tile: tile });
      } else if (tile.type === 'equals') result.equals.push(tile);
      else if (tile.type === 'blank') result.blanks.push(tile);
    }
    return result;
  }

  // --------- Template Compatibility Check ---------

  /**
   * Quick reject: does this rack have enough resources to fill this template?
   * Returns { ok: true } or { ok: false, reason: '...' }
   */
  function checkCompatibility(template, rack) {
    // Count slots needed
    const allTerms = template.lhs.terms.concat(template.rhs.terms);
    const allOps = template.lhs.ops.concat(template.rhs.ops);

    let singleDigitSlotsNeeded = 0;     // size-1 'x' slots that must be one-digit tiles (or twodigit if standalone)
    let multiDigitSlotsNeeded = 0;       // total digit-cells across all xx/xxx slots
    let twodigitOnlySlots = 0;           // slots forced to be 10-20 tile
    let highestSlots = 0;

    for (const term of allTerms) {
      if (term.size === 1) singleDigitSlotsNeeded++;
      else multiDigitSlotsNeeded += term.size;
      if (term.constraint === 'twodigit') twodigitOnlySlots++;
      if (term.constraint === 'highest') highestSlots++;
    }

    // Rack has: digits + twodigits + blanks (as fallback) = total numbers
    const totalNumberTiles = rack.digits.length + rack.twodigits.length + rack.blanks.length;
    const totalSlots = singleDigitSlotsNeeded + multiDigitSlotsNeeded;

    if (totalNumberTiles < totalSlots - twodigitOnlySlots) {
      // We have too few number tiles. But blanks can fill multi-digit slots.
      // (Strict check) ...
    }

    // xx and xxx slots CANNOT use twodigit tiles
    if (multiDigitSlotsNeeded > rack.digits.length + rack.blanks.length) {
      return { ok: false, reason: 'not enough single-digit tiles for xx/xxx slots' };
    }

    // twodigit-only slots need a 10-20 tile in rack
    if (twodigitOnlySlots > rack.twodigits.length + rack.blanks.length) {
      return { ok: false, reason: 'not enough twodigit tiles' };
    }

    // Operators
    const opsCount = {};
    for (const op of allOps) opsCount[op] = (opsCount[op] || 0) + 1;
    const rackOps = {};
    for (const o of rack.ops) {
      if (o.op === '?') {
        // choice tile counts as either
        rackOps['?'] = (rackOps['?'] || 0) + 1;
      } else {
        rackOps[o.op] = (rackOps[o.op] || 0) + 1;
      }
    }
    // (Detailed op matching is done during assignment)

    return { ok: true };
  }

  // --------- Assignment Engine ---------

  /**
   * Try to fill the template with rack tiles. Returns assignment or null.
   *
   * Handles BLANKs in two ways:
   *   1. BLANK as a number digit (0-9) — handled inside backtracking
   *   2. BLANK as an operator (+,-,×,÷) or equals (=) — handled by pre-allocating
   *      BLANKs to operator/equals slots, then recursing
   */
  function tryAssign(template, rack, maxAttempts) {
    maxAttempts = maxAttempts || 5000;

    // Count operator slots and equals slots needed
    const allOps = template.lhs.ops.concat(template.rhs.ops);
    const opSlotsNeeded = allOps.length;
    const equalsNeeded = 1;  // every valid equation has exactly one '='

    // Match ops in rack
    const rackOpsCount = {};
    for (const o of rack.ops) {
      rackOpsCount[o.op] = (rackOpsCount[o.op] || 0) + 1;
    }
    const rackEqualsCount = rack.equals.length;

    // Count how many of each op we NEED from the template
    const neededOpsCount = {};
    for (const op of allOps) {
      neededOpsCount[op] = (neededOpsCount[op] || 0) + 1;
    }

    // Count missing ops (need to fill with BLANKs)
    let opsToFillWithBlanks = 0;
    for (const op in neededOpsCount) {
      const have = rackOpsCount[op] || 0;
      const need = neededOpsCount[op];
      if (have < need) opsToFillWithBlanks += (need - have);
    }
    const equalsToFillWithBlanks = Math.max(0, equalsNeeded - rackEqualsCount);
    const totalBlanksNeededForOps = opsToFillWithBlanks + equalsToFillWithBlanks;

    if (rack.blanks.length < totalBlanksNeededForOps) {
      // Not enough blanks to fill missing ops/equals
      return null;
    }

    // Pre-allocate BLANKs to ops/equals (these blanks won't be available for digit slots)
    const blanksForOps = rack.blanks.slice(0, totalBlanksNeededForOps);
    const blanksForDigits = rack.blanks.slice(totalBlanksNeededForOps);

    // Now build slots
    const slots = [];
    for (const t of template.lhs.terms) slots.push({ ...t, side: 'lhs' });
    for (const t of template.rhs.terms) slots.push({ ...t, side: 'rhs' });

    // Pools
    const digitsPool = rack.digits.slice();
    const twodigitsPool = rack.twodigits.slice();
    const blanksPool = blanksForDigits.slice();

    // Generator: try all valid slot assignments recursively
    const result = backtrack(slots, 0, digitsPool, twodigitsPool, blanksPool, [], [], template.lhs.ops, template.rhs.ops, { attempts: 0, max: maxAttempts });

    if (result) {
      // Tag the equation with which BLANKs are ops
      result.blanksForOps = blanksForOps;
      result.opsToBlankMap = neededOpsCount;
    }

    return result;
  }

  /**
   * Recursive backtracking assignment.
   * - Build numbers slot-by-slot
   * - At leaf, build equation and validate
   *
   * Each "slot" represents one term. Size determines how many digit tiles needed.
   * For size=1: pick one tile (digit OR twodigit OR blank-as-digit)
   * For size>1: pick `size` digit tiles (NOT twodigit), forming a multi-digit number.
   *             Leading digit cannot be '0'.
   */
  function backtrack(slots, slotIdx, digits, twodigits, blanks, ops, equals, lhsOps, rhsOps, counter) {
    if (counter.attempts >= counter.max) return null;
    counter.attempts++;

    if (slotIdx === slots.length) {
      // All slots filled. Build equation string and validate.
      // (slots have been mutated to store .assignedTiles and .assignedValue)
      return buildAndValidate(slots, lhsOps, rhsOps);
    }

    const slot = slots[slotIdx];

    if (slot.size === 1) {
      // Try each digit tile
      for (let i = 0; i < digits.length; i++) {
        const tile = digits[i];
        slot.assignedTiles = [tile];
        slot.assignedValue = parseInt(tile.face);
        // Apply unary
        if (slot.unary === '-') slot.assignedValue = -slot.assignedValue;
        // Constraint check
        if (slot.constraint === 'twodigit') continue; // need twodigit
        // Remove from pool
        digits.splice(i, 1);
        const r = backtrack(slots, slotIdx + 1, digits, twodigits, blanks, ops, equals, lhsOps, rhsOps, counter);
        digits.splice(i, 0, tile);
        if (r) return r;
        if (counter.attempts >= counter.max) return null;
      }
      // Try each twodigit tile
      for (let i = 0; i < twodigits.length; i++) {
        const tile = twodigits[i];
        slot.assignedTiles = [tile];
        slot.assignedValue = parseInt(tile.face);
        if (slot.unary === '-') slot.assignedValue = -slot.assignedValue;
        twodigits.splice(i, 1);
        const r = backtrack(slots, slotIdx + 1, digits, twodigits, blanks, ops, equals, lhsOps, rhsOps, counter);
        twodigits.splice(i, 0, tile);
        if (r) return r;
        if (counter.attempts >= counter.max) return null;
      }
      // Try each blank-as-digit (assign value 0-9)
      for (let i = 0; i < blanks.length; i++) {
        const tile = blanks[i];
        for (let v = 0; v <= 9; v++) {
          slot.assignedTiles = [tile];
          slot.assignedValue = v;
          slot.assignedBlankFaces = [String(v)];
          if (slot.unary === '-') slot.assignedValue = -v;
          if (slot.constraint === 'twodigit') continue;
          blanks.splice(i, 1);
          const r = backtrack(slots, slotIdx + 1, digits, twodigits, blanks, ops, equals, lhsOps, rhsOps, counter);
          blanks.splice(i, 0, tile);
          if (r) return r;
          if (counter.attempts >= counter.max) return null;
        }
        // Try blank as twodigit (value 10-20)
        if (slot.constraint !== 'twodigit' || true) {  // allow either
          for (let v = 10; v <= 20; v++) {
            slot.assignedTiles = [tile];
            slot.assignedValue = v;
            slot.assignedBlankFaces = [String(v)];
            if (slot.unary === '-') slot.assignedValue = -v;
            blanks.splice(i, 1);
            const r = backtrack(slots, slotIdx + 1, digits, twodigits, blanks, ops, equals, lhsOps, rhsOps, counter);
            blanks.splice(i, 0, tile);
            if (r) return r;
            if (counter.attempts >= counter.max) return null;
          }
        }
      }
      return null;
    }

    // size > 1: pick `size` digit tiles (no twodigit allowed)
    // Use C(n, size) × size! combinations
    return backtrackMultiDigit(slots, slotIdx, slot.size, [], digits, twodigits, blanks, ops, equals, lhsOps, rhsOps, counter);
  }

  /**
   * Pick `remainingSize` digit tiles for a multi-digit slot.
   * Builds the number left-to-right (leading digit ≠ 0).
   */
  function backtrackMultiDigit(slots, slotIdx, remainingSize, picked, digits, twodigits, blanks, ops, equals, lhsOps, rhsOps, counter) {
    if (counter.attempts >= counter.max) return null;
    counter.attempts++;

    if (remainingSize === 0) {
      // Build the number from picked tiles
      const slot = slots[slotIdx];
      slot.assignedTiles = picked.map(p => p.tile);
      // Get face values (handle blanks)
      const faces = picked.map(p => p.face);
      slot.assignedBlankFaces = picked.filter(p => p.tile.type === 'blank').map(p => p.face);
      // Leading digit check
      if (faces[0] === '0') return null;
      const numStr = faces.join('');
      let value = parseInt(numStr);
      if (slot.unary === '-') value = -value;
      slot.assignedValue = value;
      return backtrack(slots, slotIdx + 1, digits, twodigits, blanks, ops, equals, lhsOps, rhsOps, counter);
    }

    // Try each available digit tile next
    for (let i = 0; i < digits.length; i++) {
      const tile = digits[i];
      const face = tile.face;
      // Leading digit can't be 0
      if (picked.length === 0 && face === '0') continue;
      picked.push({ tile: tile, face: face });
      digits.splice(i, 1);
      const r = backtrackMultiDigit(slots, slotIdx, remainingSize - 1, picked, digits, twodigits, blanks, ops, equals, lhsOps, rhsOps, counter);
      digits.splice(i, 0, tile);
      picked.pop();
      if (r) return r;
      if (counter.attempts >= counter.max) return null;
    }

    // Try blanks as digits (each blank = one digit 0-9)
    for (let i = 0; i < blanks.length; i++) {
      const tile = blanks[i];
      for (let v = 0; v <= 9; v++) {
        const face = String(v);
        if (picked.length === 0 && face === '0') continue;
        picked.push({ tile: tile, face: face });
        blanks.splice(i, 1);
        const r = backtrackMultiDigit(slots, slotIdx, remainingSize - 1, picked, digits, twodigits, blanks, ops, equals, lhsOps, rhsOps, counter);
        blanks.splice(i, 0, tile);
        picked.pop();
        if (r) return r;
        if (counter.attempts >= counter.max) return null;
      }
    }

    return null;
  }

  /**
   * After all slots assigned, build the equation and validate using the
   * game's official equation validator (handles A-Math rules: integer division,
   * no leading zeros, etc.).
   */
  function buildAndValidate(slots, lhsOps, rhsOps) {
    // Build the equation as an array of face strings
    // Order: lhs terms (interleaved with lhsOps), '=', rhs terms (interleaved with rhsOps)
    const faces = [];
    const lhsSlots = slots.filter(s => s.side === 'lhs');
    const rhsSlots = slots.filter(s => s.side === 'rhs');

    function addSide(slotsOnSide, opsOnSide) {
      for (let i = 0; i < slotsOnSide.length; i++) {
        const slot = slotsOnSide[i];
        // Add unary minus if applicable (and if first term, OR after an op)
        if (slot.unary === '-' && (i === 0 || i > 0)) {
          faces.push('-');
        }
        // Add digit-by-digit face values for this number
        for (const tile of slot.assignedTiles) {
          if (tile.type === 'blank') {
            // Use the assigned blank face
            const idx = slot.assignedTiles.indexOf(tile);
            faces.push(slot.assignedBlankFaces[idx]);
          } else {
            faces.push(tile.face);
          }
        }
        // Add operator after this term (if not last)
        if (i < opsOnSide.length) faces.push(opsOnSide[i]);
      }
    }

    addSide(lhsSlots, lhsOps);
    faces.push('=');
    addSide(rhsSlots, rhsOps);

    // Validate using game's official validator
    if (window.AMath.evaluator && window.AMath.evaluator.validateEquation) {
      const res = window.AMath.evaluator.validateEquation(faces);
      if (!res.valid) return null;
    } else {
      // Fallback: simple in-house validation
      const lhsValue = computeSideValue(lhsSlots, lhsOps);
      const rhsValue = computeSideValue(rhsSlots, rhsOps);
      if (lhsValue === null || rhsValue === null) return null;
      if (lhsValue !== rhsValue) return null;
    }

    return {
      slots: slots.slice(),
      faces: faces,
    };
  }

  /**
   * Compute the numeric value of one side of an equation, respecting
   * operator precedence (× and ÷ before + and -).
   * Returns null on division-by-zero, non-integer division, etc.
   */
  function computeSideValue(terms, ops) {
    // terms: list of { assignedValue, unary }
    // ops: list of operators between consecutive terms
    const values = terms.map(t => t.assignedValue);
    const operators = ops.slice();

    // Validate: no leading zero in twodigit blank usage
    // (Already handled in slot building)

    // First pass: × and ÷
    let i = 0;
    while (i < operators.length) {
      const op = operators[i];
      if (op === '×') {
        values[i] = values[i] * values[i + 1];
        values.splice(i + 1, 1);
        operators.splice(i, 1);
      } else if (op === '÷') {
        if (values[i + 1] === 0) return null;          // div by zero
        const result = values[i] / values[i + 1];
        if (!Number.isInteger(result)) return null;     // integer-only
        values[i] = result;
        values.splice(i + 1, 1);
        operators.splice(i, 1);
      } else {
        i++;
      }
    }

    // Second pass: + and -
    let total = values[0];
    for (let j = 0; j < operators.length; j++) {
      const op = operators[j];
      if (op === '+') total += values[j + 1];
      else if (op === '-') total -= values[j + 1];
      else return null;
    }

    return total;
  }

  // --------- Module exports ---------
  window.AMath = window.AMath || {};
  window.AMath.patternsEngine = {
    parseTemplate: parseTemplate,
    categorizeRack: categorizeRack,
    tryAssign: tryAssign,
    computeSideValue: computeSideValue,
  };
})();
