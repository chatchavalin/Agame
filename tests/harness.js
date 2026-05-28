/**
 * tests/harness.js — shared test harness.
 *
 * Loads the REAL app modules (no duplicated logic) into a minimal Node `window`
 * shim so the same code that runs in the browser is what gets tested.
 *
 * Usage:
 *   const { load, T, summary } = require('./harness');
 *   const AMath = load();            // returns window.AMath with real modules
 *   T('label', actual === expected); // record a check
 *   process.exit(summary());         // prints pass/fail, returns exit code
 */
'use strict';
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'js');

// Evaluate a browser module file in a context where `window` is global,
// exactly like a <script> tag would. Modules attach to window.AMath.
function runModule(file) {
  const src = fs.readFileSync(path.join(JS, file), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(src).call(global);
}

let loaded = null;
function load() {
  if (loaded) return loaded;
  global.window = global.window || global;
  global.window.AMath = global.window.AMath || {};
  // Load order mirrors index.html for the pieces the tests need.
  runModule('utils.js');
  runModule('constants.js');
  runModule('evaluator.js');
  runModule('scoring.js');
  runModule('bingo-solver.js');
  loaded = global.window.AMath;
  return loaded;
}

// ---- assertion + reporting ----
let pass = 0, fail = 0;
const failures = [];
function T(label, cond) {
  if (cond) { pass++; }
  else { fail++; failures.push(label); console.log('  \u274c ' + label); }
}
function summary() {
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  return fail ? 1 : 0;
}

module.exports = { load, T, summary, JS };
