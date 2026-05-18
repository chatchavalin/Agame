/**
 * A-Math Game — Utility Functions
 *
 * Generic helpers used across the project. Nothing game-specific.
 */

// =============================================================================
// RANDOMNESS
// =============================================================================

/**
 * Returns a random integer between min (inclusive) and max (inclusive).
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Shuffles an array in place using the Fisher-Yates algorithm.
 * Returns the same array (mutated).
 */
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Returns a random element from an array.
 * Returns undefined if array is empty.
 */
function randomChoice(array) {
  if (array.length === 0) return undefined;
  return array[Math.floor(Math.random() * array.length)];
}

// =============================================================================
// CLONING
// =============================================================================

/**
 * Deep clones an object via JSON serialization.
 * Limitation: doesn't handle functions, Dates, undefined values, etc.
 * For our game state (which is all JSON-serializable per Master Spec §14.1), this is fine.
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Formats a score number with thousand separators.
 * 12345 → "12,345"
 */
function formatScore(num) {
  return num.toLocaleString('en-US');
}

/**
 * Formats seconds as MM:SS (or -MM:SS for negative).
 * Handles negative time (chess clock can go negative per Master Spec §3.4).
 *  72  → "01:12"
 * -45  → "-00:45"
 */
function formatTime(seconds) {
  const negative = seconds < 0;
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return (negative ? '-' : '') + mm + ':' + ss;
}

// =============================================================================
// ID GENERATION
// =============================================================================

let _idCounter = 0;

/**
 * Generates a unique sequential ID with a prefix.
 * Used for tile IDs, move IDs, etc.
 *  generateId('tile') → 'tile_001', 'tile_002', ...
 */
function generateId(prefix) {
  _idCounter++;
  return prefix + '_' + String(_idCounter).padStart(3, '0');
}

// =============================================================================
// FRACTION ARITHMETIC
// (Used by the equation evaluator per Master Spec §1.5d Rule 2)
// (Equations may produce fractional results; use exact integer fractions to avoid floating-point errors.)
// =============================================================================

/**
 * Greatest Common Divisor (for reducing fractions).
 */
function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b > 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * Creates a fraction object { num, den }, always in reduced form, denominator always positive.
 *  frac(2, 4)  → { num: 1, den: 2 }
 *  frac(-3, 6) → { num: -1, den: 2 }
 *  frac(5)     → { num: 5, den: 1 }
 */
function frac(num, den = 1) {
  if (den === 0) {
    throw new Error('Fraction denominator cannot be zero');
  }
  // Make denominator positive
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

/**
 * Fraction addition.
 */
function fracAdd(a, b) {
  return frac(a.num * b.den + b.num * a.den, a.den * b.den);
}

/**
 * Fraction subtraction.
 */
function fracSub(a, b) {
  return frac(a.num * b.den - b.num * a.den, a.den * b.den);
}

/**
 * Fraction multiplication.
 */
function fracMul(a, b) {
  return frac(a.num * b.num, a.den * b.den);
}

/**
 * Fraction division. Throws on division by zero.
 */
function fracDiv(a, b) {
  if (b.num === 0) {
    throw new Error('Division by zero');
  }
  return frac(a.num * b.den, a.den * b.num);
}

/**
 * Equality check for two fractions.
 */
function fracEquals(a, b) {
  return a.num === b.num && a.den === b.den;
}

// =============================================================================
// EXPOSE TO GLOBAL SCOPE
// =============================================================================

window.AMath = window.AMath || {};
window.AMath.utils = {
  randomInt,
  shuffle,
  randomChoice,
  deepClone,
  formatScore,
  formatTime,
  generateId,
  // Fraction arithmetic
  frac,
  fracAdd,
  fracSub,
  fracMul,
  fracDiv,
  fracEquals,
};
