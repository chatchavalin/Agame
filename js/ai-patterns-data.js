/**
 * A-Math AI — Pattern Data
 *
 * Predefined equation templates from the project knowledge (Thai A-Math standard).
 * Used by ai-patterns-engine.js to find Bingo equations rapidly.
 *
 * Pattern signature format:
 *   ops:     sorted string of operators needed, e.g. '++×' for 2 plus and 1 times
 *   equals:  number of '=' tiles needed (always 1 for valid equations)
 *   numbers: number of single-digit tiles needed (or twodigit standalone slots)
 *   templates: array of equation templates (engine tries each in order)
 *
 * Templates use the engine's parser syntax:
 *   x, xx, xxx          number slots (1, 2, 3 digit tiles)
 *   x_highest           must be assigned the rack's largest number
 *   x_twodigit          must be a 10-20 standalone tile
 *   -x                  unary minus
 *   +, -, ×, ÷, =       literal operators
 *
 * Templates are sorted by ops string for fast lookup.
 *
 * NOTE: A "size-9 pattern" is for an 8-tile Bingo using all 8 rack tiles +
 * 1 adjacent board tile. Total tile count in template = 9 (counting cells:
 * each digit cell is one, each operator is one).
 *
 * IMPORTANT: Patterns describe what tiles the COMBINED rack must have,
 * not just AI's rack. The AI must add 1 adjacent board tile to its 8 rack
 * tiles, then the combined set is what we match against pattern signatures.
 */

(function () {
  // ========================================================================
  // SIZE 9 PATTERNS (8-tile Bingo + 1 adjacent board tile)
  // Patterns categorized by operator+equals composition.
  // Numbers = count of digit/twodigit number tiles.
  // ========================================================================
  const SIZE_9_PATTERNS = [
    // ─── 1 op + = + 7 numbers ──────────────────────────────────────────
    { ops: '+', equals: 1, numbers: 7, templates: [
      'xxx + x = xxx',
      'xx + xx = xxx',
    ]},
    { ops: '-', equals: 1, numbers: 7, templates: [
      'xxx - xxx = x',
      'xxx - xx = xx',
    ]},
    { ops: '×', equals: 1, numbers: 7, templates: [
      'xxx × x = xxx',
      'xx × xx = xxx',
    ]},
    { ops: '÷', equals: 1, numbers: 7, templates: [
      'xxx ÷ xxx = x',
      'xxx ÷ xx = xx',
    ]},

    // ─── 2 ops + = + 6 numbers ─────────────────────────────────────────
    { ops: '+×', equals: 1, numbers: 6, templates: [
      'x × x + xx = xx',
      'x × x + x = xxx',
      'xx × x + x = xx',
    ]},
    { ops: '-×', equals: 1, numbers: 6, templates: [
      'x × x - xx = xx',
      'x × x - xxx = x',
      'xx × x - xx = x',
    ]},
    { ops: '+÷', equals: 1, numbers: 6, templates: [
      'x ÷ x + xx = xx',
      'xx ÷ x + x = xx',
      'xx ÷ xx + x = x',
      'xxx ÷ x + x = x',
    ]},
    { ops: '-÷', equals: 1, numbers: 6, templates: [
      'x ÷ x - xx = xx',
      'xx ÷ x - xx = x',
      'xx ÷ xx - x = x',
      'xxx ÷ x - x = x',
    ]},
    { ops: '×÷', equals: 1, numbers: 6, templates: [
      'x ÷ x × xx = xx',
      'xxx ÷ x = x × x',
    ]},
    { ops: '++', equals: 1, numbers: 6, templates: [
      'x + x + xx = xx',
      'x + xx = xx + x',
    ]},
    { ops: '--', equals: 1, numbers: 6, templates: [
      'x = xxx - x - x',
      'x = xx - xx - x',
      '-xx = x - xxx',
      '-xx = xx - xx',
      '-x = xx - xxx',
      'x = xx - xx - x',
    ]},
    { ops: '+-', equals: 1, numbers: 6, templates: [
      'x + x = xx - xx',
      'x + xx = xx - x',
    ]},
    { ops: '××', equals: 1, numbers: 6, templates: [
      'x × xx = xx × x',
      'xx × xx = x × x',
      'xxx × x = x × x',
      'xxx = x × x × x',
    ]},
    { ops: '÷÷', equals: 1, numbers: 6, templates: [
      'x ÷ xx = x ÷ xx',
      'x ÷ xx ÷ xx = x',
      'xx ÷ x ÷ xx = x',
      'xx ÷ x = xx ÷ x',
      'xx ÷ xx = x ÷ x',
      'xxx ÷ x ÷ x = x',
    ]},

    // ─── 3 ops + = + 5 numbers ─────────────────────────────────────────
    { ops: '+++', equals: 1, numbers: 5, templates: [
      'x + x + x + x = x',
    ]},
    { ops: '++-', equals: 1, numbers: 5, templates: [
      'x + x + x - x = x',
    ]},
    { ops: '+--', equals: 1, numbers: 5, templates: [
      'x + x - x - x = x',
      'xx + x - x = -x',
      'x + x - xx = -x',
      'x + x - x_twodigit = -xx',
    ]},
    { ops: '---', equals: 1, numbers: 5, templates: [
      'x_highest - x - x - x = x',
      'x - x - x = -xx',
      'x - x - xx = -x',
      'xx - x - x = -x',
      '-x - x = x - xx',
      '-x - x = xx - x',
      '-xx - x = -xx',
      '-xx - xx = -x',
      '-x - xx = -xx',
    ]},
    { ops: '++×', equals: 1, numbers: 5, templates: [
      'x + x + x = x × x',
      'x + x = x × x + x',
      'x = x × x + x + x',
    ]},
    { ops: '++÷', equals: 1, numbers: 5, templates: [
      'x + x + x = x ÷ x',
      'x + x = x ÷ x + x',
      'x = x ÷ x + x + x',
    ]},
    { ops: '--×', equals: 1, numbers: 5, templates: [
      'x - x - x = x × x',
      'x - x = x × x - x',
      'x = x × x - x - x',
      'x - xx × x = -x',
    ]},
    { ops: '--÷', equals: 1, numbers: 5, templates: [
      'x - x - x = x ÷ x',
      'x - x = x ÷ x - x',
      'x = x ÷ x - x - x',
      'x - xx ÷ x = -x',
      'xx ÷ x - x = -x',
    ]},
    { ops: '+××', equals: 1, numbers: 5, templates: [
      'x × x × x = x + x',
      'x × x = x + x × x',
    ]},
    { ops: '-××', equals: 1, numbers: 5, templates: [
      'x × x × x = x_highest - x',
      'x × x = x_highest - x × x',
      'x × x = x × x - x',
    ]},
    { ops: '+×÷', equals: 1, numbers: 5, templates: [
      'x × x ÷ x = x + x',
      'x ÷ x = x + x × x',
      'x × x = x + x ÷ x',
    ]},
    { ops: '-×÷', equals: 1, numbers: 5, templates: [
      'x × x ÷ x = x - x',
      'x ÷ x = x - x × x',
      'x ÷ x = x × x - x',
      'x × x = x - x ÷ x',
    ]},
    { ops: '+÷÷', equals: 1, numbers: 5, templates: [
      'x_highest ÷ x ÷ x = x + x',
      'x ÷ x = x ÷ x + x',
    ]},
    { ops: '-÷÷', equals: 1, numbers: 5, templates: [
      'x ÷ x ÷ x - x = x',
      'x ÷ x ÷ x = x - x',
      'x ÷ x = x - x ÷ x',
      'x ÷ x = x ÷ x - x',
    ]},
    { ops: '+-×', equals: 1, numbers: 5, templates: [
      'x + x - x = x × x',
      '-xx + x = x × x',
      '-x + x = xx × x',
    ]},
    { ops: '+-÷', equals: 1, numbers: 5, templates: [
      'x + x - x = x ÷ x',
      'x - x = x ÷ x + x',
      '-xx + x = x ÷ x',
      '-x + xx = x ÷ x',
      '-x + x = xx ÷ x',
      '-x + x = x ÷ xx',
    ]},
  ];

  // Build a lookup index: ops-signature → patterns list
  const SIZE_9_INDEX = {};
  for (const p of SIZE_9_PATTERNS) {
    const key = p.ops + '|' + p.numbers;
    SIZE_9_INDEX[key] = p;
  }

  /**
   * Find patterns matching a rack composition.
   * @param ops: array of operator characters present in the combined candidate rack
   *             (e.g., ['+', '+', '×']). Order doesn't matter; we sort.
   * @param numbers: count of number tiles (digit + twodigit, NOT counting blanks)
   * @returns array of pattern objects { ops, equals, numbers, templates }
   */
  function findPatternsForSignature(ops, numbers) {
    const sortedOps = ops.slice().sort(opSortKey).join('');
    const matches = [];

    // Exact match first
    const key = sortedOps + '|' + numbers;
    if (SIZE_9_INDEX[key]) matches.push(SIZE_9_INDEX[key]);

    return matches;
  }

  /**
   * Sort operators in a stable, canonical order: + then - then × then ÷
   */
  function opSortKey(a, b) {
    const order = { '+': 0, '-': 1, '×': 2, '÷': 3 };
    return (order[a] || 99) - (order[b] || 99);
  }

  /**
   * Get all size-9 patterns that the rack COULD potentially fit, given that
   * BLANKs can flex to fill missing ops/numbers.
   *
   * Algorithm:
   *   - Count fixed ops, fixed numbers, fixed equals, BLANKs in the candidate rack
   *   - For each predefined pattern, check if BLANKs can cover missing pieces
   *   - Return all viable patterns
   */
  function findViablePatterns(candidateRackComposition) {
    const c = candidateRackComposition;
    // c: { digits, twodigits, ops: {+:1, -:0, ×:1, ÷:0}, equals, blanks, choices: {+/-:1, ×/÷:0} }

    const viable = [];

    for (const pattern of SIZE_9_PATTERNS) {
      // Count what the pattern needs
      const needsOps = {};
      for (const op of pattern.ops) {
        needsOps[op] = (needsOps[op] || 0) + 1;
      }
      const needsNumbers = pattern.numbers;
      const needsEquals = pattern.equals;

      // Compute deficits
      let missingOps = 0;
      for (const op in needsOps) {
        const have = c.ops[op] || 0;
        // Choice tiles also count: +/- can be + or -, ×/÷ can be × or ÷
        let extra = 0;
        if (op === '+' || op === '-') extra += c.choices['+/-'] || 0;
        if (op === '×' || op === '÷') extra += c.choices['×/÷'] || 0;
        // (extra is the pool of flexible tiles we could pull from; only an approximation)
        const need = needsOps[op];
        if (have < need) {
          missingOps += (need - have);
        }
      }

      const missingEquals = Math.max(0, needsEquals - c.equals);
      const totalNumbersAvail = c.digits + c.twodigits;
      const missingNumbers = Math.max(0, needsNumbers - totalNumbersAvail);

      // Can BLANKs cover the gap? BLANKs are flexible.
      // Note: a single BLANK can only be ONE thing.
      const totalMissing = missingOps + missingEquals + missingNumbers;

      // Choice tiles can flex too
      const choiceTotal = (c.choices['+/-'] || 0) + (c.choices['×/÷'] || 0);

      if (c.blanks + choiceTotal >= totalMissing) {
        viable.push(pattern);
      }
    }

    return viable;
  }

  window.AMath = window.AMath || {};
  window.AMath.patternsData = {
    SIZE_9_PATTERNS: SIZE_9_PATTERNS,
    SIZE_9_INDEX: SIZE_9_INDEX,
    findPatternsForSignature: findPatternsForSignature,
    findViablePatterns: findViablePatterns,
  };
})();
